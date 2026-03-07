import { useState, useRef, useEffect, useCallback } from "react";
import { useLayoutStore } from "@/state/layoutStore";
import { useModelsStore } from "@/state/modelsStore";
import { useSchemaStore } from "@/state/schemaStore";
import { useProfilesStore } from "@/state/profilesStore";
import { aiGenerateQuery, dbGetSchemaDdl, vaultGet } from "@/lib/db";
import { cn } from "@/lib/utils/cn";
import { Send, Loader2, Sparkles, Copy, ExternalLink, Trash2, ChevronDown } from "lucide-react";

interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

function extractSqlBlocks(text: string): string[] {
    const regex = /```(?:sql)?\s*\n?([\s\S]*?)```/gi;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        blocks.push(match[1].trim());
    }
    // If no code blocks found, treat the entire response as SQL if it looks like one
    if (blocks.length === 0 && /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/im.test(text)) {
        blocks.push(text.trim());
    }
    return blocks;
}

export function AiChatSidebar() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const openTab = useLayoutStore((s) => s.openTab);

    // Model selection
    const providers = useModelsStore((s) => s.providers);
    const allModels = providers.flatMap((p) =>
        p.models.map((m) => ({ providerId: p.id, providerName: p.name, providerType: p.type, baseUrl: p.baseUrl, modelId: m.id, modelName: m.name }))
    );
    const [selectedModelKey, setSelectedModelKey] = useState("");

    // Resolve the active model
    const activeModel = allModels.find((m) => `${m.providerId}::${m.modelId}` === selectedModelKey) || allModels[0] || null;

    // Get active connection context
    const connectedProfiles = useSchemaStore((s) => s.connectedProfiles);
    const schemaDatabases = useSchemaStore((s) => s.databases);
    const profiles = useProfilesStore((s) => s.profiles);
    const connectedIds = Object.keys(connectedProfiles);
    const firstConnectedId = connectedIds[0] || "";
    const firstProfile = profiles.find((p) => p.id === firstConnectedId);
    const firstDb = (schemaDatabases[firstConnectedId] || [])[0] || "";

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(scrollToBottom, [messages, scrollToBottom]);

    const handleOpenInTab = (sql: string) => {
        openTab({
            title: "AI Query",
            type: "sql",
            meta: {
                profileId: firstConnectedId,
                database: firstDb,
                initialSql: sql,
            },
        });
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: input.trim(),
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setIsLoading(true);

        try {
            if (!activeModel) {
                throw new Error("No AI model configured. Go to AI Models to set one up.");
            }

            // Get schema context
            let schemaContext = "";
            if (firstConnectedId && firstDb) {
                try {
                    schemaContext = await dbGetSchemaDdl(firstConnectedId, firstDb);
                } catch {
                    schemaContext = "(schema unavailable)";
                }
            }

            const apiKey = await vaultGet(`ai_key_${activeModel.providerId}`);

            const result = await aiGenerateQuery(
                activeModel.providerType,
                activeModel.baseUrl || null,
                apiKey,
                activeModel.modelId,
                input.trim(),
                schemaContext,
                ""
            );

            const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: result,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const assistantMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `⚠️ Error: ${errMsg}`,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-background text-foreground overflow-hidden">
            {/* Header */}
            <div className="h-9 px-3 flex items-center justify-between border-b shrink-0 bg-background/50">
                <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="font-semibold text-xs uppercase tracking-wider">AI Chat</span>
                </div>
                {messages.length > 0 && (
                    <button
                        onClick={() => setMessages([])}
                        className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                        title="Clear chat"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Connection indicator */}
            {firstProfile && (
                <div className="px-3 py-1.5 border-b text-[10px] text-muted-foreground bg-muted/20 shrink-0">
                    Connected: <span className="text-foreground font-medium">{firstProfile.name}</span>
                    {firstDb && <> / <span className="text-foreground font-medium">{firstDb}</span></>}
                </div>
            )}

            {/* Model selector */}
            {allModels.length > 0 && (
                <div className="px-3 py-1.5 border-b shrink-0 bg-muted/10">
                    <div className="relative">
                        <select
                            value={activeModel ? `${activeModel.providerId}::${activeModel.modelId}` : ""}
                            onChange={(e) => setSelectedModelKey(e.target.value)}
                            className="w-full text-[11px] bg-muted/30 border rounded px-2 py-1 pr-6 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500/50 truncate"
                        >
                            {allModels.map((m) => (
                                <option key={`${m.providerId}::${m.modelId}`} value={`${m.providerId}::${m.modelId}`}>
                                    {m.modelName} ({m.providerName})
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    </div>
                </div>
            )}

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
                {messages.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 gap-2 py-8">
                        <Sparkles className="w-8 h-8" />
                        <p className="text-xs text-center max-w-[180px]">
                            Ask anything about your database. SQL results are clickable!
                        </p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className={cn(
                        "flex flex-col gap-1.5",
                        msg.role === "user" ? "items-end" : "items-start"
                    )}>
                        <div className={cn(
                            "text-xs rounded-lg px-3 py-2 max-w-[95%] break-words",
                            msg.role === "user"
                                ? "bg-indigo-500/20 text-foreground"
                                : "bg-muted/50 text-foreground border"
                        )}>
                            {msg.role === "assistant" ? (
                                <AssistantMessage
                                    content={msg.content}
                                    onOpenInTab={handleOpenInTab}
                                    onCopy={handleCopy}
                                />
                            ) : (
                                <span className="whitespace-pre-wrap">{msg.content}</span>
                            )}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="flex items-center gap-1.5 text-indigo-400 text-[11px]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Thinking...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t p-2">
                <div className="flex gap-1.5">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Ask about your database..."
                        className="flex-1 bg-muted/30 border rounded px-2.5 py-1.5 text-xs resize-none h-16 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="shrink-0 w-8 h-8 self-end rounded bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-600 transition-colors disabled:opacity-40"
                        title="Send (Enter)"
                    >
                        {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Send className="w-3.5 h-3.5" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Sub-component to render assistant messages with clickable SQL blocks
function AssistantMessage({
    content,
    onOpenInTab,
    onCopy,
}: {
    content: string;
    onOpenInTab: (sql: string) => void;
    onCopy: (text: string) => void;
}) {
    const sqlBlocks = extractSqlBlocks(content);

    if (sqlBlocks.length === 0) {
        return <span className="whitespace-pre-wrap">{content}</span>;
    }

    // Split content around code blocks and render inline
    const parts = content.split(/```(?:sql)?\s*\n?[\s\S]*?```/gi);

    return (
        <div className="flex flex-col gap-2">
            {parts.map((textPart, i) => (
                <div key={i}>
                    {textPart.trim() && (
                        <span className="whitespace-pre-wrap">{textPart.trim()}</span>
                    )}
                    {i < sqlBlocks.length && (
                        <div className="mt-1.5 rounded border bg-background/80 overflow-hidden group">
                            <pre className="p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
                                {sqlBlocks[i]}
                            </pre>
                            <div className="flex border-t">
                                <button
                                    onClick={() => onOpenInTab(sqlBlocks[i])}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                                    title="Open in new Query tab"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    Open in Tab
                                </button>
                                <div className="w-px bg-border" />
                                <button
                                    onClick={() => onCopy(sqlBlocks[i])}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                                    title="Copy SQL"
                                >
                                    <Copy className="w-3 h-3" />
                                    Copy
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
