/**
 * Rich components: UI an agent's tool asks the page to show, rendered by
 * code the host registered under a name. Same rules as the chat SDK, so a
 * tool can target both.
 */

/** The `command` value that asks for a component. */
export const DISPLAY_COMPONENT_COMMAND = "displayComponent";

/**
 * A name a host could register: a letter first, then letters, digits and
 * `_ . : -`. Narrow on purpose — a name is a lookup key, never markup.
 */
const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;

export interface DisplayComponent {
  component: string;
  props: Record<string, unknown>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The component a command payload asks for, or `null` when it is any
 * other command or a malformed one. `props` defaults to `{}`; present but
 * not an object makes the whole command invalid.
 */
export function parseDisplayComponent(command: unknown): DisplayComponent | null {
  if (!isPlainObject(command)) return null;
  if (command.command !== DISPLAY_COMPONENT_COMMAND) return null;
  const { component, props } = command;
  if (typeof component !== "string" || !COMPONENT_NAME.test(component)) return null;
  if (props !== undefined && !isPlainObject(props)) return null;
  return { component, props: props ?? {} };
}

/**
 * The name a host subscribes to for a command payload: `command`, or
 * `type` for payloads shaped like the script-tag widget's host commands.
 */
export function commandName(command: unknown): string | null {
  if (!isPlainObject(command)) return null;
  const name = command.command ?? command.type;
  return typeof name === "string" && name ? name : null;
}
