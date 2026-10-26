import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEnvironment, flush, type FakeEnvironment } from "@uraiai/voice-test-support";
import {
  UraiVoiceProvider,
  useClientTool,
  useTranscript,
  useVoiceCall,
  useVoiceCommand,
} from "../src";

// No vitest globals, so Testing Library cannot register this itself.
afterEach(cleanup);

function wrapper(fake: FakeEnvironment, extra: Record<string, unknown> = {}) {
  return ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <UraiVoiceProvider baseUrl="https://voice.example" agentId="agent-1" environment={fake.environment} {...extra}>
        {children}
      </UraiVoiceProvider>
    </StrictMode>
  );
}

/** Plays the server side of a call until media connects. */
async function connect(fake: FakeEnvironment) {
  await act(async () => {
    await flush();
  });
  const ws = fake.socket();
  await act(async () => {
    ws.open();
    ws.serverSend({ type: "iceServers", iceServers: [] });
    await flush();
    ws.serverSend({ type: "sdpAnswer", sdp: "a" });
    await flush();
    fake.peer().setState("connected");
    await flush();
  });
  return ws;
}

describe("UraiVoiceProvider", () => {
  it("throws a clear error outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useVoiceCall())).toThrow(/UraiVoiceProvider/);
  });

  it("starts idle, then runs a call through the hooks", async () => {
    const fake = createFakeEnvironment();
    const { result } = renderHook(() => ({ call: useVoiceCall(), items: useTranscript() }), {
      wrapper: wrapper(fake),
    });
    expect(result.current.call.status).toBe("idle");
    await waitFor(() => expect(result.current.call.start).toBeDefined());

    act(() => {
      void result.current.call.start();
    });
    const ws = await connect(fake);
    expect(result.current.call).toMatchObject({ status: "connected", isActive: true });

    act(() => ws.serverSend({ type: "aiTranscription", text: "Hello", isFinal: true }));
    expect(result.current.items).toMatchObject([{ kind: "message", role: "agent", text: "Hello" }]);

    act(() => result.current.call.toggleMute());
    expect(result.current.call.muted).toBe(true);

    act(() => result.current.call.end());
    expect(result.current.call).toMatchObject({ status: "ended", endReason: "user", isActive: false });
  });

  it("sends the latest vars with the call", async () => {
    const fake = createFakeEnvironment();
    function App() {
      const [id, setId] = useState("c-1");
      return (
        <UraiVoiceProvider baseUrl="https://voice.example" agentId="a" environment={fake.environment} vars={{ customer_id: id }}>
          <button onClick={() => setId("c-2")}>change</button>
          <Starter />
        </UraiVoiceProvider>
      );
    }
    function Starter() {
      const { start } = useVoiceCall();
      return <button onClick={() => void start()}>start</button>;
    }
    render(<App />);
    act(() => screen.getByText("change").click());
    act(() => screen.getByText("start").click());
    const ws = await connect(fake);
    expect(ws.sentOfType("initialMetadata")[0].metadata.customer_id).toBe("c-2");
  });
});

describe("useClientTool", () => {
  it("declares the tool once and calls the latest handler", async () => {
    const fake = createFakeEnvironment();
    function Tools({ label }: { label: string }) {
      useClientTool({ name: "whoami", description: "Returns the label" }, () => ({ label }));
      const { start } = useVoiceCall();
      return <button onClick={() => void start()}>start</button>;
    }
    const Wrapper = wrapper(fake);
    const { rerender } = render(<Tools label="first" />, { wrapper: Wrapper });
    rerender(<Tools label="second" />);
    act(() => screen.getByText("start").click());
    const ws = await connect(fake);

    expect(ws.sentOfType("initialMetadata")[0].metadata._client_tools.map((t: any) => t.name)).toEqual(["whoami"]);
    await act(async () => {
      ws.serverSend({ type: "clientToolCall", callId: "c1", name: "whoami", arguments: {} });
      await flush();
    });
    expect(ws.sentOfType("clientToolResult")).toEqual([
      { type: "clientToolResult", callId: "c1", result: { label: "second" } },
    ]);
  });

  it("unregisters when the component unmounts", async () => {
    const fake = createFakeEnvironment();
    function Tool() {
      useClientTool({ name: "temp", description: "d" }, () => null);
      return null;
    }
    function App() {
      const [show, setShow] = useState(true);
      const { start } = useVoiceCall();
      return (
        <>
          {show && <Tool />}
          <button onClick={() => setShow(false)}>hide</button>
          <button onClick={() => void start()}>start</button>
        </>
      );
    }
    render(<App />, { wrapper: wrapper(fake) });
    await act(async () => {
      await flush();
    });
    act(() => screen.getByText("hide").click());
    act(() => screen.getByText("start").click());
    const ws = await connect(fake);
    expect(ws.sentOfType("initialMetadata")[0].metadata._client_tools).toEqual([]);
  });
});

describe("useVoiceCommand", () => {
  it("delivers named commands to the latest handler", async () => {
    const fake = createFakeEnvironment();
    const handler = vi.fn();
    const { result } = renderHook(
      () => {
        useVoiceCommand("navigate", handler);
        return useVoiceCall();
      },
      { wrapper: wrapper(fake) },
    );
    await act(async () => {
      await flush();
    });
    act(() => {
      void result.current.start();
    });
    const ws = await connect(fake);
    act(() => ws.serverSend({ type: "command", command: { command: "navigate", path: "/cart" } }));
    expect(handler).toHaveBeenCalledWith({ command: "navigate", path: "/cart" });
  });
});
