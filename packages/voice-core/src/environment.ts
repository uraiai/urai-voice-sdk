/**
 * The browser APIs a call needs, gathered in one place so tests (and
 * unusual hosts) can substitute them. Resolved when a call starts, never
 * at import, so the SDK is safe to import during SSR.
 */
export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface VoiceEnvironment {
  WebSocket: new (url: string) => WebSocketLike;
  RTCPeerConnection: new (config: RTCConfiguration) => RTCPeerConnection;
  MediaStream: new (tracks?: MediaStreamTrack[]) => MediaStream;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioElement(): HTMLAudioElement;
  /** Optional: without it there are no audio levels. */
  AudioContext?: new () => AudioContext;
  location?: { origin: string; href: string };
}

export function resolveEnvironment(overrides: Partial<VoiceEnvironment> = {}): VoiceEnvironment {
  const g = globalThis as any;
  const env: Partial<VoiceEnvironment> = {
    WebSocket: g.WebSocket,
    RTCPeerConnection: g.RTCPeerConnection,
    MediaStream: g.MediaStream,
    getUserMedia: g.navigator?.mediaDevices?.getUserMedia
      ? (c) => g.navigator.mediaDevices.getUserMedia(c)
      : undefined,
    createAudioElement: g.Audio ? () => new g.Audio() : undefined,
    AudioContext: g.AudioContext ?? g.webkitAudioContext,
    location: g.location ? { origin: g.location.origin, href: g.location.href } : undefined,
    ...overrides,
  };
  const missing = (["WebSocket", "RTCPeerConnection", "MediaStream", "getUserMedia", "createAudioElement"] as const)
    .filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Voice calls need a browser with ${missing.join(", ")}.`);
  }
  return env as VoiceEnvironment;
}
