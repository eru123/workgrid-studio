// WorkbenchBackend assembly. Builds a WorkbenchBackend from a profile id by
// wiring the IPC-backed TreeBackend. The EditorBackend and BackendAdapter
// fields are left undefined for now (wired when the editor integration lands).

import type { WorkbenchBackend } from "./BackendAdapter";
import { createTreeBackend } from "./treeBackend";

export function createWorkbenchBackend(profileId: string): WorkbenchBackend {
  return {
    tree: createTreeBackend(profileId),
    // editor + general wired in a later pass (SQL language services, etc.)
  };
}
