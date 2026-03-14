import { useState } from "react";
import { useTasksStore, TaskStatus } from "@/state/tasksStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/Card";

export function TasksView() {
    const { tasks, addTask, updateTask } = useTasksStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newTask, setNewTask] = useState({ title: "", description: "", status: "todo" as TaskStatus, tags: "frontend" });

    const handleAdd = () => {
        if (!newTask.title) return;
        addTask({
            title: newTask.title,
            description: newTask.description,
            status: newTask.status,
            tags: newTask.tags.split(",").map(t => t.trim()),
        });
        setNewTask({ title: "", description: "", status: "todo", tags: "" });
        setIsAdding(false);
    };

    return (
        <div className="p-6 h-full overflow-auto bg-background text-foreground flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Tasks (Append-Only)</h2>
                    <p className="text-sm text-muted-foreground">Rules: AI and users can add tasks, edit status, but never delete.</p>
                </div>
                <Button onClick={() => setIsAdding(!isAdding)}>{isAdding ? "Cancel" : "Add Task"}</Button>
            </div>

            {isAdding && (
                <Card className="border-primary/50 shadow-sm mb-4">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold">New Task</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <Input
                            placeholder="Title"
                            value={newTask.title}
                            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                        />
                        <Input
                            placeholder="Description"
                            value={newTask.description}
                            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                        />
                        <div className="flex gap-2">
                            <select
                                className="flex-1 rounded border px-3 py-2 text-sm bg-background"
                                value={newTask.status}
                                onChange={(e) => setNewTask({ ...newTask, status: e.target.value as TaskStatus })}
                            >
                                <option value="todo">Todo</option>
                                <option value="doing">Doing</option>
                                <option value="blocked">Blocked</option>
                                <option value="done">Done</option>
                            </select>
                            <Input
                                placeholder="Tags (comma separated)"
                                value={newTask.tags}
                                onChange={(e) => setNewTask({ ...newTask, tags: e.target.value })}
                                className="flex-1"
                            />
                            <Button onClick={handleAdd}>Save</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tasks.map((task) => (
                    <Card key={task.id} className="border bg-card">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex justify-between items-start gap-4">
                                <span>{task.title}</span>
                                <select
                                    className="text-xs p-1 rounded border bg-background text-foreground"
                                    value={task.status}
                                    onChange={(e) => updateTask(task.id, { status: e.target.value as TaskStatus })}
                                >
                                    <option value="todo">TODO</option>
                                    <option value="doing">DOING</option>
                                    <option value="blocked">BLOCKED</option>
                                    <option value="done">DONE</option>
                                </select>
                            </CardTitle>
                            <CardDescription className="text-xs opacity-60">
                                Added: {new Date(task.createdAt).toLocaleString()}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-foreground mb-4">{task.description}</p>
                            <div className="flex gap-1 flex-wrap">
                                {task.tags.map(tag => (
                                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-muted rounded-full">#{tag}</span>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {tasks.length === 0 && !isAdding && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                        No tasks yet. Create one to begin tracking work.
                    </div>
                )}
            </div>
        </div>
    );
}
