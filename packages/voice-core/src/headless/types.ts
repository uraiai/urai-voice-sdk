/**
 * - `idle` — never started
 * - `requesting-mic` — waiting on the browser's microphone prompt
 * - `connecting` — signaling and ICE in progress
 * - `connected` — media is flowing
 * - `ended` — the call finished (hang-up from either side)
 * - `error` — the call failed; `error` says why
 */
export type CallStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type SpeakerRole = "user" | "agent";

export interface MessageItem {
  kind: "message";
  id: string;
  role: SpeakerRole;
  text: string;
  /** False while transcription is still streaming in. */
  final: boolean;
  /** The user talked over the agent and cut this message short. */
  interrupted?: boolean;
  /** Typed with `sendText` rather than spoken. */
  typed?: boolean;
}

export type ToolStatus = "running" | "done" | "failed";

export interface ToolItem {
  kind: "tool";
  id: string;
  /** Absent for protocol 0 servers, which do not send one. */
  callId: string | null;
  name: string;
  arguments: unknown;
  status: ToolStatus;
  /** Ran in this browser (a client tool) rather than on the server. */
  client: boolean;
}

export interface ComponentItem {
  kind: "component";
  id: string;
  component: string;
  props: Record<string, unknown>;
}

export type Notice =
  | { type: "agent-changed"; agentId: string; agentName: string }
  | { type: "error"; message: string };

export interface NoticeItem {
  kind: "notice";
  id: string;
  notice: Notice;
}

export type TimelineItem = MessageItem | ToolItem | ComponentItem | NoticeItem;

export interface AgentInfo {
  id: string;
  name: string;
}

export interface VoiceState {
  status: CallStatus;
  muted: boolean;
  agentSpeaking: boolean;
  userSpeaking: boolean;
  /** The agent on the call. Changes when the call is handed off. */
  agent: AgentInfo | null;
  /** Known once the server sends `callStarted` (protocol 1). */
  callSid: string | null;
  items: TimelineItem[];
  error: string | null;
}

/** Microphone and speaker loudness, 0–1. Updated many times a second. */
export interface AudioLevels {
  input: number;
  output: number;
}

export const INITIAL_STATE: VoiceState = {
  status: "idle",
  muted: false,
  agentSpeaking: false,
  userSpeaking: false,
  agent: null,
  callSid: null,
  items: [],
  error: null,
};
