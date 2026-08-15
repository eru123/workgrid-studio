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

//  ------ SSH servers

export interface SshServerRecord {
  id: string;
  name: string;
  host: string;
  port?: number | null;
  /** Vault identity used for user/key/password material. */
  identityId?: string | null;
  /** Overrides the identity's user for this server (and its jumps). */
  user?: string | null;
  /** Direct private-key path bypassing the vault. */
  privateKeyPath?: string | null;
  /** ProxyJump chain — comma-separated user@host:port hops. */
  proxyJump?: string | null;
  /** Raw ProxyCommand; %h and %p are substituted before execution. */
  proxyCommand?: string | null;
  connectTimeoutSecs?: number | null;
  keepaliveIntervalSecs?: number | null;
  keepaliveCount?: number | null;
  compression?: boolean | null;
  /** "accept-new" (TOFU, default) | "yes" (strict) | "no" (accept any). */
  strictHostKey?: string | null;
  /** Arbitrary extra OpenSSH options, stored verbatim. */
  extraOptions?: Record<string, unknown> | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type SshServerDto = SshServerRecord;

/** Create/update payload — `id: null` creates, an id updates in place. */
export interface SshServerInput {
  id?: string | null;
  name: string;
  host: string;
  port?: number | null;
  identityId?: string | null;
  user?: string | null;
  privateKeyPath?: string | null;
  proxyJump?: string | null;
  proxyCommand?: string | null;
  connectTimeoutSecs?: number | null;
  keepaliveIntervalSecs?: number | null;
  keepaliveCount?: number | null;
  compression?: boolean | null;
  strictHostKey?: string | null;
  extraOptions?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface SshTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number | null;
  /** "publickey" | "password" */
  authUsed?: string | null;
  /** SHA256 fingerprint of the server host key. */
  hostFingerprint?: string | null;
  /** Human-readable description of the connection path taken. */
  hops: string[];
}

//  ------ Database servers

export type DbConnectionType = 'tcp' | 'docker' | 'ssh' | 'sshDocker';

export interface DbServerRecord {
  id: string;
  name: string;
  connectionType: DbConnectionType;
  /** mysql | postgres | sqlite | mssql */
  dbType: string;
  /** tcp: DB host. ssh: DB host as reachable from the SSH host. Unused for docker types. */
  host?: string | null;
  /** DB port; for docker types the container-internal port. */
  port?: number | null;
  database?: string | null;
  user?: string | null;
  password?: string | null;
  ssl?: boolean | null;
  /** docker / sshDocker: container name or id. */
  dockerContainer?: string | null;
  /** ssh / sshDocker: registered SSH server id. */
  sshServerId?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type DbServerDto = DbServerRecord;

/** Create/update payload — `id: null` creates, an id updates in place. */
export interface DbServerInput {
  id?: string | null;
  name: string;
  connectionType: DbConnectionType;
  dbType: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  user?: string | null;
  password?: string | null;
  ssl?: boolean | null;
  dockerContainer?: string | null;
  sshServerId?: string | null;
  notes?: string | null;
}

export interface DbServerTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number | null;
  /** Address the driver dialed (post tunnel/docker resolution). */
  resolvedAddress?: string | null;
  serverVersion?: string | null;
  /** Human-readable connection path (docker lookups, ssh hops, tunnels). */
  path: string[];
}

/** A container entry from `docker ps` (local or over SSH). */
export interface DockerContainerDto {
  name: string;
  image: string;
}
