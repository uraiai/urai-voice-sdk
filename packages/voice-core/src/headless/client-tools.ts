/**
 * Client tools: functions the agent can call that run in the visitor's
 * browser, typically to drive the host page (navigate, fill a form,
 * highlight a product). The declarations go to the server when the call
 * starts; the handlers never leave the page.
 *
 * The limits mirror the server's, so a bad declaration fails here, loudly,
 * instead of being dropped on the server.
 */
import type { ClientToolDeclaration, JsonSchema } from "../protocol";
import { isPlainObject } from "./components";

export const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const MAX_CLIENT_TOOLS = 16;
export const MAX_TOOL_DESCRIPTION = 1024;
export const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
export const MAX_TOOL_TIMEOUT_MS = 30_000;

export interface ClientToolContext {
  callId: string;
  /** Aborted when the call times out or the call ends. */
  signal: AbortSignal;
}

export type ClientToolHandler<Args = any> = (
  args: Args,
  ctx: ClientToolContext,
) => unknown | Promise<unknown>;

export interface ClientToolDefinition {
  name: string;
  /** Tells the model when to call the tool. Write it like a prompt. */
  description: string;
  /** JSON Schema of the arguments. Defaults to an object with no properties. */
  parameters?: JsonSchema;
  /** How long the server waits for the result. Default 10 s, maximum 30 s. */
  timeoutMs?: number;
}

export interface ClientTool<Args = any> extends ClientToolDefinition {
  handler: ClientToolHandler<Args>;
}

/** Typed identity helper: `defineClientTool<{ path: string }>({ ... })`. */
export function defineClientTool<Args = any>(tool: ClientTool<Args>): ClientTool<Args> {
  return tool;
}

export function toDeclaration(def: ClientToolDefinition): ClientToolDeclaration {
  if (!TOOL_NAME.test(def.name)) {
    throw new Error(
      `Invalid client tool name "${def.name}": use a letter, then letters, digits or _ (max 64).`,
    );
  }
  if (!def.description?.trim()) {
    throw new Error(`Client tool "${def.name}" needs a description.`);
  }
  if (def.description.length > MAX_TOOL_DESCRIPTION) {
    throw new Error(
      `Client tool "${def.name}": description is over ${MAX_TOOL_DESCRIPTION} characters.`,
    );
  }
  const parameters = def.parameters ?? { type: "object", properties: {} };
  if (!isPlainObject(parameters) || parameters.type !== "object") {
    throw new Error(`Client tool "${def.name}": parameters must be an object schema.`);
  }
  const timeoutMs =
    def.timeoutMs === undefined
      ? undefined
      : Math.min(Math.max(1, Math.floor(def.timeoutMs)), MAX_TOOL_TIMEOUT_MS);
  return {
    name: def.name,
    description: def.description,
    parameters,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export type ToolResultMessage =
  | { callId: string; result: unknown }
  | { callId: string; error: string };

export interface ToolRegistry {
  /** Adds a tool and returns a function that removes it. Throws on a bad or duplicate tool. */
  register(tool: ClientTool): () => void;
  /** Swaps the handler of a registered tool; its declaration is unchanged. */
  setHandler(name: string, handler: ClientToolHandler): void;
  has(name: string): boolean;
  /**
   * Freezes the declarations for a call and returns them. Tools registered
   * after this reach the server on the next call only.
   */
  freeze(): ClientToolDeclaration[];
  unfreeze(): void;
  /** Runs a call from the server and resolves to the message to send back. */
  dispatch(call: { callId: string; name: string; arguments: unknown }): Promise<ToolResultMessage>;
  /** Aborts every running handler (the call ended). */
  abortAll(): void;
}

export interface ToolRegistryOptions {
  onWarning?: (message: string) => void;
}

interface Entry {
  declaration: ClientToolDeclaration;
  handler: ClientToolHandler;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : "Client tool failed";
}

/** JSON-safe result: `undefined` becomes `null`, and values that cannot be serialized are an error. */
function serializable(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const entries = new Map<string, Entry>();
  const running = new Set<AbortController>();
  let frozen: Set<string> | null = null;
  const warn = options.onWarning ?? ((m: string) => console.warn(`[urai-voice] ${m}`));

  return {
    register(tool) {
      const declaration = toDeclaration(tool);
      if (entries.has(tool.name)) {
        throw new Error(`Client tool "${tool.name}" is already registered.`);
      }
      if (entries.size >= MAX_CLIENT_TOOLS) {
        throw new Error(`At most ${MAX_CLIENT_TOOLS} client tools can be registered.`);
      }
      const entry: Entry = { declaration, handler: tool.handler };
      entries.set(tool.name, entry);
      if (frozen && !frozen.has(tool.name)) {
        warn(`Client tool "${tool.name}" was registered during a call; it is available from the next call.`);
      }
      return () => {
        if (entries.get(tool.name) === entry) entries.delete(tool.name);
      };
    },
    setHandler(name, handler) {
      const entry = entries.get(name);
      if (entry) entry.handler = handler;
    },
    has: (name) => entries.has(name),
    freeze() {
      frozen = new Set(entries.keys());
      return [...entries.values()].map((e) => e.declaration);
    },
    unfreeze() {
      frozen = null;
    },
    async dispatch({ callId, name, arguments: args }) {
      const entry = entries.get(name);
      if (!entry || (frozen && !frozen.has(name))) {
        return { callId, error: `Client tool "${name}" is not available on this page.` };
      }
      const controller = new AbortController();
      running.add(controller);
      const timeoutMs = entry.declaration.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(new Error("Client tool timed out")), timeoutMs);
      try {
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        });
        const result = await Promise.race([
          Promise.resolve().then(() => entry.handler(args ?? {}, { callId, signal: controller.signal })),
          aborted,
        ]);
        return { callId, result: serializable(result) };
      } catch (err) {
        return { callId, error: errorMessage(err) };
      } finally {
        clearTimeout(timer);
        running.delete(controller);
      }
    },
    abortAll() {
      running.forEach((c) => c.abort(new Error("The call ended")));
      running.clear();
    },
  };
}
