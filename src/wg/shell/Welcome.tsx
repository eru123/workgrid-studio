// WorkGrid Studio welcome screen — the default editor content. UI-only.

import { codiconClass } from "./icon.js";

export interface WelcomeProps {
	/** Optional recent items shown in the "Start" list. */
	recent?: readonly { readonly label: string; readonly description?: string; readonly icon?: string }[];
	/** Called when a start action is clicked. */
	onAction?: (actionId: string) => void;
}

const START_ACTIONS: { id: string; label: string; icon: string; description: string }[] = [
	{ id: "new-connection", label: "New Connection", icon: "remote", description: "Connect to a database" },
	{ id: "open-query", label: "New Query", icon: "new-file", description: "Open a blank SQL editor" },
	{ id: "open-recent", label: "Open Recent", icon: "history", description: "Reopen a recent connection" },
	{ id: "open-settings", label: "Settings", icon: "settings-gear", description: "Configure WorkGrid Studio" },
];

export function Welcome({ recent, onAction }: WelcomeProps) {
	return (
		<div
			style={{
				height: "100%",
				overflow: "auto",
				background: "var(--wg-editor-background, #1e1e1e)",
				color: "var(--wg-foreground, #cccccc)",
				display: "flex",
				justifyContent: "center",
				padding: "48px 24px",
			}}
		>
			<div style={{ maxWidth: 760, width: "100%" }}>
				{/* Hero */}
				<div style={{ marginBottom: 40, textAlign: "center" }}>
					<div
						style={{
							width: 72,
							height: 72,
							margin: "0 auto 16px",
							borderRadius: 16,
							background: "var(--wg-button-background, #0e639c)",
							color: "var(--wg-button-foreground, #ffffff)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 36,
						}}
					>
						<span className={codiconClass("database")} />
					</div>
					<h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 300, letterSpacing: 0.5 }}>
						WorkGrid Studio
					</h1>
					<p style={{ margin: 0, color: "var(--wg-descriptionForeground, #cccccc99)", fontSize: 14 }}>
						The cross-platform database studio. Editing logic is in the works — this is the UI shell.
					</p>
				</div>

				{/* Two-column: Start + Recent */}
				<div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
					{/* Start */}
					<div style={{ flex: "0 0 280px" }}>
						<h2 style={sectionHeaderStyle}>Start</h2>
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{START_ACTIONS.map((action) => (
								<li key={action.id}>
									<button
										style={startButtonStyle}
										onClick={() => onAction?.(action.id)}
									>
										<span className={`${codiconClass(action.icon)}`} style={{ fontSize: 16, opacity: 0.9 }} />
										<span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
											<span>{action.label}</span>
											<span style={{ fontSize: 11, color: "var(--wg-descriptionForeground, #cccccc99)" }}>
												{action.description}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					</div>

					{/* Recent */}
					<div style={{ flex: 1, minWidth: 0 }}>
						<h2 style={sectionHeaderStyle}>Recent</h2>
						{recent && recent.length > 0 ? (
							<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
								{recent.map((item, i) => (
									<li
										key={i}
										style={{
											padding: "8px 12px",
											borderRadius: 4,
											cursor: "pointer",
											display: "flex",
											alignItems: "center",
											gap: 10,
										}}
										onClick={() => onAction?.("open-recent")}
										onMouseEnter={(e) => (e.currentTarget.style.background = "var(--wg-list-hoverBackground, #2a2d2e)")}
										onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
									>
										<span className={codiconClass(item.icon ?? "database")} style={{ opacity: 0.8 }} />
										<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
											{item.label}
										</span>
										{item.description && (
											<span style={{ color: "var(--wg-descriptionForeground, #cccccc99)", fontSize: 12 }}>
												{item.description}
											</span>
										)}
									</li>
								))}
							</ul>
						) : (
							<p style={{ color: "var(--wg-descriptionForeground, #cccccc99)", fontSize: 13, padding: "8px 12px" }}>
								No recent connections yet. Create a <strong>New Connection</strong> to get started.
							</p>
						)}
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						marginTop: 48,
						paddingTop: 16,
						borderTop: "1px solid var(--wg-editorWidget-border, #454545)",
						display: "flex",
						justifyContent: "space-between",
						fontSize: 11,
						color: "var(--wg-descriptionForeground, #cccccc99)",
					}}
				>
					<span>
						WorkGrid Studio · UI shell · Backend (Rust IPC) not yet wired
					</span>
					<span>
						<span className={codiconClass("check")} style={{ marginRight: 4 }} />
						Learning resources in the docs
					</span>
				</div>
			</div>
		</div>
	);
}

const sectionHeaderStyle: React.CSSProperties = {
	margin: "0 0 12px",
	fontSize: 13,
	fontWeight: 600,
	textTransform: "uppercase",
	letterSpacing: 0.5,
	color: "var(--wg-foreground, #cccccc)",
};

const startButtonStyle: React.CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "8px 12px",
	marginBottom: 4,
	background: "transparent",
	border: "none",
	borderRadius: 4,
	color: "inherit",
	font: "inherit",
	fontSize: 13,
	textAlign: "left",
	cursor: "pointer",
};
