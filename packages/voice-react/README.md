# @uraiai/voice-react

React provider and hooks for Urai voice calls, built on `@uraiai/voice-core`.

```tsx
import {
  UraiVoiceProvider,
  useClientTool,
  useTranscript,
  useVoiceCall,
} from "@uraiai/voice-react";

<UraiVoiceProvider baseUrl={VOICE_URL} agentId={AGENT_ID} vars={{ customer_id }}>
  <App />
</UraiVoiceProvider>;

function CallButton() {
  const { status, isActive, start, end, muted, toggleMute } = useVoiceCall();
  return isActive ? <button onClick={end}>Hang up</button> : <button onClick={() => start()}>Call</button>;
}

function Checkout() {
  const navigate = useNavigate();
  useClientTool(
    {
      name: "go_to_page",
      description: "Open a page in the app when the user asks to see it.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    ({ path }) => {
      navigate(path);
      return { ok: true };
    },
  );
  return null;
}
```

## Provider

`<UraiVoiceProvider>` takes the `createVoiceClient` options:
- `baseUrl` and `agentId`: changing either creates a new client and ends any call in progress.
- `vars`: applied to the next call.
- `tools`, `audio`, `connectTimeoutMs`, `environment`.
- `client`: pass a client you created yourself.

The client is created after mount, so SSR and the first render see the idle state. It is safe under StrictMode.

## Hooks

| Hook | Returns |
|---|---|
| `useVoiceCall()` | `status`, `error`, `endReason`, `muted`, `agent`, `callSid`, `isActive`, `start`, `end`, `setMuted`, `toggleMute`, `sendText` |
| `useTranscript()` | Timeline items: `message`, `tool`, `component`, `notice` |
| `useAudioLevels()` | `input`, `output` (0–1, ~20 updates a second), `userSpeaking`, `agentSpeaking` |
| `useClientTool(def, handler)` | Registers a tool while mounted. The handler can use fresh props and state; changing the definition applies from the next call. |
| `useVoiceCommand(name, handler)` | Commands from server-side tools |
| `useVoiceEvent(name, listener)` | Any client event (`transcript`, `tool-call`, `ended`, …) |
| `useVoiceSelector(selector, isEqual?)` | Any slice of the state |
| `useVoiceClient()` | The `VoiceClient` itself, or `null` before mount |

## Rendering components

When a server-side tool sends `{ command: "displayComponent", component, props }`, `useTranscript()` returns a `component` item. Render it from your own registry:

```tsx
const COMPONENTS = { OrderCard };
const Component = COMPONENTS[item.component];
return Component ? <Component {...item.props} /> : null;
```

The example app (`examples/react-demo`) does all of this end to end.
