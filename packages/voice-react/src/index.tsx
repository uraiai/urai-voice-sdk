export { UraiVoiceProvider, useVoiceClient, type UraiVoiceProviderProps } from "./provider";
export {
  shallowEqual,
  useAudioLevels,
  useClientTool,
  useTranscript,
  useVoiceCall,
  useVoiceCommand,
  useVoiceEvent,
  useVoiceSelector,
  type UseAudioLevelsResult,
  type UseVoiceCallResult,
} from "./hooks";

// Re-exported so most apps need one import.
export {
  defineClientTool,
  DISPLAY_COMPONENT_COMMAND,
  type AgentInfo,
  type CallStatus,
  type ClientTool,
  type ClientToolContext,
  type ClientToolDefinition,
  type ComponentItem,
  type EndReason,
  type MessageItem,
  type NoticeItem,
  type TimelineItem,
  type ToolItem,
  type VoiceClient,
  type VoiceState,
} from "@uraiai/voice-core";
