/**
 * `createVoiceClient`: one object per embedded agent. It owns the store,
 * the client tool registry and the event bus for its whole life; each
 * `start()` runs one call (signaling WebSocket + WebRTC peer connection)
 * on top of them.
 */
import { Emitter, type VoiceEventListener, type VoiceEventName } from "./events";
import { resolveEnvironment, type VoiceEnvironment, type WebSocketLike } from "./environment";
import { createLevelMonitor, type LevelMonitor } from "./levels";
import { commandName } from "./headless/components";
import {
  createToolRegistry,
  type ClientTool,
  type ToolRegistry,
} from "./headless/client-tools";
import { toVoiceEvent, type VoiceServerEvent } from "./headless/server-events";
import { createStore, type Store } from "./headless/store";
import { createIdSource, reduceTimeline, type TimelineEvent } from "./headless/timeline";
import { INITIAL_STATE, type AudioLevels, type VoiceState } from "./headless/types";
import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type IceCandidateInit,
  type ServerMessage,
} from "./protocol";

declare const __SDK_VERSION__: string;
export const SDK_VERSION = typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "dev";

export type VoiceVars = Record<string, unknown>;

export interface VoiceClientOptions {
  /** Origin of the urai-voice service, e.g. `https://voice.example.com`. */
  baseUrl: string;
  agentId: string;
  /**
   * Values for the agent's prompt variables and session metadata. Sent when
   * a call starts, like the script-tag widget's `data-var-*` attributes.
   */
  vars?: VoiceVars;
  /** Client tools available from the first call. More can be registered later. */
  tools?: ClientTool[];
  audio?: {
    inputDeviceId?: string;
    /** Merged over the defaults (noise suppression, echo cancellation, AGC). */
    constraints?: MediaTrackConstraints;
  };
  /** Fail the call if media is not flowing within this time. Default 20 s. */
  connectTimeoutMs?: number;
  /** Substitute browser APIs (tests, unusual hosts). */
  environment?: Partial<VoiceEnvironment>;
}

export interface ReadableStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export type CommandHandler = (command: Record<string, unknown>) => void;

