# @uraiai/voice-core

Framework-agnostic engine for Urai voice calls.

```ts
import { createVoiceClient } from "@uraiai/voice-core";

const voice = createVoiceClient({ baseUrl, agentId, vars, tools });
await voice.start();   // resolves when connected or failed; never rejects
voice.setMuted(true);
voice.sendText("Order 42");
voice.end();
```

## State

`voice.store` works with `useSyncExternalStore` (`getSnapshot` / `subscribe`):

| Field | |
|---|---|
| `status` | `idle`, `requesting-mic`, `connecting`, `connected`, `ended` or `error` |
| `error` | Why the call failed, or the last server error |
| `muted`, `agentSpeaking`, `userSpeaking` | Speaking flags come from audio levels when `AudioContext` exists, otherwise from transcripts |
| `agent` | `{ id, name }`, updated on handoff |
| `callSid` | Set once the server announces the call |
| `items` | The timeline: `message`, `tool`, `component` and `notice` items, in order |

`voice.levels` holds `{ input, output }` loudness (0–1). It ticks about 20 times a second, so it is a separate store.

## Client tools

Tools are declared when the call starts. `tools.register()` during a call takes effect on the next call. `tools.setHandler()` swaps a handler at any time.

```ts
const off = voice.tools.register({
  name: "add_to_cart",            // letter first, then letters, digits, _
  description: "Add a product to the cart when the user asks.",
  parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
  timeoutMs: 5000,                // default 10 s, max 30 s
  handler: async ({ sku }, { signal }) => cart.add(sku, { signal }),
});
```

- **Results:** the handler's return value is sent to the agent as the tool result. A throw or rejection is sent as `{ error }`.
- **Abort:** `signal` aborts on timeout or hang-up.
- **Limits:** at most 16 tools, each with a description of at most 1024 characters.

## Commands

Server-side tools can send commands to the page. `onCommand(name, handler)` matches on the payload's `command` (or `type`) field. Payloads are untrusted input, so validate them.

`{ command: "displayComponent", component, props }` also adds a `component` item to the timeline, for a UI to render.

## Events

`voice.on(name, listener)` emits the following events:
- `status`, `call-started`, `agent-changed`, `transcript`, `command`;
- `tool-call`, `tool-result`, `client-tool-call`, `client-tool-result`;
- `final-transcripts`, `usage`, `error`, `ended`.

## Headless

`@uraiai/voice-core/headless` exports the pure pieces: `reduceTimeline`, `toVoiceEvent`, `createToolRegistry`, `createStore` and the wire types. It is meant for building other bindings.
