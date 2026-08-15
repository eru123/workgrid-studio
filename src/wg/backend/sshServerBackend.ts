// Flat TreeBackend over the SSH server registry (no folders — servers are
// leaves). Mirrors createCredentialsTreeBackend but stateless-per-refresh:
// the host recreates the backend whenever the registry mutates.

import type { TreeBackend, TreeNode } from './BackendAdapter';
import type { SshServerDto } from './types';
import { sshServersList } from './ipc';

export type SshServerTreeNode = TreeNode<SshServerDto>;

export function createSshServerBackend(
  onOpen?: (server: SshServerDto) => void,
  onContextMenu?: (node: SshServerTreeNode, anchor: { x: number; y: number }) => void,
): TreeBackend<SshServerDto> {
  let cache: SshServerTreeNode[] | null = null;

  const ensure = async (): Promise<SshServerTreeNode[]> => {
    if (cache) return cache;
    const servers = await sshServersList();
    cache = servers.map((server) => ({
      id: server.id,
      label: server.name,
      icon: 'server',
      description: `${server.host}:${server.port ?? 22}`,
      tooltip: server.notes ?? undefined,
      collapsible: false,
      data: server,
    }));
    return cache;
  };

  return {
    getRoots: ensure,
    getChildren: async () => [],
    onActivate: (node) => onOpen?.(node.data as SshServerDto),
    onContextMenu: (node, anchor) => onContextMenu?.(node as SshServerTreeNode, anchor),
  };
}