export interface VoiceClient {
  readonly store: ReadableStore<VoiceState>;
  /** Microphone and agent loudness. Separate from `store` because it ticks ~20×/s. */
  readonly levels: ReadableStore<AudioLevels>;
  readonly tools: Pick<ToolRegistry, "register" | "setHandler" | "has">;
  /**
   * Starts a call: microphone prompt, signaling, WebRTC. Call it from a
   * user gesture so audio can play. Never rejects — failures land in
   * `store` (`status: "error"`) and the `error` event.
   */
  start(): Promise<void>;
  /** Hangs up. Safe to call at any time. */
  end(): void;
  setMuted(muted: boolean): void;
  /** Sends typed text into the live call as a user turn. */
  sendText(text: string): void;
  /** Replaces the vars sent with the next call. */
  setVars(vars: VoiceVars): void;
  /** Switches microphone, mid-call included. */
  setInputDevice(deviceId: string | undefined): Promise<void>;
  on<K extends VoiceEventName>(event: K, listener: VoiceEventListener<K>): () => void;
  /** Subscribes to commands named `name` (the payload's `command` or `type`). */
  onCommand(name: string, handler: CommandHandler): () => void;
  destroy(): void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_AUDIO: MediaTrackConstraints = {
  sampleRate: 16000,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

export function signalingUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}/api/v1/webrtc/ws/${encodeURIComponent(agentId)}`;
}

/** Everything that belongs to one call; thrown away when it ends. */
interface Call {
  ws: WebSocketLike | null;
  pc: RTCPeerConnection | null;
  mic: MediaStream | null;
  remote: MediaStream | null;
  audio: HTMLAudioElement | null;
  audioCtx: AudioContext | null;
  levels: LevelMonitor | null;
  pendingCandidates: IceCandidateInit[];
  remoteDescriptionSet: boolean;
  connectTimer: ReturnType<typeof setTimeout> | null;
  resolveStart: () => void;
  closed: boolean;
}

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  if (!options.baseUrl) throw new Error("createVoiceClient: baseUrl is required");
  if (!options.agentId) throw new Error("createVoiceClient: agentId is required");

  const store: Store<VoiceState> = createStore(INITIAL_STATE);
  const levels = createStore<AudioLevels>({ input: 0, output: 0 });
  const emitter = new Emitter();
  const commandHandlers = new Map<string, Set<CommandHandler>>();
  const registry = createToolRegistry();
  const nextId = createIdSource();
  let vars: VoiceVars = { ...options.vars };
  let inputDeviceId = options.audio?.inputDeviceId;
  let call: Call | null = null;
  let startPromise: Promise<void> | null = null;
  let destroyed = false;

  for (const tool of options.tools ?? []) registry.register(tool);

  const apply = (event: TimelineEvent) => {
    store.set((s) => ({ items: reduceTimeline(s.items, event, nextId) }));
  };

  const send = (c: Call, msg: ClientMessage) => {
    if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  };

  const micConstraints = (): MediaStreamConstraints => ({
    audio: {
      ...DEFAULT_AUDIO,
      ...options.audio?.constraints,
      ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
    },
    video: false,
  });

  /** Tears the call down and settles the store. Idempotent per call. */
  const finish = (c: Call, error: string | null) => {
    if (c.closed) return;
    c.closed = true;
    if (call === c) call = null;
    if (c.connectTimer) clearTimeout(c.connectTimer);
    registry.abortAll();
    registry.unfreeze();
    if (c.ws) {
      c.ws.onopen = c.ws.onmessage = c.ws.onerror = c.ws.onclose = null;
      try {
        c.ws.close();
      } catch {}
    }
    c.pc?.close();
    c.mic?.getTracks().forEach((t) => t.stop());
    c.remote?.getTracks().forEach((t) => t.stop());
    if (c.audio) {
      c.audio.pause?.();
      c.audio.srcObject = null;
    }
    c.levels?.stop();
    c.audioCtx?.close().catch(() => {});
    levels.set({ input: 0, output: 0 });
    store.set((s) => ({
      status: error ? "error" : "ended",
      error: error ?? s.error,
      agentSpeaking: false,
      userSpeaking: false,
    }));
    const s = store.getSnapshot();
    emitter.emit("status", { status: s.status, error: s.error });
    if (error) emitter.emit("error", { message: error });
    emitter.emit("ended", { error });
    c.resolveStart();
  };

  const setStatus = (status: VoiceState["status"]) => {
    if (store.getSnapshot().status === status) return;
    store.set({ status });
    emitter.emit("status", { status, error: store.getSnapshot().error });
  };

  const setListening = (c: Call, listening: boolean) => {
    c.mic?.getAudioTracks().forEach((t) => (t.enabled = listening));
    send(c, { type: listening ? "startListening" : "stopListening" });
  };

  const onConnected = (c: Call) => {
    if (c.closed || store.getSnapshot().status === "connected") return;
    if (c.connectTimer) clearTimeout(c.connectTimer);
    c.connectTimer = null;
    setStatus("connected");
    if (!store.getSnapshot().muted) setListening(c, true);
    void reportConnectionStats(c);
    c.resolveStart();
  };

  /** Logs the selected candidate pair server-side, to see how often calls relay through TURN. */
  const reportConnectionStats = async (c: Call) => {
    try {
      const report = await c.pc?.getStats();
      if (!report) return;
      let pair: any = null;
      report.forEach((s: any) => {
        if (s.type === "candidate-pair" && (s.selected || s.nominated) && s.state === "succeeded") pair = s;
      });
      if (!pair) return;
      const local: any = report.get(pair.localCandidateId);
      const remote: any = report.get(pair.remoteCandidateId);
      send(c, {
        type: "connectionStats",
        stats: {
          localCandidateType: local?.candidateType,
          remoteCandidateType: remote?.candidateType,
          protocol: local?.protocol,
          relayProtocol: local?.relayProtocol,
          currentRoundTripTime: pair.currentRoundTripTime,
        },
      });
    } catch {}
  };

  const setupPeer = async (c: Call, env: VoiceEnvironment, iceServers: RTCIceServer[]) => {
    const pc = new env.RTCPeerConnection({ iceServers });
    c.pc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const candidate = typeof e.candidate.toJSON === "function" ? e.candidate.toJSON() : e.candidate;
      send(c, { type: "iceCandidate", candidate: candidate as IceCandidateInit });
    };
    c.remote = new env.MediaStream();
    pc.ontrack = (e) => {
      c.remote!.addTrack(e.track);
      if (!c.audio) {
        c.audio = env.createAudioElement();
        c.audio.autoplay = true;
      }
      c.audio.srcObject = c.remote;
      c.audio.play?.()?.catch?.(() => {});
      c.levels?.setOutput(c.remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") onConnected(c);
      else if (pc.connectionState === "failed") finish(c, "The WebRTC connection failed.");
    };
    for (const track of c.mic!.getTracks()) {
      track.enabled = false;
      pc.addTrack(track, c.mic!);
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (c.closed) return;
    send(c, { type: "sdpOffer", sdp: offer.sdp! });
  };

  const handleConversationEvent = (c: Call, event: VoiceServerEvent) => {
    apply(event);
    switch (event.type) {
      case "transcript":
        emitter.emit("transcript", { role: event.role, text: event.text, isFinal: event.isFinal });
        if (!c.levels && event.role === "agent") store.set({ agentSpeaking: !event.isFinal });
        break;
      case "turn-complete":
      case "interrupted":
        if (!c.levels) store.set({ agentSpeaking: false });
        break;
      case "call-started": {
        const agent = { id: event.agentId, name: event.agentName };
        store.set({ callSid: event.callSid, agent });
        emitter.emit("call-started", { callSid: event.callSid, agent });
        break;
      }
      case "agent-changed": {
        const agent = { id: event.agentId, name: event.agentName };
        store.set({ agent });
        emitter.emit("agent-changed", agent);
        break;
      }
      case "command": {
        const name = commandName(event.command);
        emitter.emit("command", { name, command: event.command });
        if (name) {
          commandHandlers.get(name)?.forEach((h) => {
            try {
              h(event.command as Record<string, unknown>);
            } catch (err) {
              console.error(`[urai-voice] command "${name}" handler threw:`, err);
            }
          });
        }
        break;
      }
      case "tool-call":
        emitter.emit("tool-call", { callId: event.callId, name: event.name, arguments: event.arguments });
        break;
      case "tool-result":
        emitter.emit("tool-result", {
          callId: event.callId,
          name: event.name,
          result: event.result,
          success: event.success,
        });
        break;
      case "client-tool-call":
        emitter.emit("client-tool-call", {
          callId: event.callId,
          name: event.name,
          arguments: event.arguments,
        });
        void registry.dispatch(event).then((reply) => {
          if (c.closed) return;
          send(c, { type: "clientToolResult", ...reply });
          const success = !("error" in reply);
          apply({ type: "client-tool-result", callId: event.callId, success });
          emitter.emit("client-tool-result", { name: event.name, ...reply });
        });
        break;
      case "error":
        store.set({ error: event.message });
        emitter.emit("error", { message: event.message });
        break;
      case "final-transcripts":
        emitter.emit("final-transcripts", { transcripts: event.transcripts });
        break;
      case "usage":
        emitter.emit("usage", { stats: event.stats });
        break;
    }
  };

  const handleMessage = (c: Call, env: VoiceEnvironment, msg: ServerMessage) => {
    switch (msg.type) {
      case "iceServers":
        if (c.pc) return;
        setupPeer(c, env, msg.iceServers).catch((err) =>
          finish(c, `Could not start the call: ${err?.message ?? err}`),
        );
        return;
      case "sdpAnswer":
        c.pc
          ?.setRemoteDescription({ type: "answer", sdp: msg.sdp })
          .then(() => {
            c.remoteDescriptionSet = true;
            const queued = c.pendingCandidates.splice(0);
            return Promise.all(queued.map((cand) => c.pc?.addIceCandidate(cand)));
          })
          .catch((err) => finish(c, `Could not start the call: ${err?.message ?? err}`));
        return;
      case "iceCandidate":
        if (c.remoteDescriptionSet) c.pc?.addIceCandidate(msg.candidate).catch(() => {});
        else c.pendingCandidates.push(msg.candidate);
        return;
    }
    const event = toVoiceEvent(msg);
    if (event) handleConversationEvent(c, event);
  };

  const runCall = async (c: Call, env: VoiceEnvironment) => {
    setStatus("requesting-mic");
    try {
      c.mic = await env.getUserMedia(micConstraints());
    } catch (err: any) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      finish(c, denied ? "Microphone access was denied." : `Could not open the microphone: ${err?.message ?? err}`);
      return;
    }
    if (c.closed) {
      c.mic.getTracks().forEach((t) => t.stop());
      return;
    }
    c.levels?.setInput(c.mic);
    setStatus("connecting");

    c.connectTimer = setTimeout(
      () => finish(c, "Timed out connecting to the agent."),
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    );

    const ws = new env.WebSocket(signalingUrl(options.baseUrl, options.agentId));
    c.ws = ws;
    ws.onopen = () => {
      const location = env.location;
      send(c, {
        type: "initialMetadata",
        metadata: {
          ...vars,
          ...(location ? { _embed_source: location.origin, _embed_url: location.href } : {}),
          _embed_type: "sdk",
          _sdk: { name: "@uraiai/voice-core", version: SDK_VERSION, protocol: PROTOCOL_VERSION },
          _client_tools: registry.freeze(),
        },
      });
    };
    ws.onmessage = (e) => {
      const msg = parseServerMessage(e.data);
      if (msg) handleMessage(c, env, msg);
    };
    ws.onclose = () => {
      const s = store.getSnapshot();
      if (s.status === "connected") finish(c, null);
      else finish(c, s.error ?? "The connection closed before the call started.");
    };
  };

  const client: VoiceClient = {
    store,
    levels,
    tools: {
      register: (tool) => registry.register(tool),
      setHandler: (name, handler) => registry.setHandler(name, handler),
      has: (name) => registry.has(name),
    },

    start() {
      if (destroyed) return Promise.resolve();
      if (call && startPromise) return startPromise;
      let env: VoiceEnvironment;
      try {
        env = resolveEnvironment(options.environment);
      } catch (err: any) {
        store.set({ status: "error", error: err.message });
        emitter.emit("error", { message: err.message });
        return Promise.resolve();
      }
      store.set({
        status: "idle",
        items: [],
        error: null,
        callSid: null,
        agent: null,
        agentSpeaking: false,
        userSpeaking: false,
      });
      startPromise = new Promise<void>((resolve) => {
        const c: Call = {
          ws: null,
          pc: null,
          mic: null,
          remote: null,
          audio: null,
          audioCtx: null,
          levels: null,
          pendingCandidates: [],
          remoteDescriptionSet: false,
          connectTimer: null,
          resolveStart: resolve,
          closed: false,
        };
        call = c;
        // Created synchronously, inside the user gesture, so it starts running.
        if (env.AudioContext) {
          try {
            c.audioCtx = new env.AudioContext();
            c.levels = createLevelMonitor(c.audioCtx, (r) => {
              levels.set({ input: r.input, output: r.output });
              store.set({ userSpeaking: r.userSpeaking && !store.getSnapshot().muted, agentSpeaking: r.agentSpeaking });
            });
          } catch {
            c.audioCtx = null;
            c.levels = null;
          }
        }
        runCall(c, env).catch((err) => finish(c, `Could not start the call: ${err?.message ?? err}`));
      }).finally(() => {
        startPromise = null;
      });
      return startPromise;
    },

    end() {
      if (call) finish(call, null);
    },

    setMuted(muted) {
      store.set({ muted });
      if (call && store.getSnapshot().status === "connected") setListening(call, !muted);
    },

    sendText(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!call || store.getSnapshot().status !== "connected") {
        console.warn("[urai-voice] sendText ignored: no call is connected.");
        return;
      }
      send(call, { type: "textIn", text: trimmed });
      apply({ type: "typed-text", text: trimmed });
    },

    setVars(next) {
      vars = { ...next };
    },

    async setInputDevice(deviceId) {
      inputDeviceId = deviceId;
      const c = call;
      if (!c?.mic) return;
      const env = resolveEnvironment(options.environment);
      const fresh = await env.getUserMedia(micConstraints());
      if (c.closed) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = fresh.getAudioTracks()[0];
      const listening = store.getSnapshot().status === "connected" && !store.getSnapshot().muted;
      track.enabled = listening;
      const sender = c.pc?.getSenders().find((s) => s.track?.kind === "audio");
      await sender?.replaceTrack(track);
      c.mic.getTracks().forEach((t) => t.stop());
      c.mic = fresh;
      c.levels?.setInput(fresh);
    },

    on: (event, listener) => emitter.on(event, listener),

    onCommand(name, handler) {
      let set = commandHandlers.get(name);
      if (!set) commandHandlers.set(name, (set = new Set()));
      set.add(handler);
      return () => set.delete(handler);
    },

    destroy() {
      if (destroyed) return;
      client.end();
      destroyed = true;
      emitter.clear();
      commandHandlers.clear();
    },
  };

  return client;
}
