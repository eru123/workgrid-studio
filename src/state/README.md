# Zustand Stores

This folder contains the app's client-side state containers. Most stores are
small, focused slices with their own persistence strategy and domain-specific
actions.

## `appStore.ts`

Purpose: ephemeral app UI state.

Actions:
- `setCommandPaletteOpen(open)`: open or close the command palette.
- `addToast(toast)`: enqueue a toast notification.
- `dismissToast(id)`: remove a toast.
- `addOutputEntry(entry)`: append an Output panel row.
- `clearOutputEntries()`: clear Output panel history.
- `setStatusBarInfo(info)`: update the bottom status bar payload.

## `layoutStore.ts`

Purpose: workbench layout, split panes, editor tabs, and persisted tab session.

Persistence: `layout-prefs.json`

Actions:
- `loadLayoutPrefs()`: hydrate persisted panel sizes, active view, active leaf, and editor tree.
- `saveLayoutPrefs()`: persist the current layout snapshot.
- `setActiveView(view)`: switch the primary activity view.
- `setActiveLeaf(leafId)`: focus a split-pane leaf.
- `setSidebarWidth(width)`: set primary sidebar width.
- `adjustSidebarWidth(delta)`: resize primary sidebar incrementally.
- `setPanelHeight(height)`: set bottom panel height.
- `adjustPanelHeight(delta)`: resize bottom panel incrementally.
- `toggleSidebar()`: show or hide the primary sidebar.
- `togglePanel()`: show or hide the bottom panel.
- `toggleBottomPanelSplit()`: toggle split mode inside the bottom panel.
- `setBottomPanelSplitRatio(ratio)`: set the split ratio for bottom panel panes.
- `toggleSecondarySidebar()`: show or hide the secondary sidebar.
- `adjustSecondarySidebarWidth(delta)`: resize the secondary sidebar incrementally.
- `restoreLastClosedTab()`: reopen the most recently closed tab.
- `openTab(tab, leafId?)`: open a new editor tab, optionally in a specific leaf.
- `closeTab(tabId, leafId)`: close a tab in a leaf.
- `closeOtherTabs(tabId, leafId)`: keep only the selected tab in a leaf.
- `closeTabsToRight(tabId, leafId)`: close tabs to the right of the selected tab.
- `closeAllTabs(leafId)`: close every tab in a leaf.
- `setActiveTab(tabId, leafId)`: focus a tab in a leaf.
- `updateTab(tabId, updates)`: update tab title, metadata, dirty state, or pinned state.
- `togglePinTab(tabId, leafId)`: toggle pinned state for a tab.
- `splitLeaf(leafId, direction)`: split the current editor pane.
- `splitLeafAndMove(tabId, sourceLeafId, targetLeafId, direction)`: split a pane and move a dragged tab into the new leaf.
- `closeLeaf(leafId)`: close a pane and merge its sibling upward.
- `resizeNode(nodeId, newRatio)`: resize a split node.
- `moveTab(tabId, sourceLeafId, targetLeafId, targetIndex?)`: reorder or move tabs between leaves.

## `modelsStore.ts`

Purpose: AI provider definitions and selected provider state.

Persistence: `models.json`

Actions:
- `loadProviders()`: hydrate AI providers from disk.
- `addProvider(provider)`: add a provider definition.
- `updateProvider(id, updates)`: update provider metadata or models.
- `deleteProvider(id)`: delete a provider and clear selection if needed.
- `setSelectedProviderId(id)`: choose the active provider.

## `profilesStore.ts`

Purpose: database connection profiles and global app preferences.

Persistence: `profiles.json`, `preferences.json`

Actions:
- `loadProfiles()`: hydrate profiles and global preferences.
- `addProfile(data)`: create and persist a profile.
- `updateProfile(id, updates)`: update profile fields.
- `deleteProfile(id)`: delete a profile.
- `duplicateProfile(id)`: clone an existing profile.
- `setConnectionStatus(id, status)`: update runtime connection state and last-connected timestamp.
- `setGlobalPreferences(prefs)`: merge and persist global preferences.

## `queryHistoryStore.ts`

Purpose: recent query execution history.

Persistence: `history.json`

Actions:
- `loadHistory()`: hydrate history from disk.
- `addHistoryItem(item)`: append a query to history with de-duplication and cap enforcement.
- `deleteHistoryItem(id)`: remove one history row.
- `toggleFavorite(id)`: toggle the `favorited` flag.
- `clearHistory(profileId?)`: clear all history or a single profile's non-favorited history.


## `savedQueriesStore.ts`

Purpose: saved SQL files, manifests, and scheduled query metadata.

Persistence: `queries/<profileId>/index.json` plus saved `.sql` files under the app data directory.

Actions:
- `loadProfileQueries(profileId)`: hydrate saved queries for one profile.
- `loadAllQueries(profileIds)`: hydrate saved queries for multiple profiles.
- `saveQuery(input)`: create or update a saved query and its manifest entry.
- `deleteQuery(profileId, queryId)`: remove a saved query and delete its file.
- `readQueryText(filePath)`: read a saved query file.
- `recordQueryRun(profileId, queryId, updates)`: persist scheduled-run metadata after execution.

## `schemaStore.ts`

Purpose: connection-scoped schema caches and live connection metadata.

Actions:
- `addConnection(profileId, name, color)`: mark a profile connected, start auto-refresh, and fetch server version.
- `removeConnection(profileId)`: remove a connection and clear cached schema state.
- `setLatency(profileId, ms)`: update keep-alive latency.
- `setServerVersion(profileId, version)`: cache the server version string.
- `setTableInfos(profileId, db, tableInfos)`: cache table metadata and derive table-name lists.
- `fetchServerVersion(profileId)`: query server variables and cache a friendly version string.
- `setDatabases(profileId, dbs)`: cache database names.
- `setTables(profileId, db, tables)`: cache table names for a database.
- `setColumns(profileId, db, table, columns)`: cache column metadata.
- `setLoading(key, kind, loading)`: update loading flags for databases, tables, or columns.
- `setError(key, error)`: cache an error string.
- `clearError(key)`: clear a cached error string.
- `refreshDatabases(profileId)`: reload database names from the backend.
- `refreshTables(profileId, db)`: reload table metadata for a database.

## `tasksStore.ts`

Purpose: append-only task tracking used by the Tasks view.

Persistence: `tasks.json`

Actions:
- `loadTasks()`: hydrate tasks from disk.
- `addTask(task)`: append a new task.
- `updateTask(id, updates)`: update a task's editable fields and refresh `updatedAt`.
