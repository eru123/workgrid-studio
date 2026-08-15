// Flat TreeBackend over the database server registry. Server rows carry a
// per-connection-type description (tcp address, container, or ssh hop label).

import type { TreeBackend, TreeNode } from './BackendAdapter';
import type { DbServerDto } from './types';
import { dbServersList } from './ipc';

export type DbServerTreeNode = TreeNode<DbServerDto>;

const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  postgres: 5432,
  mssql: 1433,
};

function describe(server: DbServerDto, sshNameOf: (id: string) => string | undefined): string {
  const port = server.port ?? DEFAULT_PORTS[server.dbType] ?? 0;
  switch (server.connectionType) {
    case 'tcp':
      return `${server.host ?? '?'}:${port}`;
    case 'docker':
      return `${server.dockerContainer ?? '?'} · docker`;
    case 'ssh':
      return `via ${sshNameOf(server.sshServerId ?? '') ?? 'ssh'} → ${server.host ?? '127.0.0.1'}:${port}`;
    case 'sshDocker':
      return `via ${sshNameOf(server.sshServerId ?? '') ?? 'ssh'} · ${server.dockerContainer ?? '?'}`;
    default:
      return server.connectionType;
  }
}

export function createDbServerBackend(
  onOpen?: (server: DbServerDto) => void,
  onContextMenu?: (node: DbServerTreeNode, anchor: { x: number; y: number }) => void,
  /** Resolves an SSH server id to its display name for ssh-type rows. */
  sshNameOf: (id: string) => string | undefined = () => undefined,
): TreeBackend<DbServerDto> {
  let cache: DbServerTreeNode[] | null = null;

  const ensure = async (): Promise<DbServerTreeNode[]> => {
    if (cache) return cache;
    const servers = await dbServersList();
    cache = servers.map((server) => ({
      id: server.id,
      label: server.name,
      icon: 'database',
      description: describe(server, sshNameOf),
      tooltip: server.notes ?? undefined,
      collapsible: false,
      data: server,
    }));
    return cache;
  };

  return {
    getRoots: ensure,
    getChildren: async () => [],
    onActivate: (node) => onOpen?.(node.data as DbServerDto),
    onContextMenu: (node, anchor) => onContextMenu?.(node as DbServerTreeNode, anchor),
  };
}
