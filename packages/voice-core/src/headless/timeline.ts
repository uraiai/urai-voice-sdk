/**
 * The call's timeline: what was said, which tools ran, and the components
 * the agent asked to show, in order. Pure and immutable, so a store can
 * hand the array straight to React.
 */
import { parseDisplayComponent } from "./components";
import type { VoiceServerEvent } from "./server-events";
import type { MessageItem, SpeakerRole, TimelineItem, ToolItem } from "./types";

export type TimelineEvent =
  | VoiceServerEvent
  /** The visitor typed into the call with `sendText`. */
  | { type: "typed-text"; text: string }
  /** A client tool handler finished in this browser. */
  | { type: "client-tool-result"; callId: string; success: boolean };

export type IdSource = () => string;

export function createIdSource(prefix = "i"): IdSource {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** The newest message of `role` still being transcribed, if any. */
function openMessageIndex(items: TimelineItem[], role: SpeakerRole): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "message" && item.role === role) return item.final ? -1 : i;
  }
  return -1;
}

function replaceAt(items: TimelineItem[], index: number, item: TimelineItem): TimelineItem[] {
  const next = items.slice();
  next[index] = item;
  return next;
}

function closeAgentMessage(items: TimelineItem[], interrupted: boolean): TimelineItem[] {
  const i = openMessageIndex(items, "agent");
  if (i < 0) return items;
  const msg = items[i] as MessageItem;
  return replaceAt(items, i, { ...msg, final: true, ...(interrupted ? { interrupted } : {}) });
}

function toolIndex(items: TimelineItem[], callId: string | null, name: string): number {
  if (callId) return items.findIndex((it) => it.kind === "tool" && it.callId === callId);
  // Protocol 0 sends no call id: results arrive in order, so the oldest
  // running call of that name is the one that finished.
  return items.findIndex(
    (it) => it.kind === "tool" && it.callId === null && it.name === name && it.status === "running",
  );
}

export function reduceTimeline(
  items: TimelineItem[],
  event: TimelineEvent,
  nextId: IdSource,
): TimelineItem[] {
  switch (event.type) {
    case "transcript": {
      const i = openMessageIndex(items, event.role);
      if (i >= 0) {
        const msg = items[i] as MessageItem;
        // `replace`: the text is the whole utterance so far (cascaded STT
        // snapshots). Otherwise it is a fragment (Gemini Live) to append.
        const text = event.replace ? event.text : `${msg.text} ${event.text}`.trim();
        return replaceAt(items, i, { ...msg, text, final: event.isFinal });
      }
      if (!event.text.trim() && !event.isFinal) return items;
      return [
        ...items,
        { kind: "message", id: nextId(), role: event.role, text: event.text.trim(), final: event.isFinal },
      ];
    }
    case "typed-text":
      return [
        ...items,
        { kind: "message", id: nextId(), role: "user", text: event.text, final: true, typed: true },
      ];
    case "turn-complete":
      return closeAgentMessage(items, false);
    case "interrupted":
      return closeAgentMessage(items, true);
    case "tool-call":
    case "client-tool-call": {
      const client = event.type === "client-tool-call";
      const existing = event.callId ? toolIndex(items, event.callId, event.name) : -1;
      if (existing >= 0) {
        // The server echoes a client tool as an ordinary tool call too.
        const tool = items[existing] as ToolItem;
        return client && !tool.client ? replaceAt(items, existing, { ...tool, client }) : items;
      }
      const tool: ToolItem = {
        kind: "tool",
        id: nextId(),
        callId: event.callId,
        name: event.name,
        arguments: event.arguments,
        status: "running",
        client,
      };
      return [...items, tool];
    }
    case "tool-result":
    case "client-tool-result": {
      const name = event.type === "tool-result" ? event.name : "";
      const i = toolIndex(items, event.callId, name);
      if (i < 0) return items;
      const tool = items[i] as ToolItem;
      if (tool.status !== "running") return items;
      return replaceAt(items, i, { ...tool, status: event.success ? "done" : "failed" });
    }
    case "command": {
      const component = parseDisplayComponent(event.command);
      if (!component) return items;
      return [...items, { kind: "component", id: nextId(), ...component }];
    }
    case "agent-changed":
      return [
        ...items,
        {
          kind: "notice",
          id: nextId(),
          notice: { type: "agent-changed", agentId: event.agentId, agentName: event.agentName },
        },
      ];
    case "error":
      return [
        ...items,
        { kind: "notice", id: nextId(), notice: { type: "error", message: event.message } },
      ];
    default:
      return items;
  }
}
