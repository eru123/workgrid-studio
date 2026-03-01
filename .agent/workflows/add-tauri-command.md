---
description: How to add a new Tauri command with frontend wrapper
---

# Add Tauri Command

Follow these steps to add a new Tauri backend command and expose it to the frontend.

## 1. Define the Rust command in `src-tauri/src/lib.rs`

Add the command function with the `#[tauri::command]` attribute:

```rust
#[tauri::command]
async fn db_your_command(
    state: State<'_, DbState>,
    profile_id: String,
    // ... additional parameters
) -> Result<YourReturnType, String> {
    let pool = get_pool(&state, &profile_id)?;
    let mut conn = pool.get_conn().await.map_err(|e| {
        let msg = format!("Connection error: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    // Execute your query
    let result = conn.query::<mysql_async::Row, _>("YOUR SQL QUERY").await.map_err(|e| {
        let msg = format!("Query error [YOUR SQL]: {}", e);
        log_error(&profile_id, &msg);
        msg
    })?;

    log_query_result(&profile_id, "YOUR SQL", result.len());
    Ok(/* processed result */)
}
```

## 2. Register the command in the handler

In the same file, add it to the `generate_handler![]` macro at the bottom of the `run()` function:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    db_your_command,  // <-- Add here
])
```

## 3. Add a TypeScript wrapper in `src/lib/db.ts`

```typescript
export async function dbYourCommand(profileId: string /*, ...params */): Promise<YourType> {
    return invoke<YourType>("db_your_command", { profileId /*, ...params */ });
}
```

## 4. Use in components

Import and call from the component:

```typescript
import { dbYourCommand } from "@/lib/db";

// Inside a component or handler:
try {
    const result = await dbYourCommand(profileId);
    // Handle result
} catch (e) {
    // Show error to user
}
```

## Checklist
- [ ] Command added to `lib.rs` with proper error handling and logging
- [ ] Command registered in `generate_handler![]`
- [ ] TypeScript wrapper added in `src/lib/db.ts` with proper types
- [ ] Never call `invoke()` directly from components
