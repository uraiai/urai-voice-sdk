import type { FinalTranscript } from "./protocol";
import type { AgentInfo, CallStatus, SpeakerRole } from "./headless/types";

export interface VoiceEventMap {
  status: { status: CallStatus; error: string | null };
  "call-started": { callSid: string; agent: AgentInfo };
  "agent-changed": AgentInfo;
  transcript: { role: SpeakerRole; text: string; isFinal: boolean };
  /**
   * A server-side tool sent a command to the page. `command` is the
   * tool's payload, verbatim — validate its shape before acting on it.
   */
  command: { name: string | null; command: unknown };
  "tool-call": { callId: string | null; name: string; arguments: unknown };
  "tool-result": { callId: string | null; name: string; result: unknown; success: boolean };
  "client-tool-call": { callId: string; name: string; arguments: unknown };
  "client-tool-result": { callId: string; name: string; result?: unknown; error?: string };
  "final-transcripts": { transcripts: FinalTranscript[] };
  usage: { stats: Record<string, unknown> };
  error: { message: string };
  ended: { error: string | null };
}

export type VoiceEventName = keyof VoiceEventMap;
export type VoiceEventListener<K extends VoiceEventName> = (event: VoiceEventMap[K]) => void;

/** Per-client event bus; several clients on a page never share listeners. */
export class Emitter {
  private listeners = new Map<VoiceEventName, Set<(event: any) => void>>();

  on<K extends VoiceEventName>(name: K, listener: VoiceEventListener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends VoiceEventName>(name: K, event: VoiceEventMap[K]): void {
    this.listeners.get(name)?.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error(`[urai-voice] "${name}" listener threw:`, err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
