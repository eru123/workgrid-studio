import { invoke } from "@tauri-apps/api/core";

export interface ConnectParams {
    profile_id: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string | null;
    ssl: boolean;
    ssl_ca_file: string | null;
    ssl_cert_file: string | null;
    ssl_key_file: string | null;
    ssl_reject_unauthorized: boolean;
    db_type: string;
    ssh: boolean;
    ssh_host: string;
    ssh_port: number;
    ssh_user: string;
    ssh_password: string | null;
    ssh_key_file: string | null;
    ssh_passphrase: string | null;
    ssh_strict_key_checking: boolean;
    ssh_keep_alive_interval: number;
    ssh_compression: boolean;
    use_docker: boolean;
    docker_container: string | null;
    connection_verbose_logging: boolean;
}

export interface ColumnInfo {
    name: string;
    col_type: string;
    nullable: boolean;
    key: string;
    default_val: string | null;
    extra: string;
}

export interface DatabaseInfo {
    name: string;
    size_bytes: number;
    tables: number;
    views: number;
    default_collation: string;
    last_modified: string | null;
}

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

export interface VariableInfo {
    name: string;
    session_value: string;
    global_value: string;
    scope?: string;
}

export interface StatusInfo {
    name: string;
    value: string;
}

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

export interface ForeignKeyInfo {
    constraint_name: string;
    column_name: string;
    referenced_table_name: string;
    referenced_column_name: string;
    update_rule: string | null;
    delete_rule: string | null;
}

export interface IndexInfo {
    name: string;
    column_name: string | null;
    seq_in_index: number;
    non_unique: number;
    index_type: string;
    nullable: string | null;
    comment: string | null;
    index_comment: string | null;
}

export interface TriggerInfo {
    name: string;
    table_name: string;
    timing: string;
    event: string;
    statement: string;
}

export interface RoutineInfo {
    name: string;
    routine_type: string;
    data_type: string | null;
}

export interface ViewInfo {
    name: string;
    definition: string | null;
}

export interface EventInfo {
    name: string;
    status: string | null;
    schedule: string | null;
    event_definition: string | null;
}

export interface UserInfo {
    user: string;
    host: string;
    plugin: string | null;
    account_locked: string | null;
}

export interface CollationResponse {
    collations: string[];
    default_collation: string;
}

export interface QueryExecutionOptions {
    timeoutMs?: number;
}

export interface QueryResultSet {
    columns: string[];
    rows: (string | number | null)[][];
    affected_rows: number;
    info: string;
}

export type LogType = "mysql" | "ssh" | "error" | "all";

export interface ImportResult {
    kind: "sql" | "csv";
    itemsAttempted: number;
    itemsCommitted: number;
    rowsAttempted: number;
    rowsCommitted: number;
    rowsSkipped: number;
    elapsedMs: number;
    errors: string[];
    summary: string;
}

export interface ImportProgressEvent {
    jobId: string;
    kind: "sql" | "csv";
    phase: "started" | "progress" | "completed" | "error";
    itemsProcessed: number;
    itemsTotal: number;
    rowsProcessed: number;
    rowsTotal: number;
    percent: number;
    message: string;
}

export interface AiLogEntry {
    id: string;
    timestamp: string;
    model: string;
    uri: string;
    payload_preview: string;
    response_preview: string;
}

export type DatabaseEngine = "mysql" | "mariadb" | "postgres" | "sqlite" | "mssql";

