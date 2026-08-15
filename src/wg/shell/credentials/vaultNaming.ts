// Vault item naming + collision detection for the Credentials explorer.
//
// Mirrors VS Code's explorer naming behaviour, adapted to the WorkGrid Studio
// vault model (backend uses `'folder' | 'entry'`; `'entry'` ≡ the spec's
// `'file'`).
//
// Naming rules (type comes from the ACTION, never the name):
//  - The `.store` suffix marks a credential entry ON DISK but is HIDDEN in
//    the explorer: an entry stored as `bastion.store` displays `bastion`.
//  - Creating a file always stores `<name>.store` — one suffix, never
//    doubled (`file.store` stays `file.store`, `note.txt` becomes
//    `note.txt.store` and still displays `note.txt`).
//  - Creating a folder never appends or strips anything — a folder named
//    `x.store` is a folder.
//  - `/` in the input nests: `test/test2/file` → folder `test`, folder
//    `test2` inside it, entry `file.store` inside that. The last segment is
//    the created item; intermediates are folders (created or reused).
//  - Empty input auto-resolves to an auto-incremented "Untitled" item.
//
// Collision checks run in DISPLAY space (entries hide `.store`), so a new
// file `hello` collides with a stored `hello.store`. These are pure helpers —
// no React, no IPC.

import type { CredentialNodeDto } from '../../backend/types.js';

/** The two item kinds the vault stores. */
export type VaultItemType = 'folder' | 'entry';

/** Which create action an inline input belongs to (decides the item type). */
export type VaultCreateKind = 'file' | 'folder';

/** Suffix that marks a credential entry on disk. Hidden in the explorer. */
export const STORE_SUFFIX = '.store';

/** Path separator accepted in create/rename input. */
export const PATH_SEPARATOR = '/';

/** Result of resolving user input into a concrete vault item. */
export interface ResolvedVaultItem {
  name: string;
  type: VaultItemType;
  parentId: string | null;
}

/** Entry name as shown in the explorer (`bastion.store` → `bastion`). */
export function displayNameOf(node: { type: string; name: string }): string {
  return node.type === 'entry' && node.name.toLowerCase().endsWith(STORE_SUFFIX)
    ? node.name.slice(0, -STORE_SUFFIX.length)
    : node.name;
}

/** Entry name as stored on disk — exactly one `.store`, never doubled. */
export function ensureStoreSuffix(name: string): string {
  return name.toLowerCase().endsWith(STORE_SUFFIX) ? name : `${name}${STORE_SUFFIX}`;
}

/**
 * Split a typed path into non-empty segments on `/`. Trailing/leading slashes
 * and blanks are dropped. `folder/hello` → `['folder', 'hello']`.
 */
export function splitVaultPath(input: string): string[] {
  return input
    .split(PATH_SEPARATOR)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);
}

/**
 * Find a direct child folder of `parent` by name (case-sensitive). The vault
 * tree is nested (no parentId on the redacted DTO), so callers walk the nested
 * `children` arrays.
 */
export function findFolderChild(
  nodes: readonly CredentialNodeDto[],
  name: string,
): CredentialNodeDto | undefined {
  return nodes.find((n) => n.type === 'folder' && n.name === name);
}

/** All direct children of a folder node (empty for entries / leaf folders). */
export function childrenOf(node: CredentialNodeDto | null | undefined): readonly CredentialNodeDto[] {
  return node?.children ?? [];
}

