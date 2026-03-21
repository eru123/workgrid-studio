export type { CommandId, CommandHandler, KeybindingEntry, WhenContext } from "./types";
export { setContext, getContext, evaluateWhen, compileWhen } from "./context";
export {
  registerCommand,
  executeCommand,
  getRegisteredCommands,
  loadUserKeybindings,
  getAllBindings,
  getBindingsForCommand,
  handleGlobalKeydown,
} from "./registry";

import { handleGlobalKeydown } from "./registry";

let _initialized = false;

/**
 * Bootstrap the keybinding engine.
 * Call once at app root (e.g. in main.tsx or App.tsx).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initKeybindings(): () => void {
  if (_initialized) return () => {};
  _initialized = true;

  window.addEventListener("keydown", handleGlobalKeydown, { capture: true });

  return () => {
    window.removeEventListener("keydown", handleGlobalKeydown, { capture: true });
    _initialized = false;
  };
}
