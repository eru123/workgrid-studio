import { useEffect } from "react";
import { registerCommand } from "@/lib/keybindings";
import type { CommandId, CommandHandler } from "@/lib/keybindings";

/**
 * Register a command handler for the duration of the component's mount.
 * The handler is automatically unregistered on unmount.
 *
 * @example
 * useCommand("layout.toggleSidebar", () => toggleSidebar());
 * useCommand("tab.newSqlQuery", () => openTab({ type: "sql" }), [openTab]);
 */
export function useCommand(
  id: CommandId | string,
  handler: CommandHandler,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    return registerCommand(id, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
}
