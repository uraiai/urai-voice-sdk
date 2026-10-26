# Urai Voice SDK

npm packages for embedding Urai voice agents in web apps. A call runs over
WebRTC, and the agent can drive your page: **client tools** run in the
visitor's browser and return their result to the agent, and **commands**
from server-side tools (including `displayComponent`) reach your handlers.

| Package | What it is |
|---|---|
| [`@uraiai/voice-core`](packages/voice-core) | Framework-agnostic engine (`createVoiceClient`), plus `/headless` for the DOM-free store, timeline and tool registry |
| [`@uraiai/voice-react`](packages/voice-react) | React provider and hooks (a modular inline UI comes next) |

## Before you start: allow your origin

urai-voice checks the `Origin` header of the signaling WebSocket against the
agent's **allowed domains** (the agent's embed settings in Urai studio). Add
your app's origin (e.g. `http://localhost:5180`) there or the connection is
refused with a 403.

## Quick start (vanilla)

```ts
import { createVoiceClient } from "@uraiai/voice-core";

const voice = createVoiceClient({
  baseUrl: "https://<your urai-voice host>",
  agentId: "<agent id>",
  vars: { customer_id: "c-123" },
  tools: [
    {
      name: "go_to_page",
      description: "Open a page in the app when the user asks to see it.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "App path, e.g. /orders" } },
        required: ["path"],
      },
      handler: ({ path }) => {
        router.push(path);
        return { ok: true };
      },
    },
  ],
});

voice.store.subscribe(() => render(voice.store.getSnapshot()));
voice.onCommand("highlight", (cmd) => highlight(cmd.selector));

button.onclick = () => voice.start(); // from a user gesture, so audio can play
```

See the [core README](packages/voice-core) for the full API.

## Example app

`examples/react-demo` (port 5180) is a small store page that an agent drives
through client tools, with a raw event log. Use it to try the SDK against a
local urai-voice server; the [README](examples/react-demo) covers setup.

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # vitest (node project for headless, jsdom for the client)
pnpm typecheck
```

Tests never touch a real network or microphone. `@uraiai/voice-test-support`
fakes the signaling server, `RTCPeerConnection`, `MediaStream` and
`getUserMedia`.

## Releasing

Same flow as urai-chat-sdk: every PR that changes a package carries a
changeset (`pnpm changeset`), and the manual `Release` workflow runs twice.
The first run opens the "Version Packages" PR. The second run, after that PR
merges, publishes to npm. It needs an `NPM_TOKEN` secret for the `@uraiai`
scope.
