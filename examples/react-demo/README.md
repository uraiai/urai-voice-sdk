# react-demo

A small store page that a voice agent drives through client tools, built on
`@uraiai/voice-react`. Use it to try the SDK against a local urai-voice
server. The event log at the bottom of the voice panel shows every client
event.

## Setup

1. **Run urai-voice locally.** It listens on `:4545` unless `LISTEN_ADDR`
   says otherwise.
2. **Create an agent** in the studio. Paste `agent/SYSTEM_PROMPT.md` as its
   prompt and enable the built-in `hangup` tool. `customer_name` comes from
   the page's `vars`.
3. **Allow the demo's origin and turn on client tools:**
   ```bash
   cd urai-voice
   cargo run --bin voice-admin -- enable-embed \
     --agent-id <agent id> --domains localhost:5180 --client-tools true
   ```
   You can also use the agent's embed settings in the studio: add
   `localhost:5180` and switch on **Client tools (voice SDK)**.
4. **Configure the demo:** copy `.env.example` to `.env.local` and fill in
   `VITE_URAI_AGENT_ID`.
5. **Start it:** `pnpm --filter react-demo dev`, then open
   http://localhost:5180.

## Things to try

- **Greeting:** the agent's greeting should play from its first word.
- **Search:** "Do you have a tent?" calls `search_products`, which filters
  the page, and the agent answers with what it found.
- **Add to cart:** "Add two headlamps" calls `add_to_cart`, the product
  flashes, and the cart count goes up.
- **Read the cart:** "What's in my cart?" calls `get_cart`, a tool whose
  result the agent reads back.
- **Hang up:** "That's all, thanks" makes the agent say goodbye and call
  `hangup`. The call ends after the goodbye has played, and the panel shows
  `Call ended (agent)`.
- **Typing:** type into the call while it's connected.
