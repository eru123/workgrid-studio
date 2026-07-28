import type { TreeBackend, TreeNode } from "./BackendAdapter";
import type { CredentialNodeDto } from "./types";
import { credentialsGetTree } from "./ipc";

export type CredentialsTreeNode = TreeNode<CredentialNodeDto>;

type Cache = {
  nodes: Map<string, CredentialsTreeNode>;
  byParent: Map<string | null, string[]>;
};

export interface CredentialsTreeBackend extends TreeBackend<CredentialNodeDto> {
  /** Direct child node ids of a parent (`null` = vault root). */
  childIdsOf(parentId: string | null): Promise<readonly string[]>;
  /** The full cached node by id, or undefined. */
  nodeById(id: string): Promise<CredentialsTreeNode | undefined>;
  /**
   * Synchronous descendant ids of a node from the warm cache. Returns `[]`
   * when the cache is not yet populated (callers should also rely on the
   * backend's own cycle guard for correctness). Used for instant DnD cycle
   * rejection.
   */
  descendantsOfSync(id: string): string[];
  /** Force a re-read on next access. */
  invalidate(): void;
}

export function createCredentialsTreeBackend(
  onActivateEntry?: (entryId: string) => void,
  onContextMenu?: (node: CredentialsTreeNode, anchor: { x: number; y: number }) => void,
): CredentialsTreeBackend {
  let cache: Cache | null = null;

  async function ensure(): Promise<Cache> {
    if (cache) return cache;
    const data: CredentialNodeDto[] = await credentialsGetTree();
    const nodes = new Map<string, CredentialsTreeNode>();
    const byParent = new Map<string | null, string[]>();

    // The backend returns a nested tree; flatten it into a by-parent index so
    // lazy expansion and DnD/reorder logic can look up children by parent id.
    const walk = (node: CredentialNodeDto, parentId: string | null) => {
      const treeNode: CredentialsTreeNode = {
        id: node.id,
        label: node.name,
        icon: node.type === 'folder' ? 'folder' : iconForKind(node.kind),
        tooltip: node.description ?? undefined,
        collapsible: node.type === 'folder',
        data: { ...node, parentId },
      };
      nodes.set(node.id, treeNode);
      const list = byParent.get(parentId) ?? [];
      list.push(node.id);
      byParent.set(parentId, list);
      for (const child of node.children ?? []) {
        walk(child, node.id);
      }
    };
    for (const root of data) {
      walk(root, null);
    }

    cache = { nodes, byParent };
    return cache;
  }

  return {
    getRoots: async () => {
      const { byParent, nodes } = await ensure();
      const rootIds = byParent.get(null) ?? [];
      return rootIds.map((id) => nodes.get(id)!).filter(Boolean);
    },

    getChildren: async (node) => {
      const { byParent, nodes } = await ensure();
      const childIds = byParent.get(node.id) ?? [];
      return childIds.map((id) => nodes.get(id)!).filter(Boolean);
    },

    onActivate: async (node) => {
      if (node.data?.type === 'entry') {
        onActivateEntry?.(node.id);
      }
    },

    onContextMenu: (node, anchor) => onContextMenu?.(node, anchor),

    childIdsOf: async (parentId) => {
      const { byParent } = await ensure();
      return byParent.get(parentId) ?? [];
    },

    nodeById: async (id) => {
      const { nodes } = await ensure();
      return nodes.get(id);
    },

    descendantsOfSync: (id) => {
      if (!cache) return [];
      const out: string[] = [];
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        const kids = cache.byParent.get(current);
        if (kids) {
          for (const kidId of kids) {
            out.push(kidId);
            stack.push(kidId);
          }
        }
      }
      return out;
    },

    invalidate: () => {
      cache = null;
    },
  };
}

function iconForKind(kind?: string): string {
  switch (kind) {
    case 'login':
      return 'key';
    case 'card':
      return 'credit-card';
    case 'identity':
      return 'account';
    case 'note':
      return 'note';
    default:
      return 'symbol-misc';
  }
}
