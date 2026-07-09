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

//  ------ Credentials

export type CredentialKind = 'login' | 'card' | 'identity' | 'note' | 'unknown';

export interface CredentialFields {
  username?: string | null;
  password?: string | null;
  title?: string | null;
  cardNumber?: string | null;
  cardholder?: string | null;
  expiry?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  noteContent?: string | null;
  custom?: unknown | null;
}

export interface CredentialNode {
  id: string;
  type: 'folder' | 'entry';
  name: string;
  description?: string | null;
  kind?: CredentialKind;
  fields?: CredentialFields;
  children?: CredentialNode[];
  createdAt?: string | null;
  expanded?: boolean;
  updatedAt?: string | null;
}

export interface CredentialNodeDto {
  id: string;
  type: 'folder' | 'entry';
  name: string;
  description?: string | null;
  kind?: CredentialKind;
  children?: CredentialNodeDto[];
}

export interface CredentialEntryDto {
  id: string;
  parentId?: string | null;
  kind: CredentialKind;
  name: string;
  fields: CredentialFields;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CredentialEntryInput {
  parentId?: string | null;
  kind: CredentialKind;
  name: string;
  fields: CredentialFields;
  description?: string | null;
  id?: string | null;
}
