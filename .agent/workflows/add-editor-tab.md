---
description: How to add a new editor tab type (e.g. table designer, query results)
---

# Add New Editor Tab

Follow these steps to add a new tab type to the editor workbench.

// turbo-all

## 1. Add the tab type to `EditorTabType`

In `src/state/layoutStore.ts`, add your new type to the union:

```typescript
export type EditorTabType = "sql" | "results" | "schema" | "models" | "tasks" | "database-view" | "table-designer" | "your-new-type";
```

## 2. Create the view component

Create `src/components/views/YourNewView.tsx`:

```typescript
interface Props {
    profileId: string;
    database: string;
    // ... any data needed from tab.meta
}

export function YourNewView({ profileId, database }: Props) {
    return (
        <div className="flex flex-col w-full h-full bg-background text-foreground text-xs overflow-hidden">
            {/* Your content here */}
        </div>
    );
}
```

## 3. Register in EditorNode.tsx

In `src/components/layout/EditorNode.tsx`:

1. Add the import:
```typescript
import { YourNewView } from "@/components/views/YourNewView";
```

2. Add a case in the `TabContent` switch:
```typescript
case "your-new-type":
    return (
        <YourNewView
            profileId={tab.meta?.profileId ?? ""}
            database={tab.meta?.database ?? ""}
        />
    );
```

## 4. Open the tab from anywhere

```typescript
import { useLayoutStore } from "@/state/layoutStore";

// From inside a component:
const openTab = useLayoutStore((s) => s.openTab);
openTab({
    title: "My New Tab",
    type: "your-new-type",
    meta: { profileId, database },
});

// From outside React (e.g. event handlers):
useLayoutStore.getState().openTab({
    title: "My New Tab",
    type: "your-new-type",
    meta: { profileId, database },
});
```

## Checklist
- [ ] Type added to `EditorTabType` union in `layoutStore.ts`
- [ ] View component created in `src/components/views/`
- [ ] Case added in `EditorNode.tsx` `TabContent` switch
- [ ] Tab opening wired up from context menu / button / etc.
