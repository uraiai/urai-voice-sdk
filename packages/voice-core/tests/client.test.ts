import { describe, expect, it, vi } from "vitest";
import { createFakeEnvironment, flush } from "@uraiai/voice-test-support";
import { createVoiceClient, signalingUrl, type VoiceClientOptions } from "../src";

function setup(opts: Partial<VoiceClientOptions> = {}) {
  const fake = createFakeEnvironment();
  const client = createVoiceClient({
    baseUrl: "https://voice.example/",
    agentId: "agent-1",
    environment: fake.environment,
    ...opts,
  });
  return { fake, client, state: () => client.store.getSnapshot() };
}

/** Drives a call to `connected` the way the server and browser would. */
async function connect(s: ReturnType<typeof setup>) {
  const started = s.client.start();
  await flush();
  const ws = s.fake.socket();
  ws.open();
  ws.serverSend({ type: "iceServers", iceServers: [{ urls: ["stun:stun.example"] }] });
  await flush();
  ws.serverSend({ type: "sdpAnswer", sdp: "answer" });
  await flush();
  const pc = s.fake.peer();
  pc.emitTrack();
  pc.setState("connected");
  await started;
  await flush();
  return { ws, pc };
}

describe("signalingUrl", () => {
  it("maps http(s) to ws(s) and trims trailing slashes", () => {
    expect(signalingUrl("https://voice.example/", "a b")).toBe("wss://voice.example/api/v1/webrtc/ws/a%20b");
    expect(signalingUrl("http://localhost:3000", "x")).toBe("ws://localhost:3000/api/v1/webrtc/ws/x");
  });
});

