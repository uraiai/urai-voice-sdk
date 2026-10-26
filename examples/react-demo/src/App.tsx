import {
  UraiVoiceProvider,
  useAudioLevels,
  useClientTool,
  useTranscript,
  useVoiceCall,
  useVoiceClient,
  useVoiceCommand,
  useVoiceEvent,
  type TimelineItem,
} from "@uraiai/voice-react";
import { useEffect, useRef, useState, type ComponentType, type FormEvent } from "react";
import { CATALOG, findProduct, PAGES, searchProducts, type CartLine, type Page } from "./catalog";

const BASE_URL = import.meta.env.VITE_URAI_BASE_URL as string | undefined;
const AGENT_ID = import.meta.env.VITE_URAI_AGENT_ID as string | undefined;

const ORDERS = [
  { id: "A-1042", status: "Shipped", eta: "Oct 28", items: ["TENT-2P", "LAMP-300"] },
  { id: "A-0977", status: "Delivered", eta: "Oct 12", items: ["STOVE-JET"] },
];

export function App() {
  const [customerName, setCustomerName] = useState("Sam");
  if (!BASE_URL || !AGENT_ID) return <SetupHelp />;
  return (
    <UraiVoiceProvider baseUrl={BASE_URL} agentId={AGENT_ID} vars={{ customer_name: customerName }}>
      <Store customerName={customerName} onCustomerName={setCustomerName} />
    </UraiVoiceProvider>
  );
}