/** First free name among `taken`: "Untitled", "Untitled (2)", "Untitled (3)"… */
export function firstFreeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  // Cap the search to avoid pathological loops; 1000 is well beyond any real vault.
  while (counter < 1000) {
    const candidate = `${base} (${counter})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    counter++;
  }
  return `${base} (${counter})`;
}

/**
 * Auto-incrementing default folder name, checked against sibling DISPLAY
 * names (an entry stored `Untitled.store` displays `Untitled` and blocks the
 * name for folders too).
 */
export function generateDefaultFolderName(
  existingItems: readonly CredentialNodeDto[],
  parentId: string | null = null,
): string {
  const siblings = existingItems.filter((item) => (item.parentId ?? null) === parentId);
  return firstFreeName('Untitled', new Set(siblings.map(displayNameOf)));
}

/** Default entry name ("Untitled") against sibling display names. The stored
 *  name gains the `.store` suffix at create time (see `ensureStoreSuffix`). */
export function generateDefaultEntryName(siblings: readonly CredentialNodeDto[]): string {
  return firstFreeName('Untitled', new Set(siblings.map(displayNameOf)));
}

/**
 * Validate a typed name against existing siblings (DISPLAY names).
 *
 * Returns an error message string when the name is rejected, or `null` when it
 * is acceptable. Rules:
 *  - Empty/whitespace → `null` (allowed while typing; auto-resolved to
 *    "Untitled" on submit).
 *  - A path with only blank segments (`/` , ` / `) → error (no real name).
 *  - A path whose final segment already exists as a sibling → collision error.
 *    For a plain (slash-less) name this is a direct sibling check.
 *  - `excludeName` lets a rename skip the node's own current name.
 *
 * Intermediate path segments are not validated here: they are created (or
 * reused) at submit time by `resolveVaultCreatePath` + the create loop in
 * App.tsx, where a fresh tree is fetched and each segment's collision is
 * checked against its actual parent.
 */
export function validateVaultItemName(
  name: string,
  existingNames: ReadonlySet<string>,
  excludeName?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const segments = splitVaultPath(trimmed);
  if (segments.length === 0) {
    return 'Enter a name.';
  }
  const finalSegment = segments[segments.length - 1];
  if (excludeName !== undefined && finalSegment === excludeName && segments.length === 1) {
    return null;
  }
  if (existingNames.has(finalSegment)) {
    return `A file or folder "${finalSegment}" already exists at this location.`;
  }
  return null;
}

/**
 * A resolved create plan with path support. `folderSegments` lists the
 * intermediate folders to create-or-reuse (in order, starting under
 * `startParentId`); `finalItem` is the leaf item created last. When there is
 * no path, `folderSegments` is empty and `finalItem` is created directly under
 * `startParentId`.
 */
export interface ResolvedVaultPath {
  startParentId: string | null;
  /** Intermediate folder names, in nesting order. Created-or-reused. */
  folderSegments: string[];
  /** The leaf item to create. `name` is the DISPLAY name; the caller stores
   *  `ensureStoreSuffix(name)` for files. */
  finalItem: ResolvedVaultItem;
}

/**
 * Resolve a (possibly pathed) input into a create plan against the current
 * vault tree. The item TYPE comes from `kind` (the create action), never from
 * the name. Intermediate folders that already exist are reused. Empty input
 * resolves to an auto-incremented "Untitled" item of the requested kind.
 *
 * @param existing the full nested vault tree (roots).
 * @param startParentId the parent the inline input targets (`null` = root).
 * @param kind which create action opened the input.
 * @returns the resolved path, or `null` if the input is only slashes/blanks.
 */
export function resolveVaultCreatePath(
  inputName: string | undefined,
  existing: readonly CredentialNodeDto[],
  startParentId: string | null,
  kind: VaultCreateKind,
): ResolvedVaultPath | null {
  const trimmed = inputName?.trim() ?? '';
  const segments = splitVaultPath(trimmed);
  const siblings = siblingsUnder(existing, startParentId);

  if (segments.length === 0) {
    return {
      startParentId,
      folderSegments: [],
      finalItem: {
        name: kind === 'folder' ? generateDefaultFolderName(siblings) : generateDefaultEntryName(siblings),
        type: kind === 'folder' ? 'folder' : 'entry',
        parentId: startParentId,
      },
    };
  }

  const folderSegments = segments.slice(0, -1);
  const finalSegment = segments[segments.length - 1];
  return {
    startParentId,
    folderSegments,
    finalItem: {
      name: finalSegment,
      type: kind === 'folder' ? 'folder' : 'entry',
      parentId: startParentId, // refined by the caller as it walks segments
    },
  };
}

/**
 * Collect the direct children of a parent node within the nested vault tree.
 * `null` parent → top-level roots.
 */
export function siblingsUnder(
  tree: readonly CredentialNodeDto[],
  parentId: string | null,
): CredentialNodeDto[] {
  if (parentId === null) {
    return [...tree];
  }
  const found = findNodeById(tree, parentId);
  return found ? [...childrenOf(found)] : [];
}

/** Depth-first lookup of a node by id within the nested tree. */
export function findNodeById(
  tree: readonly CredentialNodeDto[],
  id: string,
): CredentialNodeDto | undefined {
  for (const node of tree) {
    if (node.id === id) {
      return node;
    }
    const child = findNodeById(childrenOf(node), id);
    if (child) {
      return child;
    }
  }
  return undefined;
}

/**
 * Whether a desired item clashes with a sibling — in display space (entries
 * hide `.store`) or stored space (a folder named `x.store` blocks a file
 * `x`, whose stored name would also be `x.store`).
 */
export function vaultNameClashes(
  sibling: CredentialNodeDto,
  displayName: string,
  storedName: string,
): boolean {
  return displayNameOf(sibling) === displayName || sibling.name === storedName;
}
