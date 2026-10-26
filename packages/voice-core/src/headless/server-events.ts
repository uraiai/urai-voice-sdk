/**
 * Normalizes conversation messages from the server into one event shape,
 * whichever protocol the server spoke. Signaling messages (`iceServers`,
 * `sdpAnswer`, `iceCandidate`) are not conversation events and map to
 * `null`; the media layer handles them.
 */
import type { FinalTranscript, ServerMessage } from "../protocol";
import type { SpeakerRole } from "./types";

export type VoiceServerEvent =
  | { type: "transcript"; role: SpeakerRole; text: string; isFinal: boolean; replace: boolean }
  | { type: "turn-complete" }
  | { type: "interrupted" }
  | { type: "error"; message: string }
  | { type: "tool-call"; callId: string | null; name: string; arguments: unknown }
  | { type: "tool-result"; callId: string | null; name: string; result: unknown; success: boolean }
  | { type: "command"; command: unknown }
  | { type: "agent-changed"; agentId: string; agentName: string }
  | { type: "call-started"; callSid: string; agentId: string; agentName: string }
  | { type: "client-tool-call"; callId: string; name: string; arguments: unknown }
  | { type: "final-transcripts"; transcripts: FinalTranscript[] }
  | { type: "usage"; stats: Record<string, unknown> }
  | { type: "call-ended"; reason: string };

export function toVoiceEvent(msg: ServerMessage): VoiceServerEvent | null {
  switch (msg.type) {
    case "userTranscription":
    case "aiTranscription":
      return {
        type: "transcript",
        role: msg.type === "userTranscription" ? "user" : "agent",
        text: msg.text,
        isFinal: msg.isFinal,
        replace: msg.replace ?? false,
      };
    case "aiTurnComplete":
      return { type: "turn-complete" };
    case "interrupted":
      return { type: "interrupted" };
    case "error":
      return { type: "error", message: msg.message };
    case "toolCall": {
      // Protocol 0 multiplexes commands and handoffs through toolCall.
      if (msg.toolName === "command") return { type: "command", command: msg.arguments };
      if (msg.toolName === "agent_changed") {
        const args = (msg.arguments ?? {}) as { agent_id?: unknown; agent_name?: unknown };
        return {
          type: "agent-changed",
          agentId: String(args.agent_id ?? ""),
          agentName: String(args.agent_name ?? ""),
        };
      }
      return {
        type: "tool-call",
        callId: msg.callId ?? null,
        name: msg.toolName,
        arguments: msg.arguments,
      };
    }
    case "toolResult":
      return {
        type: "tool-result",
        callId: msg.callId ?? null,
        name: msg.toolName,
        result: msg.result,
        success: msg.success,
      };
    case "command":
      return { type: "command", command: msg.command };
    case "agentChanged":
      return { type: "agent-changed", agentId: msg.agentId, agentName: msg.agentName };
    case "callStarted":
      return {
        type: "call-started",
        callSid: msg.callSid,
        agentId: msg.agentId,
        agentName: msg.agentName,
      };
    case "clientToolCall":
      return {
        type: "client-tool-call",
        callId: msg.callId,
        name: msg.name,
        arguments: msg.arguments,
      };
    case "finalTranscripts":
      return { type: "final-transcripts", transcripts: msg.transcripts };
    case "usageStats":
      return { type: "usage", stats: msg.stats };
    case "callEnded":
      return { type: "call-ended", reason: msg.reason };
    default:
      return null;
  }
}
