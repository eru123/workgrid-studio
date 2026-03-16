import { useState, useCallback } from "react";
import {
    useProfilesStore,
    DatabaseType,
    DB_TYPE_LABELS,
    DB_TYPE_COLORS,
    DB_TYPE_DEFAULT_PORTS,
    createDefaultFormData,
    type ProfileFormData,
} from "@/state/profilesStore";
import { useSchemaStore } from "@/state/schemaStore";
import { dbConnect } from "@/lib/db";
import { appendConnectionOutput, formatConnectionTarget, formatOutputError } from "@/lib/output";
import { cn } from "@/lib/utils/cn";
import {
    MariadbIcon,
    MysqlIcon,
    PostgresIcon,
    SqliteIcon,
} from "@/components/icons/DatabaseTypeIcons";
import { Database, CheckCircle2, AlertCircle, Loader2, X, ChevronRight } from "lucide-react";

const SUPPORTED_TYPES: DatabaseType[] = ["mysql", "mariadb"];
const ALL_TYPES: DatabaseType[] = ["mysql", "mariadb", "postgres", "sqlite", "mssql"];

const DB_ICONS: Partial<Record<DatabaseType, React.ElementType>> = {
    mysql: MysqlIcon,
    mariadb: MariadbIcon,
    postgres: PostgresIcon,
    sqlite: SqliteIcon,
    mssql: Database,
};

interface Props {
    onClose: () => void;
}

type Step = 1 | 2 | 3;
type TestState = "idle" | "testing" | "success" | "error";

