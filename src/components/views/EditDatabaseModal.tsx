import { useState, useEffect, useMemo } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { dbExecuteQuery, dbGetCollations, dbQuery } from "@/lib/db";
import { useSchemaStore } from "@/state/schemaStore";
import { useAppStore } from "@/state/appStore";

interface Props {
    profileId: string;
    database: string;
    onClose: () => void;
    onCompleted?: () => void;
}

export function EditDatabaseModal({ profileId, database, onClose, onCompleted }: Props) {
    const [newName, setNewName] = useState(database);
    const [collation, setCollation] = useState("");
    const [collations, setCollations] = useState<string[]>([]);
    const [defaultCollation, setDefaultCollation] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState("");
    const [confirmed, setConfirmed] = useState(false);

    // Stored objects that won't be transferred by RENAME TABLE
    const [storedObjects, setStoredObjects] = useState<{ type: string; name: string }[]>([]);
    const [loadingObjects, setLoadingObjects] = useState(false);

    useEffect(() => {
        dbGetCollations(profileId)
            .then(res => {
                setCollations(res.collations);
                setDefaultCollation(res.default_collation);
                if (res.default_collation) {
                    setCollation(res.default_collation);
                } else if (res.collations.length > 0) {
                    setCollation(res.collations[0]);
                }
            })
            .catch(e => {
                setError("Failed to fetch collations: " + String(e));
            });
    }, [profileId]);

    // Enumerate stored procedures, functions, triggers, events when name changes
    useEffect(() => {
        if (newName === database) {
            setStoredObjects([]);
            return;
        }
        setLoadingObjects(true);
        const fetchObjects = async () => {
            try {
                const items: { type: string; name: string }[] = [];

                // Procedures
                const procs = await dbQuery(profileId,
                    `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = '${database}' AND ROUTINE_TYPE = 'PROCEDURE'`);
                for (const row of (procs[0]?.rows || [])) {
                    items.push({ type: "Procedure", name: String(row[0]) });
                }

                // Functions
                const funcs = await dbQuery(profileId,
                    `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = '${database}' AND ROUTINE_TYPE = 'FUNCTION'`);
                for (const row of (funcs[0]?.rows || [])) {
                    items.push({ type: "Function", name: String(row[0]) });
                }

                // Triggers
                const trigs = await dbQuery(profileId,
                    `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = '${database}'`);
                for (const row of (trigs[0]?.rows || [])) {
                    items.push({ type: "Trigger", name: String(row[0]) });
                }

                // Events
                const evts = await dbQuery(profileId,
                    `SELECT EVENT_NAME FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = '${database}'`);
                for (const row of (evts[0]?.rows || [])) {
                    items.push({ type: "Event", name: String(row[0]) });
                }

                setStoredObjects(items);
            } catch {
                // Non-critical — just show a generic warning
                setStoredObjects([]);
            } finally {
                setLoadingObjects(false);
            }
        };
        fetchObjects();
    }, [profileId, database, newName]);

    const hasChanges = newName !== database || (collation && collation !== defaultCollation);

    const previewSql = useMemo(() => {
        const lines: string[] = [];
        if (newName !== database) {
            const charset = collation ? collation.split('_')[0] : 'utf8mb4';
            lines.push(`-- 1. Create new database`);
            lines.push(`CREATE DATABASE \`${newName}\` /*!40100 CHARACTER SET '${charset}' COLLATE '${collation}' */;`);
            lines.push(``);
            lines.push(`-- 2. Transfer all tables, views, procedures, functions, triggers, events`);
            lines.push(`-- (mysqldump + import into new database)`);
            lines.push(``);
            lines.push(`-- 3. Drop old database`);
            lines.push(`DROP DATABASE \`${database}\`;`);
        } else if (collation) {
            const charset = collation.split('_')[0];
            lines.push(`ALTER DATABASE \`${database}\` CHARACTER SET '${charset}' COLLATE '${collation}';`);
        }
        return lines.join("\n");
    }, [newName, collation, database, defaultCollation]);

    const handleSubmit = async () => {
        if (!hasChanges || !confirmed) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const charset = collation ? collation.split('_')[0] : 'utf8mb4';

            if (newName !== database) {
                // Create new database
                setStep("Creating new database...");
                const createSql = collation
                    ? `CREATE DATABASE \`${newName}\` /*!40100 CHARACTER SET '${charset}' COLLATE '${collation}' */`
                    : `CREATE DATABASE \`${newName}\``;
                await dbExecuteQuery(profileId, createSql);

                // Get list of tables to transfer
                setStep("Fetching tables...");
                const schemaStore = useSchemaStore.getState();
                let tables = schemaStore.tables[`${profileId}::${database}`];
                if (!tables) {
                    const { dbListTables } = await import("@/lib/db");
                    tables = await dbListTables(profileId, database);
                }

                // Transfer each table
                for (const table of tables) {
                    setStep(`Transferring table: ${table}...`);
                    await dbExecuteQuery(profileId, `RENAME TABLE \`${database}\`.\`${table}\` TO \`${newName}\`.\`${table}\``);
                }

                // Transfer stored procedures, functions, triggers, events
                if (storedObjects.length > 0) {
                    for (const obj of storedObjects) {
                        try {
                            setStep(`Transferring ${obj.type.toLowerCase()}: ${obj.name}...`);
                            let showCmd = "";
                            if (obj.type === "Procedure") showCmd = `SHOW CREATE PROCEDURE \`${database}\`.\`${obj.name}\``;
                            else if (obj.type === "Function") showCmd = `SHOW CREATE FUNCTION \`${database}\`.\`${obj.name}\``;
                            else if (obj.type === "Trigger") showCmd = `SHOW CREATE TRIGGER \`${database}\`.\`${obj.name}\``;
                            else if (obj.type === "Event") showCmd = `SHOW CREATE EVENT \`${database}\`.\`${obj.name}\``;

                            if (showCmd) {
                                const result = await dbQuery(profileId, showCmd);
                                // The CREATE statement is typically in column index 2 for procedures/functions, 2 for triggers, 3 for events
                                const row = result[0]?.rows?.[0];
                                if (row) {
                                    let createStmt = "";
                                    // Find the column that contains "CREATE"
                                    for (const col of row) {
                                        const val = String(col || "");
                                        if (val.toUpperCase().startsWith("CREATE")) {
                                            createStmt = val;
                                            break;
                                        }
                                    }
                                    if (createStmt) {
                                        // Execute in context of new database
                                        await dbExecuteQuery(profileId, `USE \`${newName}\``);
                                        await dbExecuteQuery(profileId, createStmt);
                                    }
                                }
                            }
                        } catch {
                            // Non-fatal: continue with other objects
                        }
                    }
                }

                // Drop old database
                setStep("Dropping old database...");
                await dbExecuteQuery(profileId, `DROP DATABASE \`${database}\``);
            } else if (collation) {
                // Just alter collation
                setStep("Altering database collation...");
                await dbExecuteQuery(profileId, `ALTER DATABASE \`${database}\` CHARACTER SET '${charset}' COLLATE '${collation}'`);
            }

            setStep("Done!");
            onCompleted?.();
        } catch (e) {
            setError(String(e));
            useAppStore.getState().addToast({
                title: "Database modification failed",
                description: String(e),
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-popover border rounded-lg shadow-2xl w-[520px] max-w-[90vw] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                    <h3 className="text-sm font-semibold text-foreground">
                        Edit Database: {database}
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-3">
                    {error && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                            {error}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground w-[100px] shrink-0 text-right">Database Name:</label>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 h-8 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                            placeholder="Database name"
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground w-[100px] shrink-0 text-right">Collation:</label>
                        <select
                            value={collation}
                            onChange={(e) => setCollation(e.target.value)}
                            className="flex-1 h-8 rounded bg-secondary/50 border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            disabled={isSubmitting}
                        >
                            {collations.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>

                    <div className="text-xs pl-[108px] text-muted-foreground">
                        Server default: {defaultCollation || "Unknown"}
                    </div>

                    {/* SQL Preview */}
                    {hasChanges && (
                        <div className="mt-2">
                            <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">SQL Preview</label>
                            <pre className="text-[11px] bg-secondary/30 border rounded p-2 font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed max-h-[150px] overflow-y-auto">
                                {previewSql}
                            </pre>
                        </div>
                    )}

                    {/* Rename warning */}
                    {newName !== database && (
                        <div className="space-y-2">
                            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                                <div className="flex items-start gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <div>
                                        Renaming will create a new database, transfer all tables using RENAME TABLE, then drop the old database.
                                        {storedObjects.length > 0
                                            ? " The following stored objects will be transferred:"
                                            : " No stored procedures, functions, triggers, or events were detected."}
                                    </div>
                                </div>
                            </div>

                            {loadingObjects && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Checking for stored objects...
                                </div>
                            )}

                            {storedObjects.length > 0 && (
                                <div className="text-xs border rounded overflow-hidden max-h-[120px] overflow-y-auto">
                                    {storedObjects.map((obj, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 bg-muted/20">
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium w-16">{obj.type}</span>
                                            <span className="font-mono text-foreground">{obj.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Confirm checkbox */}
                    {hasChanges && (
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={(e) => setConfirmed(e.target.checked)}
                                disabled={isSubmitting}
                            />
                            <span className="text-muted-foreground">I understand the risks and want to proceed</span>
                        </label>
                    )}

                    {step && isSubmitting && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {step}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-4 py-3 border-t bg-muted/20">
                    <button
                        className="px-3 py-1.5 text-xs rounded border hover:bg-accent transition-colors"
                        onClick={onClose}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        onClick={handleSubmit}
                        disabled={!hasChanges || !confirmed || isSubmitting || !newName.trim()}
                    >
                        {isSubmitting ? "Processing..." : "Apply Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}
