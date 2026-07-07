// TreeBackend implementation backed by Tauri IPC. Implements the
// TreeBackend interface from BackendAdapter.ts by calling the Rust
// tree_get_roots / tree_get_children commands.

import type { TreeBackend, TreeNode } from "./BackendAdapter";
import { treeGetChildren, treeGetRoots } from "./ipc";

export function createTreeBackend(profileId: string): TreeBackend {
  return {
    getRoots: () => treeGetRoots(profileId),
    getChildren: (node: TreeNode) => treeGetChildren(profileId, node.id),
    onActivate: (node: TreeNode) => {
      // The host wires tab-opening here (e.g. open a table designer when a
      // table node is activated). Default: no-op.
      void node;
    },
    onContextMenu: undefined,
  };
}