export function OnboardingFlow({ onClose }: Props) {
    const addProfile = useProfilesStore((s) => s.addProfile);
    const setConnectionStatus = useProfilesStore((s) => s.setConnectionStatus);
    const addConnection = useSchemaStore((s) => s.addConnection);

    const [step, setStep] = useState<Step>(1);
    const [selectedType, setSelectedType] = useState<DatabaseType>("mysql");
    const [form, setForm] = useState<ProfileFormData>(createDefaultFormData("mysql"));
    const [testState, setTestState] = useState<TestState>("idle");
    const [testError, setTestError] = useState<string | null>(null);
    const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);

    const setField = <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSelectType = (type: DatabaseType) => {
        setSelectedType(type);
        setForm(createDefaultFormData(type));
    };

    const handleTestConnection = useCallback(async () => {
        setTestState("testing");
        setTestError(null);

        const profile = addProfile(form);
        setCreatedProfileId(profile.id);
        setConnectionStatus(profile.id, "connecting");

        try {
            await dbConnect({
                profile_id: profile.id,
                host: form.host,
                port: form.port ?? DB_TYPE_DEFAULT_PORTS[form.type] ?? 3306,
                user: form.user,
                password: form.password,
                database: form.database || null,
                ssl: form.ssl,
                ssl_ca_file: form.sslCaFile || null,
                ssl_cert_file: form.sslCertFile || null,
                ssl_key_file: form.sslKeyFile || null,
                ssl_reject_unauthorized: form.sslRejectUnauthorized ?? false,
                db_type: form.type,
                ssh: form.ssh,
                ssh_host: form.sshHost,
                ssh_port: form.sshPort,
                ssh_user: form.sshUser,
                ssh_password: form.sshPassword || null,
                ssh_key_file: form.sshKeyFile || null,
                ssh_passphrase: form.sshPassphrase || null,
                ssh_strict_key_checking: form.sshStrictKeyChecking ?? false,
                ssh_keep_alive_interval: form.sshKeepAliveInterval ?? 0,
                ssh_compression: form.sshCompression ?? true,
            });
            setConnectionStatus(profile.id, "connected");
            addConnection(profile.id, profile.name, profile.color);
            appendConnectionOutput(profile, "success", `Connected to ${formatConnectionTarget(profile)}.`);
            setTestState("success");
            setStep(3);
        } catch (e) {
            const msg = formatOutputError(e);
            setConnectionStatus(profile.id, "error");
            appendConnectionOutput(profile, "error", `Connection failed: ${msg}`);
            setTestError(msg);
            setTestState("error");
        }
    }, [form, addProfile, setConnectionStatus, addConnection]);

    const handleRetry = () => {
        setTestState("idle");
        setTestError(null);
        setStep(2);
    };

    const isFormValid = form.name.trim() !== "" && form.host.trim() !== "" && form.user.trim() !== "";

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Connect your first database"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                    <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-primary" />
                        <h2 className="font-semibold text-sm">Connect your first database</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        aria-label="Skip onboarding"
                        title="Skip"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                    {([1, 2, 3] as Step[]).map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <div
                                className={cn(
                                    "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors",
                                    step === s
                                        ? "bg-primary text-primary-foreground"
                                        : step > s
                                        ? "bg-primary/20 text-primary"
                                        : "bg-muted text-muted-foreground",
                                )}
                            >
                                {s}
                            </div>
                            {s < 3 && <div className={cn("flex-1 h-px w-8", step > s ? "bg-primary/40" : "bg-border")} />}
                        </div>
                    ))}
                    <span className="ml-2 text-xs text-muted-foreground">
                        {step === 1 && "Choose database type"}
                        {step === 2 && "Connection details"}
                        {step === 3 && "Connected!"}
                    </span>
                </div>

                {/* ── Step 1: Type selection ── */}
                {step === 1 && (
                    <div className="p-5 flex flex-col gap-3">
                        <p className="text-xs text-muted-foreground mb-1">
                            Select the type of database you want to connect to.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {ALL_TYPES.map((type) => {
                                const Icon = DB_ICONS[type] ?? Database;
                                const supported = SUPPORTED_TYPES.includes(type);
                                return (
                                    <button
                                        key={type}
                                        onClick={() => supported && handleSelectType(type)}
                                        disabled={!supported}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                                            !supported && "opacity-40 cursor-not-allowed",
                                            supported && selectedType === type
                                                ? "border-primary bg-primary/5"
                                                : supported
                                                ? "hover:bg-accent border-border/60"
                                                : "border-border/30",
                                        )}
                                    >
                                        <Icon style={{ color: DB_TYPE_COLORS[type] }} className="w-5 h-5 shrink-0" />
                                        <div>
                                            <div className="text-xs font-medium">{DB_TYPE_LABELS[type]}</div>
                                            {!supported && (
                                                <div className="text-[10px] text-muted-foreground">Coming soon</div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex justify-between mt-2">
                            <button
                                onClick={onClose}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
                            >
                                Skip
                            </button>
                            <button
                                onClick={() => setStep(2)}
                                className="flex items-center gap-1.5 rounded bg-primary px-4 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                Next <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 2: Connection form ── */}
                {step === 2 && (
                    <div className="p-5 flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2 flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">Connection Name *</label>
                                <input
                                    type="text"
                                    placeholder="My Database"
                                    value={form.name}
                                    onChange={(e) => setField("name", e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">Host *</label>
                                <input
                                    type="text"
                                    placeholder="localhost"
                                    value={form.host}
                                    onChange={(e) => setField("host", e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">Port</label>
                                <input
                                    type="number"
                                    placeholder={String(DB_TYPE_DEFAULT_PORTS[form.type] ?? 3306)}
                                    value={form.port ?? ""}
                                    onChange={(e) => setField("port", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">User *</label>
                                <input
                                    type="text"
                                    placeholder="root"
                                    value={form.user}
                                    onChange={(e) => setField("user", e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">Password</label>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={form.password}
                                    onChange={(e) => setField("password", e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="col-span-2 flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-muted-foreground">Default Database</label>
                                <input
                                    type="text"
                                    placeholder="Optional"
                                    value={form.database}
                                    onChange={(e) => setField("database", e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {testState === "error" && testError && (
                            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <span className="break-all">{testError}</span>
                            </div>
                        )}

                        <div className="flex justify-between mt-1">
                            <button
                                onClick={() => { setStep(1); setTestState("idle"); setTestError(null); }}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleTestConnection}
                                disabled={!isFormValid || testState === "testing"}
                                className="flex items-center gap-1.5 rounded bg-primary px-4 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                {testState === "testing" ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Connecting...</>
                                ) : (
                                    <>Test & Connect <ChevronRight className="w-3 h-3" /></>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 3: Success ── */}
                {step === 3 && (
                    <div className="p-5 flex flex-col items-center gap-4 text-center">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-6 h-6 text-green-500" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Connected successfully!</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {form.name} is ready. You can explore the schema in the sidebar.
                            </p>
                        </div>

                        {testState === "error" && (
                            <button
                                onClick={handleRetry}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Try different settings
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="w-full rounded bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            Get Started
                        </button>
                        {createdProfileId && (
                            <p className="text-[11px] text-muted-foreground/60">
                                Connection saved. Add more in the Servers panel.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
