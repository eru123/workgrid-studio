import type { TreeBackend, TreeNode } from "./BackendAdapter";
import { credentialsGetTree } from "./ipc";

export type CredentialsTreeNode = TreeNode<CredentialNodeDto>;

interface CredentialNodeDto {
  id: string;
  type: 'folder' | 'entry';
  name: string;
  description?: string | null;
  kind?: string;
  children?: CredentialNodeDto[];
  parentId?: string | null;
}

type Cache = {
  nodes: Map<string, CredentialsTreeNode>;
  byParent: Map<string | null, string[]>;
};

export function createCredentialsTreeBackend(
  onActivateEntry?: (entryId: string) => void,
  onContextMenu?: (node: CredentialsTreeNode, anchor: { x: number; y: number }) => void,
): TreeBackend<CredentialNodeDto> {
  let cache: Cache | null = null;

  async function ensure(): Promise<Cache> {
    if (cache) return cache;
    const data: CredentialNodeDto[] = await credentialsGetTree();
    const nodes = new Map<string, CredentialsTreeNode>();
    const byParent = new Map<string | null, string[]>();

    for (const node of data) {
      const treeNode: CredentialsTreeNode = {
        id: node.id,
        label: node.name,
        icon: node.type === 'folder' ? 'folder' : iconForKind(node.kind),
        tooltip: node.description ?? undefined,
        collapsible: node.type === 'folder',
        data: node,
      };
      nodes.set(node.id, treeNode);
      const parentId = node.parentId ?? null;
      const list = byParent.get(parentId) ?? [];
      list.push(node.id);
      byParent.set(parentId, list);
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

    onContextMenu: (node, anchor) => opts.onContextMenu?.(node, anchor),
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
