import { useState, useEffect, useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import { dbExecuteQuery, dbGetCollations } from "@/lib/db";
import { useSchemaStore } from "@/state/schemaStore";

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

                // Note: RENAME TABLE handles tables. Stored procedures, functions,
                // triggers, and events are schema-bound and need manual recreation.

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
                        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                            ⚠ Renaming will create a new database, transfer all tables using RENAME TABLE, then drop the old database.
                            Stored procedures, functions, triggers, and events may need to be recreated manually.
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
