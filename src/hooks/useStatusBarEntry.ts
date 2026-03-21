import { useEffect } from "react";
import { useAppStore, type StatusBarEntry } from "@/state/appStore";

/**
 * Register a status bar entry for the lifetime of the calling component.
 * The entry is automatically removed on unmount.
 *
 * Calling this hook with updated `entry` values will update the entry in place
 * without removing and re-adding it (no flicker).
 *
 * @example
 * useStatusBarEntry({
 *   id: "my-connection",
 *   label: "localhost:3306",
 *   side: "left",
 *   priority: 10,
 * });
 */
export function useStatusBarEntry(entry: StatusBarEntry): void {
  const addStatusBarEntry = useAppStore((s) => s.addStatusBarEntry);
  const removeStatusBarEntry = useAppStore((s) => s.removeStatusBarEntry);
  const updateStatusBarEntry = useAppStore((s) => s.updateStatusBarEntry);

  // Register on mount, unregister on unmount — keyed by id only.
  useEffect(() => {
    addStatusBarEntry(entry);
    return () => removeStatusBarEntry(entry.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // Update content in-place when label/title/side/priority/onClick change.
  // Uses updateStatusBarEntry to avoid the remove+add cycle that causes flicker.
  useEffect(() => {
    updateStatusBarEntry(entry.id, {
      label: entry.label,
      title: entry.title,
      side: entry.side,
      priority: entry.priority,
      onClick: entry.onClick,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, entry.label, entry.title, entry.side, entry.priority, entry.onClick]);
}
