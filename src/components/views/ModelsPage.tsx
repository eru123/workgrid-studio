import { useState } from "react";
import { useModelsStore, ModelProvider } from "@/state/modelsStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";

export function ModelsPage() {
    const { providers, addProvider, deleteProvider, selectedProviderId, setSelectedProviderId } = useModelsStore();
    const [isAdding, setIsAdding] = useState(false);

    const [newProv, setNewProv] = useState<Partial<ModelProvider>>({
        type: "openai",
        name: "",
        baseUrl: "",
        apiKeyRef: "", // UI will pass reference value
    });

    const handleAdd = () => {
        if (!newProv.name) return;
        addProvider({
            id: crypto.randomUUID(),
            type: newProv.type as ModelProvider["type"],
            name: newProv.name,
            baseUrl: newProv.baseUrl,
            apiKeyRef: newProv.apiKeyRef,
            models: [],
        });
        setIsAdding(false);
    };

    return (
        <div className="p-6 h-full overflow-auto bg-background flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">AI Models</h2>
                    <p className="text-muted-foreground text-sm">Bring your own token (BYOT) configurations.</p>
                </div>
                <Button onClick={() => setIsAdding(!isAdding)}>
                    {isAdding ? "Cancel" : "Add Provider"}
                </Button>
            </div>

            {isAdding && (
                <Card className="border-primary/50">
                    <CardHeader>
                        <CardTitle>New Provider Config</CardTitle>
                        <CardDescription>Security note: API keys are converted to vault refs.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <div className="flex gap-4">
                            <select
                                className="border p-2 rounded bg-background"
                                value={newProv.type}
                                onChange={(e) => setNewProv({ ...newProv, type: e.target.value as ModelProvider["type"] })}
                            >
                                <option value="openai">OpenAI API</option>
                                <option value="gemini">Gemini API</option>
                                <option value="deepseek">DeepSeek</option>
                                <option value="other">Other (OpenAI-compatible)</option>
                            </select>
                            <Input
                                placeholder="Provider Name (e.g., Local LLM)"
                                value={newProv.name}
                                onChange={(e) => setNewProv({ ...newProv, name: e.target.value })}
                                className="flex-1"
                            />
                        </div>
                        {newProv.type === "other" && (
                            <Input
                                placeholder="Base URL (e.g., http://localhost:11434/v1)"
                                value={newProv.baseUrl}
                                onChange={(e) => setNewProv({ ...newProv, baseUrl: e.target.value })}
                            />
                        )}
                        <Input
                            type="password"
                            placeholder="API Key (Will not be saved in plaintext)"
                            value={newProv.apiKeyRef}
                            onChange={(e) => setNewProv({ ...newProv, apiKeyRef: e.target.value })}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setIsAdding(false)}>Cancel</Button>
                            <Button onClick={handleAdd}>Save Config</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                {providers.map((p: ModelProvider) => (
                    <Card key={p.id} className={p.id === selectedProviderId ? "border-primary" : ""}>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                <span>{p.name}</span>
                                <span className="text-xs px-2 py-1 bg-muted rounded-full uppercase">{p.type}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm truncate text-muted-foreground">URL: {p.baseUrl || "Default"}</p>
                            <div className="mt-4 flex gap-2">
                                <Button
                                    variant={p.id === selectedProviderId ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => setSelectedProviderId(p.id)}
                                >
                                    {p.id === selectedProviderId ? "Selected" : "Select Default"}
                                </Button>
                                <Button variant="outline" size="sm">Test Connection</Button>
                                <Button variant="destructive" size="sm" onClick={() => deleteProvider(p.id)}>Remove</Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {providers.length === 0 && !isAdding && (
                    <div className="col-span-full h-32 flex items-center justify-center border border-dashed rounded bg-muted/20 text-muted-foreground">
                        No AI providers configured. Add one to use DB query tools.
                    </div>
                )}
            </div>
        </div>
    );
}
