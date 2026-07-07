# WorkGrid UI (`src/wg`)

The WorkGrid Studio UI shell — a **UI-only** layer adapted from VS Code's
frontend. Native source inside the WorkGrid Studio app (import via `@/wg`).

- **Components + styling + animation only.** No backend logic, no services, no
  file system, no extension host, no telemetry.
- Base widgets (`sash`, `grid`, `tree`, `list`, `hover`, `menu`, `actionbar`,
  `button`, `inputbox`, `breadcrumbs`, ...) are adapted from VS Code's
  `vs/base/browser/ui/**` — they are DI-free and depend only on `base/**` + a
  passthrough `nls` stub.
- The workbench shell parts (`Workbench`, `ActivityBar`, `Sidebar`,
  `EditorArea`/`Tabs`/`Breadcrumbs`, `StatusBar`, `Panel`, `CommandPalette`,
  `Notifications`, `ContextMenu`, `Tooltip`) are **React components** built on
  those primitives. VS Code's `Part` classes are irreducibly DI-coupled
  (8–21 injected services each) and were not portable without reconstructing
  the service graph — so they're rewritten as React components that take
  **adapter-interface props** where backend calls plug in.
- **Monaco** is consumed via the published `monaco-editor` package + the
  `@monaco-editor/react` wrapper. The in-repo editor is not extracted.
- **Backend seams** are left open and unimplemented. See `backend/`.

See `NOTICES.md` for upstream attribution (VS Code, codicons, Myers diff).

## Layout

```
src/wg/
├── base/            # adapted from vs/base/** (foundation + widgets)
├── theme/           # color tokens + registerColor shim + CSS-var theming (--wg-*)
├── editor/          # Monaco wrapper (3 modes), language seam, provider-adapter interfaces
├── shell/           # React shell parts over ported primitives (+ Welcome screen)
├── backend/         # Rust-IPC seam interfaces (unimplemented)
├── nls.ts           # NLS passthrough stub
└── index.ts         # public API barrel
```

## Theming

All color tokens are emitted as `--wg-<id>` CSS variables (e.g.
`--wg-editor-background`, `--wg-activityBar-foreground`). Call
`applyTheme('dark' | 'light' | 'hc' | 'hcLight')` on startup to resolve every
registered token and write the variables to `:root`. Fallback values live in
`theme/theme-tokens.css`.

## Required asset: `codicon.ttf`

`base/browser/ui/codicons/codicon/codicon.css` references `./codicon.ttf`,
which is not in source control. It ships inside `monaco-editor`:

```
node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf
```

Copy it next to the CSS so the relative `url("./codicon.ttf")` resolves:

```
src/wg/base/browser/ui/codicons/codicon/codicon.ttf
```

Until then, codicon glyphs render as empty boxes; everything else works.

## Backend integration (future Rust IPC)

The seams live in `backend/` — TypeScript interfaces only, no implementation.
The Rust IPC layer implements them and feeds:
- tree/list data sources (`TreeBackend`) — e.g. the explorer,
- Monaco language services (`EditorBackend`) — completion / hover / diagnostics,
  wired into Monaco via `editor/providers.ts` + `editor/languages.ts`,
- general backend operations (`BackendAdapter`) — file ops, etc.
