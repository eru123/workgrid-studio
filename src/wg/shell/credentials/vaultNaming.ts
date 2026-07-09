// Vault item naming + collision detection for the Credentials explorer.
//
// Mirrors VS Code's explorer naming behaviour, adapted to the WorkGrid Studio
// vault model (backend uses `'folder' | 'entry'`, not the spec's `'file' |
// 'folder'`; here `'entry'` ≡ the spec's `'file'`). Type is resolved from the
// name on create: a `.store` suffix produces a credential entry, anything else
// is a folder. Empty input falls back to an auto-incrementing "Untitled"
// folder. These are pure helpers — no React, no IPC.
//
// Paths are supported VS Code-style: typing `folder/hello.store` creates the
// intermediate folder `folder` and the entry `hello.store` inside it. Existing
// intermediate folders are reused rather than duplicated.

import type { CredentialNodeDto } from '../../backend/types.js';

/** The two item kinds the vault stores. */
export type VaultItemType = 'folder' | 'entry';

/** Suffix that marks a name as a credential entry rather than a folder. */
export const STORE_SUFFIX = '.store';

/** Path separator accepted in create/rename input. */
export const PATH_SEPARATOR = '/';

/** Result of resolving user input into a concrete vault item. */
export interface ResolvedVaultItem {
  name: string;
  type: VaultItemType;
  parentId: string | null;
}

/**
 * Split a typed path into non-empty segments on `/`. Trailing/leading slashes
 * and blanks are dropped. `folder/hello.store` → `['folder', 'hello.store']`.
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

/**
 * Auto-incrementing default folder name: "Untitled", "Untitled (2)", "Untitled (3)", ...
 * VS Code semantics — the first free name wins.
 */
export function generateDefaultFolderName(
  existingItems: readonly CredentialNodeDto[],
  parentId: string | null = null,
): string {
  const baseName = 'Untitled';
  const existingNames = new Set(
    existingItems.filter((item) => (item.parentId ?? null) === parentId).map((item) => item.name),
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let counter = 2;
  // Cap the search to avoid pathological loops; 1000 is well beyond any real vault.
  while (counter < 1000) {
    const candidate = `${baseName} (${counter})`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    counter++;
  }
  // Extremely unlikely fallback — keeps the function total.
  return `${baseName} (${counter})`;
}

/** Resolve the item type from a typed name: `.store` suffix → entry, else folder. */
export function resolveVaultItemType(name: string): VaultItemType {
  return name.endsWith(STORE_SUFFIX) ? 'entry' : 'folder';
}

/**
 * Validate a typed name against existing siblings.
 *
 * Returns an error message string when the name is rejected, or `null` when it
 * is acceptable. Rules:
 *  - Empty/whitespace → `null` (allowed while typing; auto-resolved to
 *    "Untitled" on submit).
 *  - A path with only blank segments (`/` , ` / `) → error (no real name).
 *  - A path whose final segment already exists as a sibling → collision error
 *    (matches VS Code: `folder/hello.store` collides if `hello.store` already
 *    sits beside the target parent). For a plain (slash-less) name this is a
 *    direct sibling check.
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
 * Apply the WorkGrid naming rules to user input and produce the item to create:
 *  1. Empty input  → auto-incrementing "Untitled" folder.
 *  2. `.store` suffix → credential entry (name kept as-typed, incl. suffix).
 *  3. Anything else → folder.
 */
export function handleCreateVaultItem(
  inputName: string | undefined,
  existingItems: readonly CredentialNodeDto[],
  parentId: string | null = null,
): ResolvedVaultItem {
  const trimmed = inputName?.trim() ?? '';

  if (!trimmed) {
    // Rules 1 & 3: empty defaults to a folder with auto-incremented name.
    return { name: generateDefaultFolderName(existingItems, parentId), type: 'folder', parentId };
  }

  return { name: trimmed, type: resolveVaultItemType(trimmed), parentId };
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
  /** The leaf item to create. */
  finalItem: ResolvedVaultItem;
}

/**
 * Resolve a (possibly pathed) input into a create plan against the current
 * vault tree. Intermediate folders that already exist are reused (their id is
 * returned so the caller chains into them); missing ones are flagged for
 * creation. Empty input resolves to an "Untitled" folder at the start parent.
 *
 * The returned `finalItem.parentId` is filled in by the caller after walking
 * the segments (see `handleCommitCreate` in App.tsx), since creating an
 * intermediate folder yields its id from the backend.
 *
 * @param existing the full nested vault tree (roots).
 * @param startParentId the parent the inline input targets (`null` = root).
 * @returns the resolved path, or `null` if the input is only slashes/blanks.
 */
export function resolveVaultCreatePath(
  inputName: string | undefined,
  existing: readonly CredentialNodeDto[],
  startParentId: string | null,
): ResolvedVaultPath | null {
  const trimmed = inputName?.trim() ?? '';
  const segments = splitVaultPath(trimmed);

  if (segments.length === 0) {
    // Empty input: a single "Untitled" folder at the start parent. Reuse the
    // flat resolver to get the auto-incremented name relative to that parent.
    const siblings = siblingsUnder(existing, startParentId);
    return {
      startParentId,
      folderSegments: [],
      finalItem: {
        name: generateDefaultFolderName(siblings, startParentId),
        type: 'folder',
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
      type: resolveVaultItemType(finalSegment),
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
 * Find a free folder name among `siblings` when `desired` is taken by a
 * non-folder (an entry) or is otherwise occupied. If `desired` is free or
 * already a folder, it is returned unchanged. Otherwise produces
 * `desired (2)`, `desired (3)`, … until a free name is found (capped at 1000).
 *
 * Used for intermediate path segments whose name collides with an existing
 * entry — VS Code would prompt; we auto-disambiguate to keep the path-create
 * flow non-modal.
 */
export function nextUnusedFolderName(
  desired: string,
  siblings: readonly CredentialNodeDto[],
): string {
  const names = new Set(siblings.map((s) => s.name));
  const existing = siblings.find((s) => s.name === desired);
  // Free, or already a folder we can reuse → keep the name.
  if (!existing || existing.type === 'folder') {
    return desired;
  }
  let counter = 2;
  while (counter < 1000) {
    const candidate = `${desired} (${counter})`;
    const clash = siblings.find((s) => s.name === candidate);
    if (!clash || clash.type === 'folder') {
      return candidate;
    }
    counter++;
  }
  return `${desired} (${counter})`;
}
