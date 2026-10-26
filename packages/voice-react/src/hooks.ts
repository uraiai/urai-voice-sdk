import type {
  AudioLevels,
  ClientToolContext,
  ClientToolDefinition,
  CommandHandler,
  ReadableStore,
  TimelineItem,
  VoiceEventListener,
  VoiceEventName,
  VoiceState,
} from "@uraiai/voice-core";
import { INITIAL_STATE } from "@uraiai/voice-core/headless";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useVoiceClient } from "./provider";

const noopSubscribe = () => () => {};
const IDLE_STORE: ReadableStore<VoiceState> = {
  getSnapshot: () => INITIAL_STATE,
  subscribe: noopSubscribe,
};
const SILENT: AudioLevels = { input: 0, output: 0 };
const SILENT_STORE: ReadableStore<AudioLevels> = {
  getSnapshot: () => SILENT,
  subscribe: noopSubscribe,
};

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as any)[k], (b as any)[k]));
}

/**
 * A slice of the call state. Re-renders only when the selected value
 * changes (by `isEqual`, `Object.is` by default).
 */
export function useVoiceSelector<T>(
  selector: (state: VoiceState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useVoiceClient()?.store ?? IDLE_STORE;
  const cache = useRef<{ state: VoiceState; selector: unknown; value: T } | null>(null);
  const getSnapshot = () => {
    const state = store.getSnapshot();
    const hit = cache.current;
    if (hit && hit.state === state && hit.selector === selector) return hit.value;
    const value = selector(state);
    if (hit && isEqual(hit.value, value)) {
      cache.current = { state, selector, value: hit.value };
      return hit.value;
    }
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export interface UseVoiceCallResult
  extends Pick<VoiceState, "status" | "error" | "endReason" | "muted" | "agent" | "callSid"> {
  /** `requesting-mic`, `connecting` or `connected`. */
  isActive: boolean;
  start(): Promise<void>;
  end(): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  sendText(text: string): void;
}

const selectCall = (s: VoiceState) => ({
  status: s.status,
  error: s.error,
  endReason: s.endReason,
  muted: s.muted,
  agent: s.agent,
  callSid: s.callSid,
});

/** Call status and controls. */
export function useVoiceCall(): UseVoiceCallResult {
  const client = useVoiceClient();
  const state = useVoiceSelector(selectCall, shallowEqual);
  const start = useCallback(() => client?.start() ?? Promise.resolve(), [client]);
  const end = useCallback(() => client?.end(), [client]);
  const setMuted = useCallback((m: boolean) => client?.setMuted(m), [client]);
  const toggleMute = useCallback(() => {
    if (client) client.setMuted(!client.store.getSnapshot().muted);
  }, [client]);
  const sendText = useCallback((text: string) => client?.sendText(text), [client]);
  const isActive =
    state.status === "requesting-mic" || state.status === "connecting" || state.status === "connected";
  return { ...state, isActive, start, end, setMuted, toggleMute, sendText };
}

const selectItems = (s: VoiceState) => s.items;

/** The call's timeline: messages, tool calls, components and notices. */
export function useTranscript(): TimelineItem[] {
  return useVoiceSelector(selectItems);
}

const selectSpeaking = (s: VoiceState) => ({ agentSpeaking: s.agentSpeaking, userSpeaking: s.userSpeaking });

export interface UseAudioLevelsResult extends AudioLevels {
  agentSpeaking: boolean;
  userSpeaking: boolean;
}

/** Mic and agent loudness (0–1, ~20 updates a second) plus speaking flags. */
export function useAudioLevels(): UseAudioLevelsResult {
  const store = useVoiceClient()?.levels ?? SILENT_STORE;
  const levels = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const speaking = useVoiceSelector(selectSpeaking, shallowEqual);
  return { ...levels, ...speaking };
}

/**
 * Registers a client tool while the component is mounted. The handler can
 * close over fresh props and state: it is read on every call, so changing
 * it never re-registers. Changing the definition does, and takes effect on
 * the next call (declarations are fixed for a call in progress).
 */
export function useClientTool<Args = any>(
  definition: ClientToolDefinition,
  handler: (args: Args, ctx: ClientToolContext) => unknown | Promise<unknown>,
): void {
  const client = useVoiceClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = JSON.stringify(definition);

  useEffect(() => {
    if (!client) return;
    const def: ClientToolDefinition = JSON.parse(key);
    try {
      return client.tools.register({
        ...def,
        handler: (args, ctx) => handlerRef.current(args as Args, ctx),
      });
    } catch (err) {
      console.error("[urai-voice] useClientTool:", err);
      return undefined;
    }
  }, [client, key]);
}

/** Subscribes to a command by name (the payload's `command` or `type`). */
export function useVoiceCommand(name: string, handler: CommandHandler): void {
  const client = useVoiceClient();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => client?.onCommand(name, (cmd) => ref.current(cmd)), [client, name]);
}

/** Subscribes to a client event (`transcript`, `tool-call`, `ended`, …). */
export function useVoiceEvent<K extends VoiceEventName>(name: K, listener: VoiceEventListener<K>): void {
  const client = useVoiceClient();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => client?.on(name, (e) => ref.current(e)), [client, name]);
}
