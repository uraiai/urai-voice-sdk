import { describe, expect, it } from "vitest";
import { createIdSource, reduceTimeline, type TimelineEvent } from "../../src/headless/timeline";
import { toVoiceEvent } from "../../src/headless/server-events";
import type { TimelineItem } from "../../src/headless/types";

function run(events: TimelineEvent[]): TimelineItem[] {
  const id = createIdSource();
  return events.reduce<TimelineItem[]>((items, e) => reduceTimeline(items, e, id), []);
}

const t = (role: "user" | "agent", text: string, isFinal = false, replace = false): TimelineEvent => ({
  type: "transcript",
  role,
  text,
  isFinal,
  replace,
});

describe("reduceTimeline", () => {
  it("appends Gemini Live fragments to the open message", () => {
    const items = run([t("agent", "Hello"), t("agent", "there."), { type: "turn-complete" }]);
    expect(items).toEqual([
      { kind: "message", id: "i1", role: "agent", text: "Hello there.", final: true },
    ]);
  });

  it("replaces cascaded snapshots instead of appending", () => {
    const items = run([t("user", "I want", false, true), t("user", "I want a refund", true, true)]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "I want a refund", final: true });
  });

  it("starts a new message once the previous one is final", () => {
    const items = run([t("user", "Hi", true), t("agent", "Hey"), { type: "turn-complete" }, t("user", "Bye", true)]);
    expect(items.map((i) => (i.kind === "message" ? `${i.role}:${i.text}` : i.kind))).toEqual([
      "user:Hi",
      "agent:Hey",
      "user:Bye",
    ]);
  });

  it("marks an interrupted agent message", () => {
    const items = run([t("agent", "Let me explain"), { type: "interrupted" }]);
    expect(items[0]).toMatchObject({ final: true, interrupted: true });
  });

  it("ignores empty interim fragments", () => {
    expect(run([t("agent", "  ")])).toEqual([]);
  });

  it("keeps transcribing a message across a tool card", () => {
    const items = run([
      t("agent", "Checking", false, true),
      { type: "tool-call", callId: "c1", name: "lookup", arguments: {} },
      t("agent", "Checking your order", false, true),
    ]);
    expect(items[0]).toMatchObject({ kind: "message", text: "Checking your order" });
    expect(items).toHaveLength(2);
  });

  it("matches tool results by call id", () => {
    const items = run([
      { type: "tool-call", callId: "a", name: "lookup", arguments: { id: 1 } },
      { type: "tool-call", callId: "b", name: "lookup", arguments: { id: 2 } },
      { type: "tool-result", callId: "b", name: "lookup", result: {}, success: false },
    ]);
    expect(items.map((i) => (i.kind === "tool" ? i.status : null))).toEqual(["running", "failed"]);
  });

  it("matches protocol 0 results (no call id) to the oldest running call of that name", () => {
    const items = run([
      { type: "tool-call", callId: null, name: "lookup", arguments: {} },
      { type: "tool-call", callId: null, name: "lookup", arguments: {} },
      { type: "tool-result", callId: null, name: "lookup", result: {}, success: true },
    ]);
    expect(items.map((i) => (i.kind === "tool" ? i.status : null))).toEqual(["done", "running"]);
  });

  it("merges the server's echo of a client tool into one item", () => {
    const items = run([
      { type: "client-tool-call", callId: "x", name: "go_to", arguments: {} },
      { type: "tool-call", callId: "x", name: "go_to", arguments: {} },
      { type: "client-tool-result", callId: "x", success: true },
    ]);
    expect(items).toEqual([
      { kind: "tool", id: "i1", callId: "x", name: "go_to", arguments: {}, status: "done", client: true },
    ]);
  });

  it("adds displayComponent commands and ignores other commands", () => {
    const items = run([
      { type: "command", command: { command: "displayComponent", component: "OrderCard", props: { id: 7 } } },
      { type: "command", command: { command: "navigate", path: "/x" } },
      { type: "command", command: { command: "displayComponent", component: "<script>" } },
    ]);
    expect(items).toEqual([{ kind: "component", id: "i1", component: "OrderCard", props: { id: 7 } }]);
  });

  it("records handoffs and errors as notices", () => {
    const items = run([
      { type: "agent-changed", agentId: "b", agentName: "Billing" },
      { type: "error", message: "Out of credits" },
    ]);
    expect(items.map((i) => i.kind === "notice" && i.notice.type)).toEqual(["agent-changed", "error"]);
  });

  it("returns the same array when nothing changes", () => {
    const id = createIdSource();
    const items = run([t("agent", "Hi", true)]);
    expect(reduceTimeline(items, { type: "turn-complete" }, id)).toBe(items);
  });
});

describe("toVoiceEvent", () => {
  it("unwraps protocol 0 commands and handoffs from toolCall", () => {
    expect(toVoiceEvent({ type: "toolCall", toolName: "command", arguments: { command: "x" } })).toEqual({
      type: "command",
      command: { command: "x" },
    });
    expect(
      toVoiceEvent({ type: "toolCall", toolName: "agent_changed", arguments: { agent_id: "b", agent_name: "B" } }),
    ).toEqual({ type: "agent-changed", agentId: "b", agentName: "B" });
  });

  it("maps protocol 1 messages", () => {
    expect(toVoiceEvent({ type: "agentChanged", agentId: "b", agentName: "B" })).toEqual({
      type: "agent-changed",
      agentId: "b",
      agentName: "B",
    });
    expect(toVoiceEvent({ type: "toolCall", toolName: "lookup", arguments: {}, callId: "c" })).toMatchObject({
      type: "tool-call",
      callId: "c",
    });
  });

  it("leaves signaling messages to the media layer", () => {
    expect(toVoiceEvent({ type: "sdpAnswer", sdp: "x" })).toBeNull();
  });
});
