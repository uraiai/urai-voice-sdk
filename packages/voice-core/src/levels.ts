/**
 * Loudness meters for the microphone and the agent's audio, plus the
 * speaking flags derived from them. Uses a timer rather than rAF so the
 * flags keep working in a background tab.
 */
const TICK_MS = 50;
const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 300;

export interface LevelReadings {
  input: number;
  output: number;
  userSpeaking: boolean;
  agentSpeaking: boolean;
}

export interface LevelMonitor {
  setInput(stream: MediaStream | null): void;
  setOutput(stream: MediaStream | null): void;
  stop(): void;
}

interface Meter {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
}

function rms(meter: Meter | null): number {
  if (!meter) return 0;
  meter.analyser.getByteTimeDomainData(meter.buffer);
  let sum = 0;
  for (const v of meter.buffer) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / meter.buffer.length);
}

export function createLevelMonitor(
  ctx: AudioContext,
  onTick: (readings: LevelReadings) => void,
): LevelMonitor {
  let input: Meter | null = null;
  let output: Meter | null = null;
  let lastUser = 0;
  let lastAgent = 0;

  const attach = (stream: MediaStream | null, prev: Meter | null): Meter | null => {
    prev?.source.disconnect();
    if (!stream || stream.getAudioTracks().length === 0) return null;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    // Not connected to the destination: playback stays on the <audio> element.
    source.connect(analyser);
    return { source, analyser, buffer: new Uint8Array(analyser.fftSize) };
  };

  const timer = setInterval(() => {
    const now = Date.now();
    const inLevel = Math.min(1, rms(input) * 4);
    const outLevel = Math.min(1, rms(output) * 4);
    if (inLevel > SPEAKING_THRESHOLD * 4) lastUser = now;
    if (outLevel > SPEAKING_THRESHOLD * 4) lastAgent = now;
    onTick({
      input: Math.round(inLevel * 100) / 100,
      output: Math.round(outLevel * 100) / 100,
      userSpeaking: now - lastUser < SPEAKING_HOLD_MS,
      agentSpeaking: now - lastAgent < SPEAKING_HOLD_MS,
    });
  }, TICK_MS);

  return {
    setInput(stream) {
      input = attach(stream, input);
    },
    setOutput(stream) {
      output = attach(stream, output);
    },
    stop() {
      clearInterval(timer);
      input?.source.disconnect();
      output?.source.disconnect();
      input = output = null;
    },
  };
}
