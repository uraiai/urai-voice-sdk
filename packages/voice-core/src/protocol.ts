/**
 * Wire types for the signaling WebSocket at `/api/v1/webrtc/ws/{agent_id}`.
 * They mirror `ClientMessage` / `ServerMessage` in
 * `urai-voice/src/webrtc_client/mod.rs` (serde `tag = "type"`, camelCase).
 *
 * Protocol 0 is what the script-tag widget speaks. A client that sends
 * `_sdk.protocol >= 1` in `initialMetadata` also gets the dedicated
 * messages marked "protocol 1" below; until the server supports them, the
 * SDK understands the protocol 0 shapes as well.
 */

/** The protocol this SDK speaks. Sent as `initialMetadata._sdk.protocol`. */
export const PROTOCOL_VERSION = 1;

export interface IceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/** A client tool as the server sees it: the declaration, never the handler. */
export interface ClientToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema for the arguments (an `object` schema). */
  parameters: JsonSchema;
  timeoutMs?: number;
}

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
};

export type ClientMessage =
  | { type: "initialMetadata"; metadata: Record<string, unknown> }
  | { type: "sdpOffer"; sdp: string }
  | { type: "iceCandidate"; candidate: IceCandidateInit }
  | { type: "textIn"; text: string }
  | { type: "startListening" }
  | { type: "stopListening" }
  | { type: "connectionStats"; stats: Record<string, unknown> }
  /** Protocol 1: the answer to a `clientToolCall`. */
  | { type: "clientToolResult"; callId: string; result?: unknown; error?: string };

export interface FinalTranscript {
  id: string;
  call_log_id: number;
  ordinal: number;
  chat_role: string;
  transcript: string;
  start_offset_ms: number | null;
  end_offset_ms: number | null;
}

export type ServerMessage =
  | { type: "iceServers"; iceServers: IceServerConfig[] }
  | { type: "sdpAnswer"; sdp: string }
  | { type: "iceCandidate"; candidate: IceCandidateInit }
  | { type: "userTranscription"; text: string; isFinal: boolean; replace?: boolean }
  | { type: "aiTranscription"; text: string; isFinal: boolean; replace?: boolean }
  | { type: "aiTurnComplete" }
  | { type: "interrupted" }
  | { type: "error"; message: string }
  | { type: "usageStats"; stats: Record<string, unknown> }
  | { type: "finalTranscripts"; transcripts: FinalTranscript[] }
  /**
   * A server-side tool started. In protocol 0 this message also carries
   * `toolName: "command"` (a remote tool's command) and
   * `toolName: "agent_changed"` (a handoff).
   */
  | { type: "toolCall"; toolName: string; arguments: unknown; callId?: string }
  | { type: "toolResult"; toolName: string; result: unknown; success: boolean; callId?: string }
  /** Protocol 1. */
  | { type: "callStarted"; callSid: string; agentId: string; agentName: string }
  /** Protocol 1. */
  | { type: "agentChanged"; agentId: string; agentName: string }
  /** Protocol 1. */
  | { type: "command"; command: unknown }
  /** Protocol 1. */
  | { type: "clientToolCall"; callId: string; name: string; arguments: unknown };

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg === "object" && typeof msg.type === "string" ? msg : null;
  } catch {
    return null;
  }
}