describe("createVoiceClient", () => {
  it("requires baseUrl and agentId", () => {
    expect(() => createVoiceClient({ baseUrl: "", agentId: "a" })).toThrow(/baseUrl/);
    expect(() => createVoiceClient({ baseUrl: "https://x", agentId: "" })).toThrow(/agentId/);
  });

  it("asks for the mic before opening the socket, then sends initial metadata", async () => {
    const s = setup({
      vars: { customer_id: "c-9" },
      tools: [{ name: "go_to", description: "Navigate", handler: () => null }],
    });
    const statuses: string[] = [];
    s.client.on("status", (e) => statuses.push(e.status));
    void s.client.start();
    expect(s.state().status).toBe("requesting-mic");
    expect(s.fake.sockets).toHaveLength(0);
    await flush();
    const ws = s.fake.socket();
    expect(ws.url).toBe("wss://voice.example/api/v1/webrtc/ws/agent-1");
    ws.open();
    const [init] = ws.sentOfType("initialMetadata");
    expect(init.metadata).toMatchObject({
      customer_id: "c-9",
      _embed_source: "https://host.example",
      _embed_url: "https://host.example/page",
      _embed_type: "sdk",
      _sdk: { name: "@uraiai/voice-core", protocol: 1 },
      _client_tools: [{ name: "go_to", description: "Navigate", parameters: { type: "object", properties: {} } }],
    });
    expect(statuses).toEqual(["requesting-mic", "connecting"]);
  });

  it("negotiates WebRTC and starts listening once media connects", async () => {
    const s = setup();
    const { ws, pc } = await connect(s);
    expect(pc.config.iceServers).toEqual([{ urls: ["stun:stun.example"] }]);
    expect(ws.sentOfType("sdpOffer")).toEqual([{ type: "sdpOffer", sdp: "fake-offer-sdp" }]);
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "answer" });
    expect(s.state().status).toBe("connected");
    expect(ws.sentOfType("startListening")).toHaveLength(1);
    expect(pc.senders[0].track!.enabled).toBe(true);
    expect(ws.sentOfType("connectionStats")[0].stats).toMatchObject({
      localCandidateType: "host",
      remoteCandidateType: "srflx",
    });
  });

  it("queues remote ICE candidates until the answer is applied", async () => {
    const s = setup();
    void s.client.start();
    await flush();
    const ws = s.fake.socket();
    ws.open();
    ws.serverSend({ type: "iceServers", iceServers: [] });
    await flush();
    ws.serverSend({ type: "iceCandidate", candidate: { candidate: "c1" } });
    const pc = s.fake.peer();
    expect(pc.addedCandidates).toEqual([]);
    ws.serverSend({ type: "sdpAnswer", sdp: "a" });
    await flush();
    expect(pc.addedCandidates).toEqual([{ candidate: "c1" }]);
    pc.emitCandidate({ candidate: "local" });
    expect(ws.sentOfType("iceCandidate")).toEqual([{ type: "iceCandidate", candidate: { candidate: "local" } }]);
  });

  it("reports a denied microphone without opening a socket", async () => {
    const s = setup();
    s.fake.denyMicrophone();
    const errors: string[] = [];
    s.client.on("error", (e) => errors.push(e.message));
    await s.client.start();
    expect(s.state()).toMatchObject({ status: "error", error: "Microphone access was denied." });
    expect(errors).toEqual(["Microphone access was denied."]);
    expect(s.fake.sockets).toHaveLength(0);
  });

  it("surfaces a server error that closes the socket before the call starts", async () => {
    const s = setup();
    const started = s.client.start();
    await flush();
    const ws = s.fake.socket();
    ws.open();
    ws.serverSend({ type: "error", message: "Insufficient credits" });
    ws.serverClose();
    await started;
    expect(s.state()).toMatchObject({ status: "error", error: "Insufficient credits" });
  });

  it("times out when media never connects", async () => {
    vi.useFakeTimers();
    try {
      const s = setup({ connectTimeoutMs: 1000 });
      const started = s.client.start();
      await vi.advanceTimersByTimeAsync(1000);
      await started;
      expect(s.state()).toMatchObject({ status: "error", error: "Timed out connecting to the agent." });
      expect(s.fake.socket().closedByClient).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the timeline from transcripts and typed text", async () => {
    const s = setup();
    const { ws } = await connect(s);
    ws.serverSend({ type: "userTranscription", text: "Where is", isFinal: false, replace: true });
    ws.serverSend({ type: "userTranscription", text: "Where is my order", isFinal: true, replace: true });
    ws.serverSend({ type: "aiTranscription", text: "Let me", isFinal: false });
    ws.serverSend({ type: "aiTranscription", text: "check.", isFinal: true });
    s.client.sendText("  Order 42  ");
    expect(ws.sentOfType("textIn")).toEqual([{ type: "textIn", text: "Order 42" }]);
    expect(s.state().items.map((i) => i.kind === "message" && `${i.role}:${i.text}`)).toEqual([
      "user:Where is my order",
      "agent:Let me check.",
      "user:Order 42",
    ]);
  });

  it("dispatches commands to named handlers and renders displayComponent", async () => {
    const s = setup();
    const { ws } = await connect(s);
    const navigate = vi.fn();
    s.client.onCommand("navigate", navigate);
    ws.serverSend({ type: "toolCall", toolName: "command", arguments: { command: "navigate", path: "/cart" } });
    ws.serverSend({ type: "command", command: { command: "displayComponent", component: "OrderCard", props: { id: 1 } } });
    expect(navigate).toHaveBeenCalledWith({ command: "navigate", path: "/cart" });
    expect(s.state().items).toEqual([{ kind: "component", id: expect.any(String), component: "OrderCard", props: { id: 1 } }]);
  });

  it("runs client tools and sends the result back", async () => {
    const s = setup({
      tools: [{ name: "go_to", description: "Navigate", handler: ({ path }: { path: string }) => ({ ok: path }) }],
    });
    const { ws } = await connect(s);
    ws.serverSend({ type: "clientToolCall", callId: "t1", name: "go_to", arguments: { path: "/a" } });
    expect(s.state().items[0]).toMatchObject({ kind: "tool", status: "running", client: true });
    await flush();
    expect(ws.sentOfType("clientToolResult")).toEqual([{ type: "clientToolResult", callId: "t1", result: { ok: "/a" } }]);
    expect(s.state().items[0]).toMatchObject({ status: "done" });
  });

  it("tracks the agent through call start and handoffs", async () => {
    const s = setup();
    const { ws } = await connect(s);
    ws.serverSend({ type: "callStarted", callSid: "sid-1", agentId: "a", agentName: "Sales" });
    expect(s.state()).toMatchObject({ callSid: "sid-1", agent: { id: "a", name: "Sales" } });
    ws.serverSend({ type: "toolCall", toolName: "agent_changed", arguments: { agent_id: "b", agent_name: "Billing" } });
    expect(s.state().agent).toEqual({ id: "b", name: "Billing" });
  });

  it("mute disables the mic track and tells the server", async () => {
    const s = setup();
    const { ws, pc } = await connect(s);
    s.client.setMuted(true);
    expect(pc.senders[0].track!.enabled).toBe(false);
    expect(ws.sentOfType("stopListening")).toHaveLength(1);
    s.client.setMuted(false);
    expect(ws.sentOfType("startListening")).toHaveLength(2);
  });

  it("starts muted when muted before connecting", async () => {
    const s = setup();
    s.client.setMuted(true);
    const { ws, pc } = await connect(s);
    expect(ws.sentOfType("startListening")).toHaveLength(0);
    expect(pc.senders[0].track!.enabled).toBe(false);
  });

  it("end() tears down media and the socket", async () => {
    const s = setup();
    const { ws, pc } = await connect(s);
    const ended = vi.fn();
    s.client.on("ended", ended);
    s.client.end();
    expect(s.state().status).toBe("ended");
    expect(ws.closedByClient).toBe(true);
    expect(pc.closed).toBe(true);
    expect(pc.senders[0].track!.stopped).toBe(true);
    expect(ended).toHaveBeenCalledWith({ error: null });
  });

  it("a server hang-up ends the call cleanly", async () => {
    const s = setup();
    const { ws } = await connect(s);
    ws.serverClose();
    expect(s.state()).toMatchObject({ status: "ended", error: null });
  });

  it("can start a fresh call after one ends", async () => {
    const s = setup();
    const first = await connect(s);
    first.ws.serverSend({ type: "aiTranscription", text: "Bye", isFinal: true });
    s.client.end();
    await connect(s);
    expect(s.fake.sockets).toHaveLength(2);
    expect(s.state()).toMatchObject({ status: "connected", items: [] });
  });

  it("swaps the microphone mid-call", async () => {
    const s = setup();
    const { pc } = await connect(s);
    const oldTrack = pc.senders[0].track!;
    await s.client.setInputDevice("usb-mic");
    expect(s.fake.micRequests.at(-1)!.audio).toMatchObject({ deviceId: { exact: "usb-mic" } });
    expect(pc.senders[0].track).not.toBe(oldTrack);
    expect(pc.senders[0].track!.enabled).toBe(true);
    expect(oldTrack.stopped).toBe(true);
  });

  it("returns the in-flight start when called twice", async () => {
    const s = setup();
    const a = s.client.start();
    const b = s.client.start();
    expect(a).toBe(b);
    await flush();
    expect(s.fake.sockets).toHaveLength(1);
  });
});