export interface ProfileLike {
    id: string;
    type: DatabaseEngine;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    filePath?: string;
    ssl?: boolean;
    sslCaFile?: string;
    sslCertFile?: string;
    sslKeyFile?: string;
    sslRejectUnauthorized?: boolean;
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

function withTimeoutArg(profileId: string, query: string, options: QueryExecutionOptions) {
    return { profileId, query, timeoutMs: options.timeoutMs };
}

export async function dbConnect(params: ConnectParams): Promise<string> {
    return invoke<string>("db_connect", { params });
}
export async function dbCancelConnect(profileId: string): Promise<void> {
    return invoke<void>("db_cancel_connect", { profileId });
}
export async function dbDisconnect(profileId: string): Promise<string> {
    return invoke<string>("db_disconnect", { profileId });
}
export async function dbPing(profileId: string): Promise<number> {
    return invoke<number>("db_ping", { profileId });
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
export async function dbGetDatabasesInfo(profileId: string): Promise<DatabaseInfo[]> {
    return invoke<DatabaseInfo[]>("db_get_databases_info", { profileId });
}
export async function dbGetTablesInfo(profileId: string, database: string): Promise<TableInfo[]> {
    return invoke<TableInfo[]>("db_get_tables_info", { profileId, database });
}
export async function dbGetVariables(profileId: string): Promise<VariableInfo[]> {
    return invoke<VariableInfo[]>("db_get_variables", { profileId });
}
export async function dbSetVariable(profileId: string, scope: "SESSION" | "GLOBAL", name: string, value: string): Promise<void> {
    return invoke<void>("db_set_variable", { profileId, scope, name, value });
}
export async function dbGetStatus(profileId: string): Promise<StatusInfo[]> {
    return invoke<StatusInfo[]>("db_get_status", { profileId });
}
export async function dbGetProcesses(profileId: string): Promise<ProcessInfo[]> {
    return invoke<ProcessInfo[]>("db_get_processes", { profileId });
}
export async function dbKillProcess(profileId: string, processId: number): Promise<void> {
    return invoke<void>("db_kill_process", { profileId, processId });
}
export async function dbExecuteQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<void> {
    return invoke<void>("db_execute_query", withTimeoutArg(profileId, query, options));
}
export async function dbGetCollations(profileId: string): Promise<CollationResponse> {
    return invoke<CollationResponse>("db_get_collations", { profileId });
}
export async function dbQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<QueryResultSet[]> {
    return invoke<QueryResultSet[]>("db_query", withTimeoutArg(profileId, query, options));
}
export async function dbUpdateRow(profileId: string, database: string, table: string, pkColumns: Record<string, string>, changes: Record<string, string>): Promise<number> {
    return invoke<number>("db_update_row", { profileId, database, table, pkColumns, changes });
}
export async function dbGetForeignKeys(profileId: string, database: string, table: string): Promise<ForeignKeyInfo[]> {
    return invoke<ForeignKeyInfo[]>("db_get_foreign_keys", { profileId, database, table });
}
export async function dbGetIndexes(profileId: string, database: string, table: string): Promise<IndexInfo[]> {
    return invoke<IndexInfo[]>("db_get_indexes", { profileId, database, table });
}
export async function dbListTriggers(profileId: string, database: string): Promise<TriggerInfo[]> {
    return invoke<TriggerInfo[]>("db_list_triggers", { profileId, database });
}
export async function dbGetTriggerDdl(profileId: string, database: string, triggerName: string): Promise<string> {
    return invoke<string>("db_get_trigger_ddl", { profileId, database, triggerName });
}
export async function dbDropTrigger(profileId: string, database: string, triggerName: string): Promise<void> {
    return invoke<void>("db_drop_trigger", { profileId, database, triggerName });
}
export async function dbCreateTrigger(profileId: string, database: string, sql: string): Promise<void> {
    return invoke<void>("db_create_trigger", { profileId, database, sql });
}
export async function dbListRoutines(profileId: string, database: string, routineType: string): Promise<RoutineInfo[]> {
    return invoke<RoutineInfo[]>("db_list_routines", { profileId, database, routineType });
}
export async function dbGetRoutineDdl(profileId: string, database: string, name: string, routineType: string): Promise<string> {
    return invoke<string>("db_get_routine_ddl", { profileId, database, name, routineType });
}
export async function dbDropRoutine(profileId: string, database: string, name: string, routineType: string): Promise<void> {
    return invoke<void>("db_drop_routine", { profileId, database, name, routineType });
}
export async function dbCreateOrReplaceRoutine(profileId: string, database: string, sql: string): Promise<void> {
    return invoke<void>("db_create_or_replace_routine", { profileId, database, sql });
}
export async function dbListViews(profileId: string, database: string): Promise<ViewInfo[]> {
    return invoke<ViewInfo[]>("db_list_views", { profileId, database });
}
export async function dbGetViewDdl(profileId: string, database: string, viewName: string): Promise<string> {
    return invoke<string>("db_get_view_ddl", { profileId, database, viewName });
}
export async function dbDropView(profileId: string, database: string, viewName: string): Promise<void> {
    return invoke<void>("db_drop_view", { profileId, database, viewName });
}
export async function dbCreateOrReplaceView(profileId: string, database: string, sql: string): Promise<void> {
    return invoke<void>("db_create_or_replace_view", { profileId, database, sql });
}
export async function dbListEvents(profileId: string, database: string): Promise<EventInfo[]> {
    return invoke<EventInfo[]>("db_list_events", { profileId, database });
}
export async function dbGetEventDdl(profileId: string, database: string, eventName: string): Promise<string> {
    return invoke<string>("db_get_event_ddl", { profileId, database, eventName });
}
export async function dbDropEvent(profileId: string, database: string, eventName: string): Promise<void> {
    return invoke<void>("db_drop_event", { profileId, database, eventName });
}
export async function dbCreateEvent(profileId: string, database: string, sql: string): Promise<void> {
    return invoke<void>("db_create_event", { profileId, database, sql });
}
export async function dbListUsers(profileId: string): Promise<UserInfo[]> {
    return invoke<UserInfo[]>("db_list_users", { profileId });
}
export async function dbGetUserGrants(profileId: string, user: string, host: string): Promise<string[]> {
    return invoke<string[]>("db_get_user_grants", { profileId, user, host });
}
export async function dbCreateUser(profileId: string, user: string, host: string, password: string): Promise<void> {
    return invoke<void>("db_create_user", { profileId, user, host, password });
}
export async function dbDropUser(profileId: string, user: string, host: string): Promise<void> {
    return invoke<void>("db_drop_user", { profileId, user, host });
}
export async function dbGrant(profileId: string, privileges: string, onWhat: string, user: string, host: string): Promise<void> {
    return invoke<void>("db_grant", { profileId, privileges, onWhat, user, host });
}
export async function dbRevoke(profileId: string, privileges: string, onWhat: string, user: string, host: string): Promise<void> {
    return invoke<void>("db_revoke", { profileId, privileges, onWhat, user, host });
}
export async function dbFlushPrivileges(profileId: string): Promise<void> {
    return invoke<void>("db_flush_privileges", { profileId });
}

export async function pgConnect(params: ConnectParams): Promise<string> {
    return invoke<string>("pg_connect", { params });
}
export async function pgDisconnect(profileId: string): Promise<string> {
    return invoke<string>("pg_disconnect", { profileId });
}
export async function pgListDatabases(profileId: string): Promise<string[]> {
    return invoke<string[]>("pg_list_databases", { profileId });
}
export async function pgListTables(profileId: string, database: string): Promise<string[]> {
    return invoke<string[]>("pg_list_tables", { profileId, database });
}
export async function pgListColumns(profileId: string, database: string, table: string): Promise<ColumnInfo[]> {
    return invoke<ColumnInfo[]>("pg_list_columns", { profileId, database, table });
}
export async function pgGetDatabasesInfo(profileId: string): Promise<DatabaseInfo[]> {
    return invoke<DatabaseInfo[]>("pg_get_databases_info", { profileId });
}
export async function pgGetTablesInfo(profileId: string, database: string): Promise<TableInfo[]> {
    return invoke<TableInfo[]>("pg_get_tables_info", { profileId, database });
}
export async function pgExecuteQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<void> {
    return invoke<void>("pg_execute_query", withTimeoutArg(profileId, query, options));
}
export async function pgQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<QueryResultSet[]> {
    return invoke<QueryResultSet[]>("pg_query", withTimeoutArg(profileId, query, options));
}
export async function pgGetProcesses(profileId: string): Promise<ProcessInfo[]> {
    return invoke<ProcessInfo[]>("pg_get_processes", { profileId });
}
export async function pgKillProcess(profileId: string, processId: number): Promise<void> {
    return invoke<void>("pg_kill_process", { profileId, processId });
}

export async function sqliteConnect(params: ConnectParams): Promise<string> {
    return invoke<string>("sqlite_connect", { params });
}
export async function sqliteDisconnect(profileId: string): Promise<string> {
    return invoke<string>("sqlite_disconnect", { profileId });
}
export async function sqliteListDatabases(profileId: string): Promise<string[]> {
    return invoke<string[]>("sqlite_list_databases", { profileId });
}
export async function sqliteListTables(profileId: string, database: string): Promise<string[]> {
    return invoke<string[]>("sqlite_list_tables", { profileId, database });
}
export async function sqliteListColumns(profileId: string, database: string, table: string): Promise<ColumnInfo[]> {
    return invoke<ColumnInfo[]>("sqlite_list_columns", { profileId, database, table });
}
export async function sqliteExecuteQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<void> {
    return invoke<void>("sqlite_execute_query", withTimeoutArg(profileId, query, options));
}
export async function sqliteQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<QueryResultSet[]> {
    return invoke<QueryResultSet[]>("sqlite_query", withTimeoutArg(profileId, query, options));
}

export async function mssqlConnect(params: ConnectParams): Promise<string> {
    return invoke<string>("mssql_connect", { params });
}
export async function mssqlDisconnect(profileId: string): Promise<string> {
    return invoke<string>("mssql_disconnect", { profileId });
}
export async function mssqlListDatabases(profileId: string): Promise<string[]> {
    return invoke<string[]>("mssql_list_databases", { profileId });
}
export async function mssqlListTables(profileId: string, database: string): Promise<string[]> {
    return invoke<string[]>("mssql_list_tables", { profileId, database });
}
export async function mssqlListColumns(profileId: string, database: string, table: string): Promise<ColumnInfo[]> {
    return invoke<ColumnInfo[]>("mssql_list_columns", { profileId, database, table });
}
export async function mssqlExecuteQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<void> {
    return invoke<void>("mssql_execute_query", withTimeoutArg(profileId, query, options));
}
export async function mssqlQuery(profileId: string, query: string, options: QueryExecutionOptions = {}): Promise<QueryResultSet[]> {
    return invoke<QueryResultSet[]>("mssql_query", withTimeoutArg(profileId, query, options));
}
export async function mssqlGetProcesses(profileId: string): Promise<ProcessInfo[]> {
    return invoke<ProcessInfo[]>("mssql_get_processes", { profileId });
}
export async function mssqlKillProcess(profileId: string, processId: number): Promise<void> {
    return invoke<void>("mssql_kill_process", { profileId, processId });
}

export async function readProfileLog(profileId: string, logType: LogType): Promise<string> {
    return invoke<string>("read_profile_log", { profileId, logType });
}
export async function clearProfileLog(profileId: string, logType: LogType): Promise<void> {
    return invoke<void>("clear_profile_log", { profileId, logType });
}
export async function vaultSet(key: string, secret: string): Promise<void> {
    return invoke<void>("vault_set", { key, secret });
}
export async function vaultGet(key: string): Promise<string> {
    return invoke<string>("vault_get", { key });
}
export async function vaultDelete(key: string): Promise<void> {
    return invoke<void>("vault_delete", { key });
}
export async function encryptPassword(password: string): Promise<string> {
    return invoke<string>("encrypt_password", { password });
}
export async function decryptPassword(encrypted: string): Promise<string> {
    return invoke<string>("decrypt_password", { encrypted });
}
export async function dbGetSchemaDdl(profileId: string, database: string): Promise<string> {
    return invoke<string>("db_get_schema_ddl", { profileId, database });
}
export async function aiGenerateQuery(
    providerType: "openai" | "gemini" | "deepseek" | "other",
    baseUrl: string | null,
    apiKeyRef: string,
    modelId: string,
    prompt: string,
    schemaContext: string,
    currentQuery: string,
): Promise<string> {
    return invoke<string>("ai_generate_query", {
        providerType,
        baseUrl,
        apiKeyRef,
        modelId,
        prompt,
        schemaContext,
        currentQuery,
    });
}
export async function getAiLogs(): Promise<AiLogEntry[]> {
    return invoke<AiLogEntry[]>("get_ai_logs");
}
export async function clearAiLogs(): Promise<void> {
    return invoke<void>("clear_ai_logs");
}
export async function dbImportSql(profileId: string, database: string, filePath: string, jobId: string): Promise<ImportResult> {
    return invoke<ImportResult>("db_import_sql", { profileId, database, filePath, jobId });
}
export async function dbImportCsv(profileId: string, database: string, table: string, filePath: string, jobId: string): Promise<ImportResult> {
    return invoke<ImportResult>("db_import_csv", { profileId, database, table, filePath, jobId });
}
export async function dbForgetHostKey(profileId: string, sshHost: string, sshPort: number): Promise<void> {
    return invoke<void>("forget_host_key", { profileId, sshHost, sshPort });
}
export async function clearAllLogs(): Promise<void> {
    return invoke<void>("clear_all_logs");
}
export async function deleteAllAppData(): Promise<void> {
    return invoke<void>("app_delete_all_data");
}
export async function dbExportTableCsv(profileId: string, database: string, table: string, filePath: string): Promise<number> {
    return invoke<number>("db_export_table_csv", { profileId, database, table, filePath });
}
export async function dbExportTableJson(profileId: string, database: string, table: string, filePath: string): Promise<number> {
    return invoke<number>("db_export_table_json", { profileId, database, table, filePath });
}
export async function dbExportTableInserts(profileId: string, database: string, table: string, filePath: string): Promise<number> {
    return invoke<number>("db_export_table_inserts", { profileId, database, table, filePath });
}
export async function dbExportSqlDump(profileId: string, database: string, filePath: string): Promise<number> {
    return invoke<number>("db_export_sql_dump", { profileId, database, filePath });
}

function toConnectParams(profile: ProfileLike): ConnectParams {
    return {
        profile_id: profile.id,
        host: profile.type === "sqlite" ? (profile.filePath ?? "") : (profile.host ?? "localhost"),
        port: profile.port ?? (profile.type === "postgres" ? 5432 : profile.type === "mssql" ? 1433 : 3306),
        user: profile.user ?? "",
        password: profile.password ?? "",
        database: profile.type === "sqlite" ? (profile.filePath ?? null) : (profile.database ?? null),
        ssl: profile.ssl ?? false,
        ssl_ca_file: profile.sslCaFile ?? null,
        ssl_cert_file: profile.sslCertFile ?? null,
        ssl_key_file: profile.sslKeyFile ?? null,
        ssl_reject_unauthorized: profile.sslRejectUnauthorized ?? false,
        db_type: profile.type,
        ssh: profile.ssh ?? false,
        ssh_host: profile.sshHost ?? "",
        ssh_port: profile.sshPort ?? 22,
        ssh_user: profile.sshUser ?? "",
        ssh_password: profile.sshPassword ?? null,
        ssh_key_file: profile.sshKeyFile ?? null,
        ssh_passphrase: profile.sshPassphrase ?? null,
        ssh_strict_key_checking: profile.sshStrictKeyChecking ?? false,
        ssh_keep_alive_interval: profile.sshKeepAliveInterval ?? 0,
        ssh_compression: profile.sshCompression ?? true,
        use_docker: profile.useDocker ?? false,
        docker_container: profile.dockerContainer ?? null,
        connection_verbose_logging: profile.connectionVerboseLogging ?? false,
    };
}

export async function connectProfile(profile: ProfileLike): Promise<string> {
    const params = toConnectParams(profile);
    switch (profile.type) {
        case "postgres":
            return pgConnect(params);
        case "sqlite":
            return sqliteConnect(params);
        case "mssql":
            return mssqlConnect(params);
        default:
            return dbConnect(params);
    }
}

export async function disconnectProfile(profileId: string, type: DatabaseEngine): Promise<string> {
    switch (type) {
        case "postgres":
            return pgDisconnect(profileId);
        case "sqlite":
            return sqliteDisconnect(profileId);
        case "mssql":
            return mssqlDisconnect(profileId);
        default:
            return dbDisconnect(profileId);
    }
}

export async function listDatabasesForProfile(profileId: string, type: DatabaseEngine): Promise<string[]> {
    switch (type) {
        case "postgres":
            return pgListDatabases(profileId);
        case "sqlite":
            return sqliteListDatabases(profileId);
        case "mssql":
            return mssqlListDatabases(profileId);
        default:
            return dbListDatabases(profileId);
    }
}

export async function listTablesForProfile(profileId: string, type: DatabaseEngine, database: string): Promise<string[]> {
    switch (type) {
        case "postgres":
            return pgListTables(profileId, database);
        case "sqlite":
            return sqliteListTables(profileId, database);
        case "mssql":
            return mssqlListTables(profileId, database);
        default:
            return dbListTables(profileId, database);
    }
}

export async function listColumnsForProfile(profileId: string, type: DatabaseEngine, database: string, table: string): Promise<ColumnInfo[]> {
    switch (type) {
        case "postgres":
            return pgListColumns(profileId, database, table);
        case "sqlite":
            return sqliteListColumns(profileId, database, table);
        case "mssql":
            return mssqlListColumns(profileId, database, table);
        default:
            return dbListColumns(profileId, database, table);
    }
}

export async function executeQueryForProfile(profileId: string, type: DatabaseEngine, query: string, options: QueryExecutionOptions = {}): Promise<void> {
    switch (type) {
        case "postgres":
            return pgExecuteQuery(profileId, query, options);
        case "sqlite":
            return sqliteExecuteQuery(profileId, query, options);
        case "mssql":
            return mssqlExecuteQuery(profileId, query, options);
        default:
            return dbExecuteQuery(profileId, query, options);
    }
}

export async function queryForProfile(profileId: string, type: DatabaseEngine, query: string, options: QueryExecutionOptions = {}): Promise<QueryResultSet[]> {
    switch (type) {
        case "postgres":
            return pgQuery(profileId, query, options);
        case "sqlite":
            return sqliteQuery(profileId, query, options);
        case "mssql":
            return mssqlQuery(profileId, query, options);
        default:
            return dbQuery(profileId, query, options);
    }
}

export async function getProcessesForProfile(profileId: string, type: DatabaseEngine): Promise<ProcessInfo[]> {
    switch (type) {
        case "postgres":
            return pgGetProcesses(profileId);
        case "mssql":
            return mssqlGetProcesses(profileId);
        case "sqlite":
            return [];
        default:
            return dbGetProcesses(profileId);
    }
}

export async function killProcessForProfile(profileId: string, type: DatabaseEngine, processId: number): Promise<void> {
    switch (type) {
        case "postgres":
            return pgKillProcess(profileId, processId);
        case "mssql":
            return mssqlKillProcess(profileId, processId);
        case "sqlite":
            return Promise.resolve();
        default:
            return dbKillProcess(profileId, processId);
    }
}
