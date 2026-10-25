/**
 * Fakes for everything a call touches: the signaling WebSocket (driven
 * from the test as "the server"), RTCPeerConnection, MediaStream and
 * getUserMedia. `createFakeEnvironment()` wires them into the shape
 * `createVoiceClient({ environment })` accepts.
 */

export class FakeTrack {
  kind = "audio";
  enabled = true;
  stopped = false;
  constructor(readonly id: string) {}
  stop() {
    this.stopped = true;
  }
}

export class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
  removeTrack(track: FakeTrack) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  /** Messages the client sent, parsed. */
  sent: any[] = [];
  closedByClient = false;

  constructor(readonly url: string) {}

  send(data: string) {
    if (this.readyState !== FakeSocket.OPEN) throw new Error("FakeSocket: send while not open");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closedByClient = true;
    this.readyState = FakeSocket.CLOSED;
  }

  // ---- server side ----
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }
  serverSend(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({});
  }
  sentOfType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

export class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  onicecandidate: ((e: { candidate: any }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: FakeMediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  localDescription: any = null;
  remoteDescription: any = null;
  addedCandidates: any[] = [];
  senders: { track: FakeTrack | null; replaceTrack(t: FakeTrack): Promise<void> }[] = [];
  closed = false;

  constructor(readonly config: RTCConfiguration) {}

  addTrack(track: FakeTrack) {
    const sender = {
      track: track as FakeTrack | null,
      async replaceTrack(t: FakeTrack) {
        sender.track = t;
      },
    };
    this.senders.push(sender);
    return sender;
  }
  getSenders() {
    return this.senders;
  }
  async createOffer() {
    return { type: "offer", sdp: "fake-offer-sdp" };
  }
  async setLocalDescription(d: any) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: any) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: any) {
    this.addedCandidates.push(c);
  }
  async getStats() {
    return new Map<string, any>([
      ["pair", { type: "candidate-pair", selected: true, state: "succeeded", localCandidateId: "l", remoteCandidateId: "r" }],
      ["l", { candidateType: "host", protocol: "udp" }],
      ["r", { candidateType: "srflx" }],
    ]);
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }

  // ---- test side ----
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  emitTrack(track = new FakeTrack("remote")) {
    this.ontrack?.({ track, streams: [] });
  }
  emitCandidate(candidate: any) {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } });
  }
}

export class FakeAudio {
  autoplay = false;
  srcObject: unknown = null;
  played = 0;
  play() {
    this.played++;
    return Promise.resolve();
  }
  pause() {}
}

export interface FakeEnvironment {
  environment: any;
  sockets: FakeSocket[];
  peers: FakePeerConnection[];
  micRequests: MediaStreamConstraints[];
  /** Make the next getUserMedia reject with this error name. */
  denyMicrophone(name?: string): void;
  socket(): FakeSocket;
  peer(): FakePeerConnection;
}

/** Lets pending promise callbacks (and the microtasks they queue) run. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

export function createFakeEnvironment(): FakeEnvironment {
  const sockets: FakeSocket[] = [];
  const peers: FakePeerConnection[] = [];
  const micRequests: MediaStreamConstraints[] = [];
  let deny: string | null = null;
  let micCount = 0;

  const environment = {
    WebSocket: class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
    RTCPeerConnection: class extends FakePeerConnection {
      constructor(config: RTCConfiguration) {
        super(config);
        peers.push(this);
      }
    },
    MediaStream: FakeMediaStream,
    async getUserMedia(constraints: MediaStreamConstraints) {
      micRequests.push(constraints);
      if (deny) {
        const err = new Error("denied");
        err.name = deny;
        deny = null;
        throw err;
      }
      return new FakeMediaStream([new FakeTrack(`mic-${++micCount}`)]);
    },
    createAudioElement: () => new FakeAudio(),
    location: { origin: "https://host.example", href: "https://host.example/page" },
  };

  return {
    environment,
    sockets,
    peers,
    micRequests,
    denyMicrophone(name = "NotAllowedError") {
      deny = name;
    },
    socket() {
      const s = sockets[sockets.length - 1];
      if (!s) throw new Error("no socket opened yet");
      return s;
    },
    peer() {
      const p = peers[peers.length - 1];
      if (!p) throw new Error("no peer connection yet");
      return p;
    },
  };
}
