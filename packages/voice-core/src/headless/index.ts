/**
 * The DOM-free half of the SDK: state, the timeline reducer, message
 * normalization and the client tool registry. Nothing in here touches
 * `window`, WebSocket or WebRTC.
 */
export { createStore, type Store } from "./store";
export {
  INITIAL_STATE,
  type AgentInfo,
  type AudioLevels,
  type CallStatus,
  type EndReason,
  type ComponentItem,
  type MessageItem,
  type Notice,
  type NoticeItem,
  type SpeakerRole,
  type TimelineItem,
  type ToolItem,
  type ToolStatus,
  type VoiceState,
} from "./types";
export {
  commandName,
  DISPLAY_COMPONENT_COMMAND,
  parseDisplayComponent,
  type DisplayComponent,
} from "./components";
export { toVoiceEvent, type VoiceServerEvent } from "./server-events";
export { createIdSource, reduceTimeline, type IdSource, type TimelineEvent } from "./timeline";
export {
  createToolRegistry,
  defineClientTool,
  toDeclaration,
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_CLIENT_TOOLS,
  MAX_TOOL_DESCRIPTION,
  MAX_TOOL_TIMEOUT_MS,
  TOOL_NAME,
  type ClientTool,
  type ClientToolContext,
  type ClientToolDefinition,
  type ClientToolHandler,
  type ToolRegistry,
  type ToolRegistryOptions,
  type ToolResultMessage,
} from "./client-tools";
export {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ClientToolDeclaration,
  type FinalTranscript,
  type IceCandidateInit,
  type IceServerConfig,
  type JsonSchema,
  type ServerMessage,
} from "../protocol";
