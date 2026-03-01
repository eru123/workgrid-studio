import { useLayoutStore } from "@/state/layoutStore";
import { Database, FileCode2, Bot, CheckSquare, Terminal, Server } from "lucide-react";

export function WelcomeTab() {
    const { openTab, togglePanel, setActiveView } = useLayoutStore();

    return (
        <div className="w-full h-full flex items-center justify-center">
            <div className="max-w-lg w-full flex flex-col items-center gap-8 px-6">
                {/* Logo / Title */}
                <div className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center">
                        <Database className="w-7 h-7 text-primary-foreground" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">WorkGrid Studio</h1>
                    <p className="text-sm text-muted-foreground text-center">
                        A powerful desktop database client with AI-assisted query generation.
                    </p>
                </div>

                {/* Quick Actions */}
                <div className="w-full space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Get Started
                    </p>
                    <button
                        onClick={() => openTab({ title: "New Query", type: "sql" })}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left group"
                    >
                        <FileCode2 className="w-5 h-5 text-muted-foreground group-hover:text-accent-foreground" />
                        <div>
                            <div className="text-sm font-medium">New SQL Query</div>
                            <div className="text-xs text-muted-foreground">Open a blank SQL editor tab</div>
                        </div>
                        <span className="ml-auto text-xs text-muted-foreground border rounded px-1.5 py-0.5">Ctrl+N</span>
                    </button>

                    <button
                        onClick={() => setActiveView("servers")}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left group"
                    >
                        <Server className="w-5 h-5 text-muted-foreground group-hover:text-accent-foreground" />
                        <div>
                            <div className="text-sm font-medium">Manage Connections</div>
                            <div className="text-xs text-muted-foreground">Add, edit, or connect to databases via Servers view</div>
                        </div>
                    </button>

                    <button
                        onClick={() => openTab({ title: "AI Models", type: "models" })}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left group"
                    >
                        <Bot className="w-5 h-5 text-muted-foreground group-hover:text-accent-foreground" />
                        <div>
                            <div className="text-sm font-medium">Configure AI Models</div>
                            <div className="text-xs text-muted-foreground">Set up Gemini, OpenAI, DeepSeek, or custom providers</div>
                        </div>
                    </button>

                    <button
                        onClick={() => openTab({ title: "Tasks", type: "tasks" })}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left group"
                    >
                        <CheckSquare className="w-5 h-5 text-muted-foreground group-hover:text-accent-foreground" />
                        <div>
                            <div className="text-sm font-medium">View Tasks</div>
                            <div className="text-xs text-muted-foreground">Track work items (append-only)</div>
                        </div>
                    </button>

                    <button
                        onClick={() => togglePanel()}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left group"
                    >
                        <Terminal className="w-5 h-5 text-muted-foreground group-hover:text-accent-foreground" />
                        <div>
                            <div className="text-sm font-medium">Toggle Panel</div>
                            <div className="text-xs text-muted-foreground">Show logs and output</div>
                        </div>
                        <span className="ml-auto text-xs text-muted-foreground border rounded px-1.5 py-0.5">Ctrl+`</span>
                    </button>
                </div>

                {/* Footer hint */}
                <p className="text-xs text-muted-foreground/60 text-center">
                    WorkGrid Studio v0.1.0
                </p>
            </div>
        </div>
    );
}
