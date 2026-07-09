// Tauri IPC wrappers. Each function maps to a `#[tauri::command]` in the Rust
// backend, with typed arguments and return types matching the Rust serde
// structs (camelCase). These are the low-level building blocks the
// TreeBackend/EditorBackend shims build on.

import { invoke } from '@tauri-apps/api/core';
import type {
  ColumnInfo,
  ConnectParams,
  ConnectionHandle,
  CredentialEntryDto,
  CredentialEntryInput,
  CredentialKind,
  CredentialNodeDto,
  DatabaseInfo,
  QueryResultSet,
  TableInfo,
} from './types.js';
import type { TreeNode } from './BackendAdapter.js';

//  ------ Connection lifecycle

export function dbConnect(params: ConnectParams): Promise<ConnectionHandle> {
  return invoke<ConnectionHandle>('db_connect', { params });
}

export function dbDisconnect(profileId: string): Promise<void> {
  return invoke<void>('db_disconnect', { profileId });
}

export function dbCancelConnect(profileId: string): Promise<void> {
  return invoke<void>('db_cancel_connect', { profileId });
}

export function dbListProfiles(): Promise<string[]> {
  return invoke<string[]>('db_list_profiles');
}

export function dbPing(profileId: string): Promise<void> {
  return invoke<void>('db_ping', { profileId });
}

//  ------ Sessions + queries

export function dbBeginSession(profileId: string): Promise<string> {
  return invoke<string>('db_begin_session', { profileId });
}

export function dbEndSession(sessionId: string): Promise<void> {
  return invoke<void>('db_end_session', { sessionId });
}

export function dbQuery(sessionId: string, sql: string, timeoutMs?: number): Promise<QueryResultSet[]> {
  return invoke<QueryResultSet[]>('db_query', { sessionId, sql, timeoutMs: timeoutMs ?? null });
}

export function dbExecute(sessionId: string, sql: string, timeoutMs?: number): Promise<number> {
  return invoke<number>('db_execute', { sessionId, sql, timeoutMs: timeoutMs ?? null });
}

//  ------ Schema introspection

export function dbListDatabases(sessionId: string): Promise<string[]> {
  return invoke<string[]>('db_list_databases', { sessionId });
}

export function dbListTables(sessionId: string, database: string): Promise<string[]> {
  return invoke<string[]>('db_list_tables', { sessionId, database });
}

export function dbListColumns(sessionId: string, database: string, table: string): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>('db_list_columns', { sessionId, database, table });
}

export function dbGetTablesInfo(sessionId: string, database: string): Promise<TableInfo[]> {
  return invoke<TableInfo[]>('db_get_tables_info', { sessionId, database });
}

export function dbGetDatabasesInfo(sessionId: string): Promise<DatabaseInfo[]> {
  return invoke<DatabaseInfo[]>('db_get_databases_info', { sessionId });
}

//  ------ Explorer tree

export function treeGetRoots(profileId: string): Promise<TreeNode[]> {
  return invoke<TreeNode[]>('tree_get_roots', { profileId });
}

export function treeGetChildren(profileId: string, nodeId: string): Promise<TreeNode[]> {
  return invoke<TreeNode[]>('tree_get_children', { profileId, nodeId });
}

//  ------ Credential crypto

export function encryptPassword(password: string): Promise<string> {
  return invoke<string>('encrypt_password', { password });
}

export function decryptPassword(encrypted: string): Promise<string> {
  return invoke<string>('decrypt_password', { encrypted });
}

//  ------ Credentials vault

export function credentialsGetTree(): Promise<CredentialNodeDto[]> {
  return invoke<CredentialNodeDto[]>('credentials_get_tree');
}

export function credentialsGetEntry(id: string): Promise<CredentialEntryDto> {
  return invoke<CredentialEntryDto>('credentials_get_entry', { id });
}

export function credentialsUpsertEntry(input: CredentialEntryInput): Promise<CredentialEntryDto> {
  return invoke<CredentialEntryDto>('credentials_upsert_entry', { input });
}

export function credentialsCreateFolder(parentId: string | null, name: string): Promise<CredentialNodeDto> {
  return invoke<CredentialNodeDto>('credentials_create_folder', { parentId: parentId ?? null, name });
}

export function credentialsDeleteNode(id: string): Promise<void> {
  return invoke<void>('credentials_delete_node', { id });
}

export function credentialsMoveNode(id: string, targetParent: string): Promise<void> {
  return invoke<void>('credentials_move_node', { id, targetParent });
}


export function credentialsRenameNode(id: string, newName: string): Promise<CredentialNodeDto> {
  return invoke<CredentialNodeDto>('credentials_rename_node', { id, newName });
}
export function credentialsCopyNode(id: string, targetParent: string): Promise<CredentialNodeDto> {
  return invoke<CredentialNodeDto>('credentials_copy_node', { id, targetParent });
}