function SetupHelp() {
  return (
    <main className="setup">
      <h1>Urai Voice demo</h1>
      <p>
        Create <code>examples/react-demo/.env.local</code> with <code>VITE_URAI_BASE_URL</code> and{" "}
        <code>VITE_URAI_AGENT_ID</code>, then restart <code>pnpm dev</code>. See the README.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------- the store

function Store({ customerName, onCustomerName }: { customerName: string; onCustomerName(n: string): void }) {
  const [page, setPage] = useState<Page>("products");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!highlighted) return;
    document.getElementById(`product-${highlighted}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlighted(null), 2500);
    return () => clearTimeout(t);
  }, [highlighted]);

  const addToCart = (sku: string, quantity: number) =>
    setCart((lines) => {
      const existing = lines.find((l) => l.sku === sku);
      if (existing) return lines.map((l) => (l.sku === sku ? { ...l, quantity: l.quantity + quantity } : l));
      return [...lines, { sku, quantity }];
    });

  // ---- client tools: the agent drives this page through these ----

  useClientTool(
    {
      name: "go_to_page",
      description: "Show a page of the store when the user asks to see it: products, cart or orders.",
      parameters: {
        type: "object",
        properties: { page: { type: "string", enum: [...PAGES], description: "The page to show" } },
        required: ["page"],
      },
    },
    ({ page: next }: { page: string }) => {
      if (!(PAGES as readonly string[]).includes(next)) throw new Error(`Unknown page "${next}"`);
      setPage(next as Page);
      return { ok: true, page: next };
    },
  );

  useClientTool(
    {
      name: "search_products",
      description: "Search the catalog. Returns matching products with sku, name and price. Also filters the product page.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Words to search for, e.g. 'tent' or 'stove'" } },
        required: ["query"],
      },
    },
    ({ query: q }: { query: string }) => {
      setQuery(q);
      setPage("products");
      return { products: searchProducts(q).map(({ sku, name, price }) => ({ sku, name, price })) };
    },
  );

  useClientTool(
    {
      name: "add_to_cart",
      description: "Add a product to the cart by sku once the user has confirmed which product they want.",
      parameters: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Product sku from search_products" },
          quantity: { type: "integer", description: "How many, default 1" },
        },
        required: ["sku"],
      },
    },
    ({ sku, quantity }: { sku: string; quantity?: number }) => {
      const product = findProduct(sku);
      if (!product) throw new Error(`No product with sku ${sku}`);
      addToCart(product.sku, Math.max(1, quantity ?? 1));
      setHighlighted(product.sku);
      return { ok: true, added: product.name };
    },
  );

  useClientTool(
    {
      name: "get_cart",
      description: "Read the cart: line items, quantities and the total in USD.",
    },
    () => {
      const lines = cart.map((l) => {
        const p = findProduct(l.sku)!;
        return { sku: l.sku, name: p.name, quantity: l.quantity, subtotal: p.price * l.quantity };
      });
      return { lines, total: lines.reduce((sum, l) => sum + l.subtotal, 0) };
    },
  );

  useClientTool(
    {
      name: "highlight_product",
      description: "Scroll to a product on the products page and flash it, to point the user at it.",
      parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
    },
    ({ sku }: { sku: string }) => {
      const product = findProduct(sku);
      if (!product) throw new Error(`No product with sku ${sku}`);
      setQuery("");
      setPage("products");
      setHighlighted(product.sku);
      return { ok: true };
    },
  );

  // Commands from server-side (remote) tools.
  useVoiceCommand("navigate", (cmd) => {
    if (typeof cmd.page === "string" && (PAGES as readonly string[]).includes(cmd.page)) setPage(cmd.page as Page);
  });

  const products = query ? searchProducts(query) : CATALOG;
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="layout">
      <section className="store">
        <header className="store-header">
          <h1>Acme Outfitters</h1>
          <label className="customer">
            Customer name <input value={customerName} onChange={(e) => onCustomerName(e.target.value)} />
          </label>
        </header>
        <nav className="tabs">
          {PAGES.map((p) => (
            <button key={p} className={p === page ? "active" : ""} onClick={() => setPage(p)}>
              {p === "cart" ? `cart (${cartCount})` : p}
            </button>
          ))}
        </nav>

        {page === "products" && (
          <>
            {query && (
              <p className="filter">
                Results for “{query}” <button onClick={() => setQuery("")}>clear</button>
              </p>
            )}
            <div className="grid">
              {products.map((p) => (
                <article key={p.sku} id={`product-${p.sku}`} className={`product ${highlighted === p.sku ? "flash" : ""}`}>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <footer>
                    <span>${p.price}</span>
                    <button onClick={() => addToCart(p.sku, 1)}>Add</button>
                  </footer>
                </article>
              ))}
            </div>
          </>
        )}

        {page === "cart" && (
          <div className="list">
            {cart.length === 0 && <p className="muted">The cart is empty.</p>}
            {cart.map((l) => {
              const p = findProduct(l.sku)!;
              return (
                <div key={l.sku} className="row">
                  <span>
                    {l.quantity} × {p.name}
                  </span>
                  <span>${p.price * l.quantity}</span>
                </div>
              );
            })}
          </div>
        )}

        {page === "orders" && (
          <div className="list">
            {ORDERS.map((o) => (
              <OrderCard key={o.id} {...o} />
            ))}
          </div>
        )}
      </section>

      <VoicePanel />
    </div>
  );
}

// ------------------------------------------------- components the agent shows

function OrderCard(props: Record<string, unknown>) {
  const items = Array.isArray(props.items) ? (props.items as string[]) : [];
  return (
    <div className="card">
      <strong>Order {String(props.id ?? "?")}</strong> <span className="badge">{String(props.status ?? "")}</span>
      <div className="muted">ETA {String(props.eta ?? "—")}</div>
      <div>{items.map((sku) => findProduct(sku)?.name ?? sku).join(", ")}</div>
    </div>
  );
}

function ProductCard(props: Record<string, unknown>) {
  const p = typeof props.sku === "string" ? findProduct(props.sku) : undefined;
  if (!p) return <div className="card muted">Unknown product</div>;
  return (
    <div className="card">
      <strong>{p.name}</strong> <span className="badge">${p.price}</span>
      <div className="muted">{p.description}</div>
    </div>
  );
}

/** What `displayComponent` commands may render, by name. */
const COMPONENTS: Record<string, ComponentType<Record<string, unknown>>> = { OrderCard, ProductCard };

// -------------------------------------------------------------- voice panel

function VoicePanel() {
  const call = useVoiceCall();
  return (
    <aside className="voice">
      <div className="voice-head">
        <span className={`status status-${call.status}`}>{call.status}</span>
        {call.agent && <span className="muted">with {call.agent.name}</span>}
      </div>
      <div className="controls">
        {call.isActive ? (
          <button className="danger" onClick={call.end}>
            Hang up
          </button>
        ) : (
          <button className="primary" onClick={() => void call.start()}>
            {call.status === "ended" || call.status === "error" ? "Call again" : "Start call"}
          </button>
        )}
        <button disabled={call.status !== "connected"} onClick={call.toggleMute}>
          {call.muted ? "Unmute" : "Mute"}
        </button>
        <MicPicker />
      </div>
      <Levels />
      {call.error && <p className="error">{call.error}</p>}
      {call.status === "ended" && call.endReason && <p className="muted">Call ended ({call.endReason}).</p>}
      <Timeline />
      <Composer disabled={call.status !== "connected"} onSend={call.sendText} />
      <EventLog />
    </aside>
  );
}

function MicPicker() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const { status } = useVoiceCall();
  const client = useVoiceClient();
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId)))
      .catch(() => {});
  }, [status]);
  if (devices.length < 2) return null;
  return (
    <select onChange={(e) => void client?.setInputDevice(e.target.value || undefined)} defaultValue="">
      <option value="">Default mic</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || "Microphone"}
        </option>
      ))}
    </select>
  );
}

function Levels() {
  const { input, output, userSpeaking, agentSpeaking } = useAudioLevels();
  return (
    <div className="levels">
      <Meter label={userSpeaking ? "You (speaking)" : "You"} value={input} />
      <Meter label={agentSpeaking ? "Agent (speaking)" : "Agent"} value={output} />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="bar">
        <div style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

function Timeline() {
  const items = useTranscript();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: Chrome's scrollIntoView returns a Promise, which React
    // would take for a cleanup function.
    end.current?.scrollIntoView({ block: "end" });
  }, [items]);
  return (
    <div className="timeline">
      {items.length === 0 && <p className="muted">The conversation shows up here.</p>}
      {items.map((item) => (
        <TimelineEntry key={item.id} item={item} />
      ))}
      <div ref={end} />
    </div>
  );
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return (
        <div className={`msg msg-${item.role} ${item.final ? "" : "interim"}`}>
          {item.text}
          {item.interrupted && <span className="muted"> (interrupted)</span>}
          {item.typed && <span className="muted"> (typed)</span>}
        </div>
      );
    case "tool":
      return (
        <div className={`tool tool-${item.status}`}>
          {item.client ? "🖥" : "⚙"} {item.name} <span className="muted">{item.status}</span>
        </div>
      );
    case "component": {
      const Component = COMPONENTS[item.component];
      return Component ? <Component {...item.props} /> : <div className="card muted">Unknown component {item.component}</div>;
    }
    case "notice":
      return (
        <div className="notice">
          {item.notice.type === "agent-changed" ? `Now talking to ${item.notice.agentName}` : item.notice.message}
        </div>
      );
  }
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend(text: string): void }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(text);
    setText("");
  };
  return (
    <form className="composer" onSubmit={submit}>
      <input value={text} disabled={disabled} placeholder="Type into the call…" onChange={(e) => setText(e.target.value)} />
      <button disabled={disabled || !text.trim()}>Send</button>
    </form>
  );
}

/** Raw client events, newest first — the debugging view for the verification loop. */
function EventLog() {
  const [events, setEvents] = useState<{ t: string; name: string; detail: string }[]>([]);
  const log = (name: string) => (e: unknown) =>
    setEvents((prev) =>
      [{ t: new Date().toLocaleTimeString(), name, detail: JSON.stringify(e) }, ...prev].slice(0, 200),
    );
  useVoiceEvent("status", log("status"));
  useVoiceEvent("call-started", log("call-started"));
  useVoiceEvent("agent-changed", log("agent-changed"));
  useVoiceEvent("command", log("command"));
  useVoiceEvent("tool-call", log("tool-call"));
  useVoiceEvent("tool-result", log("tool-result"));
  useVoiceEvent("client-tool-call", log("client-tool-call"));
  useVoiceEvent("client-tool-result", log("client-tool-result"));
  useVoiceEvent("error", log("error"));
  useVoiceEvent("ended", log("ended"));
  return (
    <details className="events">
      <summary>Event log ({events.length})</summary>
      <ol>
        {events.map((e, i) => (
          <li key={i}>
            <span className="muted">{e.t}</span> <strong>{e.name}</strong> <code>{e.detail}</code>
          </li>
        ))}
      </ol>
    </details>
  );
}
