export {
  createVoiceClient,
  signalingUrl,
  SDK_VERSION,
  type CommandHandler,
  type ReadableStore,
  type VoiceClient,
  type VoiceClientOptions,
  type VoiceVars,
} from "./client";

export type { VoiceEventListener, VoiceEventMap, VoiceEventName } from "./events";
export type { VoiceEnvironment, WebSocketLike } from "./environment";

export {
  defineClientTool,
  type ClientTool,
  type ClientToolContext,
  type ClientToolDefinition,
  type ClientToolHandler,
} from "./headless/client-tools";

export {
  DISPLAY_COMPONENT_COMMAND,
  parseDisplayComponent,
  type DisplayComponent,
} from "./headless/components";

export type {
  AgentInfo,
  AudioLevels,
  CallStatus,
  ComponentItem,
  MessageItem,
  Notice,
  NoticeItem,
  SpeakerRole,
  TimelineItem,
  ToolItem,
  ToolStatus,
  VoiceState,
} from "./headless/types";

export {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ClientToolDeclaration,
  type JsonSchema,
  type ServerMessage,
} from "./protocol";
