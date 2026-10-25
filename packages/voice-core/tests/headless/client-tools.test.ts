import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry, MAX_CLIENT_TOOLS, toDeclaration } from "../../src/headless/client-tools";

const tool = (name: string, handler: (args: any, ctx: any) => unknown = () => "ok", timeoutMs?: number) => ({
  name,
  description: `The ${name} tool`,
  handler,
  ...(timeoutMs ? { timeoutMs } : {}),
});

afterEach(() => vi.useRealTimers());

describe("toDeclaration", () => {
  it("defaults parameters to an empty object schema", () => {
    expect(toDeclaration({ name: "a", description: "d" })).toEqual({
      name: "a",
      description: "d",
      parameters: { type: "object", properties: {} },
    });
  });

  it("rejects bad names, missing descriptions and non-object schemas", () => {
    expect(() => toDeclaration({ name: "1bad", description: "d" })).toThrow(/name/);
    expect(() => toDeclaration({ name: "go-to", description: "d" })).toThrow(/name/);
    expect(() => toDeclaration({ name: "a", description: " " })).toThrow(/description/);
    expect(() => toDeclaration({ name: "a", description: "x".repeat(1025) })).toThrow(/1024/);
    expect(() => toDeclaration({ name: "a", description: "d", parameters: { type: "string" } })).toThrow(/object/);
  });

  it("clamps the timeout to 30 s", () => {
    expect(toDeclaration({ name: "a", description: "d", timeoutMs: 120_000 }).timeoutMs).toBe(30_000);
  });
});

describe("createToolRegistry", () => {
  it("rejects duplicates and caps the count", () => {
    const r = createToolRegistry();
    r.register(tool("a"));
    expect(() => r.register(tool("a"))).toThrow(/already/);
    for (let i = 1; i < MAX_CLIENT_TOOLS; i++) r.register(tool(`t${i}`));
    expect(() => r.register(tool("extra"))).toThrow(/At most/);
  });

  it("unregister only removes the registration it returned", () => {
    const r = createToolRegistry();
    const off = r.register(tool("a"));
    off();
    r.register(tool("a"));
    off();
    expect(r.has("a")).toBe(true);
  });

  it("runs the handler and returns a JSON-safe result", async () => {
    const r = createToolRegistry();
    r.register(tool("go", (args) => ({ went: args.path, at: undefined })));
    expect(await r.dispatch({ callId: "1", name: "go", arguments: { path: "/x" } })).toEqual({
      callId: "1",
      result: { went: "/x" },
    });
    r.register(tool("nothing", () => undefined));
    expect(await r.dispatch({ callId: "2", name: "nothing", arguments: null })).toEqual({ callId: "2", result: null });
  });

  it("turns throws and rejections into errors", async () => {
    const r = createToolRegistry();
    r.register(tool("boom", () => { throw new Error("nope"); }));
    r.register(tool("reject", () => Promise.reject(new Error("later"))));
    expect(await r.dispatch({ callId: "1", name: "boom", arguments: {} })).toEqual({ callId: "1", error: "nope" });
    expect(await r.dispatch({ callId: "2", name: "reject", arguments: {} })).toEqual({ callId: "2", error: "later" });
  });

  it("answers unknown tools with an error", async () => {
    const r = createToolRegistry();
    expect(await r.dispatch({ callId: "1", name: "ghost", arguments: {} })).toMatchObject({ error: /not available/ });
  });

  it("times out slow handlers and aborts their signal", async () => {
    vi.useFakeTimers();
    const r = createToolRegistry();
    let signal: AbortSignal | null = null;
    r.register(tool("slow", (_a, ctx) => { signal = ctx.signal; return new Promise(() => {}); }, 500));
    const reply = r.dispatch({ callId: "1", name: "slow", arguments: {} });
    await vi.advanceTimersByTimeAsync(500);
    expect(await reply).toEqual({ callId: "1", error: "Client tool timed out" });
    expect(signal!.aborted).toBe(true);
  });

  it("abortAll ends running handlers", async () => {
    const r = createToolRegistry();
    r.register(tool("slow", () => new Promise(() => {})));
    const reply = r.dispatch({ callId: "1", name: "slow", arguments: {} });
    r.abortAll();
    expect(await reply).toEqual({ callId: "1", error: "The call ended" });
  });

  it("freezes declarations for a call; later tools wait for the next call", async () => {
    const warnings: string[] = [];
    const r = createToolRegistry({ onWarning: (m) => warnings.push(m) });
    r.register(tool("a"));
    expect(r.freeze().map((d) => d.name)).toEqual(["a"]);
    r.register(tool("b"));
    expect(warnings[0]).toMatch(/next call/);
    expect(await r.dispatch({ callId: "1", name: "b", arguments: {} })).toMatchObject({ error: /not available/ });
    r.unfreeze();
    expect(r.freeze().map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("setHandler swaps the handler without touching the declaration", async () => {
    const r = createToolRegistry();
    r.register(tool("a", () => 1));
    r.setHandler("a", () => 2);
    expect(await r.dispatch({ callId: "1", name: "a", arguments: {} })).toEqual({ callId: "1", result: 2 });
  });
});
