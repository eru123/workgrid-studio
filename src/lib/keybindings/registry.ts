import type { CommandId, CommandHandler, KeybindingEntry } from "./types";
import { evaluateWhen, getContext } from "./context";
import defaultBindings from "./defaultKeybindings.json";

// ─── Command Registry ─────────────────────────────────────────────────────────

const _handlers = new Map<string, CommandHandler>();

/** Register a handler for a command. Returns an unregister function. */
export function registerCommand(id: CommandId | string, handler: CommandHandler): () => void {
  _handlers.set(id, handler);
  return () => _handlers.delete(id);
}

/** Fire a command by ID. Returns true if a handler was found and called. */
export function executeCommand(id: CommandId | string, event?: KeyboardEvent): boolean {
  const handler = _handlers.get(id);
  if (!handler) return false;
  handler(event);
  return true;
}

/** Returns all currently registered command IDs (for settings UI). */
export function getRegisteredCommands(): string[] {
  return Array.from(_handlers.keys());
}

// ─── Keybinding Registry ──────────────────────────────────────────────────────

// Start with default bindings; user overrides are merged on top.
let _bindings: KeybindingEntry[] = (defaultBindings as KeybindingEntry[]).map((b) => ({
  ...b,
  isDefault: true,
}));

/** Merge user keybinding overrides on top of defaults. */
export function loadUserKeybindings(overrides: KeybindingEntry[]): void {
  // Remove any default entry whose command is overridden by the user
  const overriddenCommands = new Set(overrides.map((o) => o.command));
  _bindings = [
    ..._bindings.filter((b) => b.isDefault && !overriddenCommands.has(b.command)),
    ...overrides.map((o) => ({ ...o, isDefault: false })),
  ];
}

/** Get all active bindings (for the settings Keybindings UI). */
export function getAllBindings(): ReadonlyArray<KeybindingEntry> {
  return _bindings;
}

// ─── Key Chord Parser ─────────────────────────────────────────────────────────

interface ParsedChord {
  key: string;       // lowercase base key, e.g. "enter", "b", "`"
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

function parseChord(chord: string): ParsedChord {
  const parts = chord.split("+");
  const key = parts[parts.length - 1].toLowerCase();
  return {
    key,
    ctrl:  parts.includes("Ctrl"),
    shift: parts.includes("Shift"),
    alt:   parts.includes("Alt"),
    meta:  parts.includes("Meta"),
  };
}

function chordMatchesEvent(chord: ParsedChord, e: KeyboardEvent): boolean {
  const eKey = e.key === "`" ? "`" : e.key.toLowerCase();
  return (
    eKey === chord.key &&
    e.ctrlKey  === chord.ctrl  &&
    e.shiftKey === chord.shift &&
    e.altKey   === chord.alt   &&
    e.metaKey  === chord.meta
  );
}

// Pending first chord for two-chord sequences, e.g. "Ctrl+K Ctrl+S"
let _pendingChord: string | null = null;
let _pendingTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Global Keydown Dispatcher ────────────────────────────────────────────────

export function handleGlobalKeydown(e: KeyboardEvent): void {
  // Never intercept events from real text inputs / content-editable areas
  // unless a binding explicitly declares `when: "inputFocus"`.
  // The context evaluator handles this via the `inputFocus` atom.

  const ctx = getContext();

  // Build the current key representation for matching
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey)   parts.push("Alt");
  if (e.metaKey)  parts.push("Meta");
  const baseKey = e.key === " " ? "Space" : e.key;
  parts.push(baseKey);
  const currentChord = parts.join("+");

  // Try chord completion first
  if (_pendingChord) {
    const fullChord = `${_pendingChord} ${currentChord}`;
    clearPendingChord();

    for (const binding of _bindings) {
      if (binding.key === fullChord && evaluateWhen(binding.when, ctx)) {
        e.preventDefault();
        executeCommand(binding.command, e);
        return;
      }
    }
    // Chord did not complete — fall through to try single-chord match
  }

  for (const binding of _bindings) {
    if (!evaluateWhen(binding.when, ctx)) continue;

    const chords = binding.key.split(" ");

    if (chords.length === 2) {
      // Two-chord sequence — match on first chord, wait for second
      const first = parseChord(chords[0]);
      if (chordMatchesEvent(first, e)) {
        e.preventDefault();
        _pendingChord = chords[0];
        // Auto-cancel pending chord after 3s of inactivity
        _pendingTimer = setTimeout(clearPendingChord, 3000);
        return;
      }
    } else {
      // Single chord
      const parsed = parseChord(binding.key);
      if (chordMatchesEvent(parsed, e)) {
        e.preventDefault();
        executeCommand(binding.command, e);
        return;
      }
    }
  }
}

function clearPendingChord(): void {
  _pendingChord = null;
  if (_pendingTimer) {
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
}
