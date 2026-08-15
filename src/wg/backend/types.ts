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

//  ------ Credentials (SSH identities)

export type CredentialKind = 'ssh' | 'unknown';

export interface CredentialFields {
  /** SSH user the identity logs in as. */
  user?: string | null;
  /** SSH user password (password authentication). Encrypted at rest. */
  password?: string | null;
  /** Private key file contents. Encrypted at rest. */
  privateKey?: string | null;
  /** Where the key was loaded from (provenance only). */
  privateKeyPath?: string | null;
  /** Passphrase protecting the private key. Encrypted at rest. */
  passphrase?: string | null;
  notes?: string | null;
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
  parentId?: string | null;
  children?: CredentialNodeDto[];
  /** Folders only: persisted UI expansion state. */
  expanded?: boolean;
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
