import { invoke } from "@tauri-apps/api/core";

// ─── Types ──────────────────────────────────────────────────────────

export interface ConnectParams {
    profile_id: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string | null;
    ssl: boolean;
}

export interface ColumnInfo {
    name: string;
    col_type: string;
    nullable: boolean;
    key: string;           // PRI, MUL, UNI, ""
    default_val: string | null;
    extra: string;         // auto_increment, etc.
}

// ─── Tauri command wrappers ─────────────────────────────────────────

export async function dbConnect(params: ConnectParams): Promise<string> {
    return invoke<string>("db_connect", { params });
}

export async function dbDisconnect(profileId: string): Promise<string> {
    return invoke<string>("db_disconnect", { profileId });
}

export async function dbListDatabases(profileId: string): Promise<string[]> {
    return invoke<string[]>("db_list_databases", { profileId });
}

export async function dbListTables(profileId: string, database: string): Promise<string[]> {
    return invoke<string[]>("db_list_tables", { profileId, database });
}

export async function dbListColumns(profileId: string, database: string, table: string): Promise<ColumnInfo[]> {
    return invoke<ColumnInfo[]>("db_list_columns", { profileId, database, table });
}

// ─── Database info (HeidiSQL-style) ─────────────────────────────────

export interface DatabaseInfo {
    name: string;
    size_bytes: number;
    tables: number;
    views: number;
    default_collation: string;
    last_modified: string | null;
}

export async function dbGetDatabasesInfo(profileId: string): Promise<DatabaseInfo[]> {
    return invoke<DatabaseInfo[]>("db_get_databases_info", { profileId });
}

// ─── Table info (HeidiSQL-style) ────────────────────────────────────

export interface TableInfo {
    name: string;
    rows: number | null;
    size_bytes: number | null;
    created: string | null;
    updated: string | null;
    engine: string | null;
    comment: string | null;
    type_: string;
}

export async function dbGetTablesInfo(profileId: string, database: string): Promise<TableInfo[]> {
    return invoke<TableInfo[]>("db_get_tables_info", { profileId, database });
}

// ─── Variables ──────────────────────────────────────────────────────

export interface VariableInfo {
    name: string;
    session_value: string;
    global_value: string;
    scope?: string;
}

export async function dbGetVariables(profileId: string): Promise<VariableInfo[]> {
    return invoke<VariableInfo[]>("db_get_variables", { profileId });
}

export async function dbSetVariable(
    profileId: string,
    scope: "SESSION" | "GLOBAL",
    name: string,
    value: string
): Promise<void> {
    return invoke("db_set_variable", { profileId, scope, name, value });
}

// ─── Status ────────────────────────────────────────────────────────

export interface StatusInfo {
    name: string;
    value: string;
}

export async function dbGetStatus(profileId: string): Promise<StatusInfo[]> {
    return invoke<StatusInfo[]>("db_get_status", { profileId });
}

// ─── Processes ──────────────────────────────────────────────────────

export interface ProcessInfo {
    id: number;
    user: string | null;
    host: string | null;
    db: string | null;
    command: string | null;
    time: number | null;
    state: string | null;
    info: string | null;
}

export async function dbGetProcesses(profileId: string): Promise<ProcessInfo[]> {
    return invoke<ProcessInfo[]>("db_get_processes", { profileId });
}

export async function dbKillProcess(profileId: string, processId: number): Promise<void> {
    return invoke<void>("db_kill_process", { profileId, processId });
}

// ─── Log commands ───────────────────────────────────────────────────

export type LogType = "mysql" | "error" | "all";

export async function readProfileLog(profileId: string, logType: LogType): Promise<string> {
    return invoke<string>("read_profile_log", { profileId, logType });
}

export async function clearProfileLog(profileId: string, logType: LogType): Promise<void> {
    return invoke<void>("clear_profile_log", { profileId, logType });
}

export async function dbExecuteQuery(profileId: string, query: string): Promise<void> {
    return invoke<void>("db_execute_query", { profileId, query });
}

export interface CollationResponse {
    collations: string[];
    default_collation: string;
}

export async function dbGetCollations(profileId: string): Promise<CollationResponse> {
    return invoke<CollationResponse>("db_get_collations", { profileId });
}
