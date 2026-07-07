// Data types mirroring the Rust serde models (src-tauri/src/models/mod.rs).
// These are the IPC payloads — camelCase to match Rust's serde rename_all.

//  ------ Query results

export interface QueryResultSet {
  columns: string[];
  rows: unknown[][];
  affectedRows: number;
  info: string;
}

//  ------ Schema introspection

export interface ColumnInfo {
  name: string;
  colType: string;
  nullable: boolean;
  key: string;
  defaultVal?: string | null;
  extra: string;
}

export interface TableInfo {
  name: string;
  rows?: number | null;
  sizeBytes?: number | null;
  created?: string | null;
  updated?: string | null;
  engine?: string | null;
  comment?: string | null;
  type_: string;
}

export interface DatabaseInfo {
  name: string;
  sizeBytes: number;
  tables: number;
  views: number;
  defaultCollation: string;
  lastModified?: string | null;
}

//  ------ Connection

export interface ConnectParams {
  profileId: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  filePath?: string;
  ssl?: boolean;
  sslCaFile?: string;
  sslCertFile?: string;
  sslKeyFile?: string;
  sslRejectUnauthorized?: boolean;
  dbType?: string;
  ssh?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshKeyFile?: string;
  sshPassphrase?: string;
  sshStrictKeyChecking?: boolean;
  sshKeepAliveInterval?: number;
  sshCompression?: boolean;
  useDocker?: boolean;
  dockerContainer?: string;
  connectionVerboseLogging?: boolean;
}

export interface ConnectionHandle {
  profileId: string;
  dbType: string;
  serverVersion: string;
}

// Re-export TreeNode + TreeBadge from BackendAdapter so all backend types are
// reachable from one import.
export type { TreeNode, TreeBadge } from "./BackendAdapter";
