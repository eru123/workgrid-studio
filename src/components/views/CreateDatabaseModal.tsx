import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { dbExecuteQuery, dbListDatabases } from "@/lib/db";
import { useSchemaStore } from "@/state/schemaStore";

interface Props {
    profileId: string;
    onClose: () => void;
    onCreated?: () => void;
}

const COLLATIONS = [
    "utf8mb4_general_ci",
    "utf8mb4_unicode_ci",
    "utf8mb4_bin",
    "utf8mb4_0900_ai_ci",
    "utf8_general_ci",
    "utf8_unicode_ci",
    "utf8_bin",
    "latin1_swedish_ci",
    "latin1_general_ci",
    "latin1_bin"
];

export function CreateDatabaseModal({ profileId, onClose, onCreated }: Props) {
    const [name, setName] = useState("");
    const [collation, setCollation] = useState("utf8mb4_0900_ai_ci");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const createCode = useMemo(() => {
        let sql = `CREATE DATABASE \`${name || "database_name"}\``;
        if (collation) {
            // Simple heuristic: extract charset from collation
            const charset = collation.split('_')[0];
            sql += ` /*!40100 CHARACTER SET '${charset}' COLLATE '${collation}' */`;
        }
        sql += `;`;
        return sql;
    }, [name, collation]);

    const handleCreate = async () => {
        if (!name.trim()) {
            setError("Database name cannot be empty");
            return;
        }
        setError(null);
        setIsSubmitting(true);
        try {
            await dbExecuteQuery(profileId, createCode);

            // Refresh databases
            const schemaStore = useSchemaStore.getState();
            schemaStore.setLoading(profileId, "databases", true);
            const dbs = await dbListDatabases(profileId);
            schemaStore.setDatabases(profileId, dbs);
            schemaStore.setLoading(profileId, "databases", false);

            onCreated?.();
            onClose();
        } catch (e: any) {
            setError(String(e));
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background w-[400px] rounded shadow-2xl border flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <span className="text-sm font-semibold">Create database ...</span>
                    <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4 text-sm">
                    {error && (
                        <div className="text-xs bg-red-500/10 text-red-500 border border-red-500/20 rounded p-2">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                        <label className="text-right pr-2">Name:</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter database name"
                            autoFocus
                            className="h-8 rounded bg-secondary/50 border px-2 focus:outline-none focus:ring-1 focus:ring-primary w-full"
                        />
                    </div>

                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                        <label className="text-right pr-2">Collation:</label>
                        <select
                            value={collation}
                            onChange={(e) => setCollation(e.target.value)}
                            className="h-8 rounded bg-secondary/50 border px-2 focus:outline-none focus:ring-1 focus:ring-primary w-full"
                        >
                            {COLLATIONS.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>

                    <div className="text-xs pl-[88px] text-muted-foreground">
                        Servers default: utf8mb4_0900_ai_ci
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            onClick={handleCreate}
                            disabled={isSubmitting || !name.trim()}
                            className="px-6 py-1.5 border border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded transition-colors disabled:opacity-50"
                        >
                            OK
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 border rounded hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="pt-2">
                        <div className="mb-1 text-xs">CREATE code:</div>
                        <pre className="text-[11px] font-mono p-2 bg-secondary/50 border rounded text-blue-500 whitespace-pre-wrap break-all h-20 overflow-y-auto">
                            <span className="text-blue-600 font-bold dark:text-blue-400">CREATE DATABASE</span> `{name || "database_name"}`
                            {collation ? ` /*!40100 CHARACTER SET '${collation.split('_')[0]}' COLLATE '${collation}' */` : ""}
                            ;
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}
