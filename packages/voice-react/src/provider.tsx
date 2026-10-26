import {
  createVoiceClient,
  type ClientTool,
  type VoiceClient,
  type VoiceClientOptions,
} from "@uraiai/voice-core";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const VoiceContext = createContext<VoiceClient | null | undefined>(undefined);

export interface UraiVoiceProviderProps extends Omit<VoiceClientOptions, "tools"> {
  children?: ReactNode;
  /**
   * Client tools registered when the client is created. Tools that need
   * component state (a router, a form) are easier with `useClientTool`.
   */
  tools?: ClientTool[];
  /** Use a client you created yourself; the provider then never destroys it. */
  client?: VoiceClient;
}

/**
 * Owns one `VoiceClient` for its subtree. The client is created after mount,
 * so the first render (and SSR) sees the idle state and no browser API is
 * touched until `start()`. A new `baseUrl` or `agentId` makes a new client
 * and ends any call in progress; `vars` changes apply to the next call.
 */
export function UraiVoiceProvider({ children, client: external, ...options }: UraiVoiceProviderProps) {
  const [owned, setOwned] = useState<VoiceClient | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (external) return;
    const { baseUrl, agentId, ...rest } = latest.current;
    const client = createVoiceClient({ baseUrl, agentId, ...rest });
    setOwned(client);
    return () => {
      client.destroy();
      setOwned((current) => (current === client ? null : current));
    };
  }, [external, options.baseUrl, options.agentId]);

  const client = external ?? owned;
  const varsKey = JSON.stringify(options.vars ?? {});
  useEffect(() => {
    client?.setVars(latest.current.vars ?? {});
  }, [client, varsKey]);

  return <VoiceContext.Provider value={client}>{children}</VoiceContext.Provider>;
}

/** The provider's client, or `null` before it mounts. */
export function useVoiceClient(): VoiceClient | null {
  const client = useContext(VoiceContext);
  if (client === undefined) {
    throw new Error("Urai voice hooks must be used inside <UraiVoiceProvider>.");
  }
  return client;
}
