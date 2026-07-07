// Workbench — the grid shell composing all parts. The original layout.ts is
// the central DI-coupled WorkbenchLayout class (positions all parts via grid +
// sashes, ~21 services). This is the React equivalent: a CSS grid with the
// parts as children, plus resizable sidebar/panel sizes via the Sash.
//
// State (active view, sizes, open tabs) lives in the host and is passed as
// props — no storage service. Backend calls go through the WorkbenchBackend
// seam (unimplemented; the host supplies it or omits it for a static demo).

import { useCallback, useState, type ReactNode } from 'react';
import './shell.css';
import { ActivityBar } from './ActivityBar.js';
import { EditorArea } from './EditorArea.js';
import { Panel } from './Panel.js';
import { Sidebar } from './Sidebar.js';
import { Sash } from './Sash.js';
import { StatusBar } from './StatusBar.js';
import { TitleBar } from './TitleBar.js';
import type { WorkbenchBackend } from '../backend/BackendAdapter.js';
import type {
	ActivityBarItem,
	EditorGroup,
	PanelTab,
	StatusBarItem,
	ViewPaneContainerDescriptor,
} from './types.js';
import type { ContextMenuItem } from './types.js';
import type { TitleBarMenuItem } from './TitleBar.js';

export interface WorkbenchProps {
	title?: string;
	menubar?: readonly TitleBarMenuItem[];
	onMenuSelect?: (item: ContextMenuItem) => void;

	/** Activity bar items (top section) + global actions (bottom section). */
	activityItems?: readonly ActivityBarItem[];
	activityActions?: readonly ActivityBarItem[];
	activeViewContainerId?: string;
	onActivitySelect?: (item: ActivityBarItem) => void;

	/** Active sidebar view container; undefined hides the sidebar. */
	sidebar?: ViewPaneContainerDescriptor;
	sidebarHeaderActions?: ReactNode;
	defaultSidebarWidth?: number;

	/** Editor area root group. */
	editorGroup?: EditorGroup;
	onActivateTab?: (groupId: string, tabId: string) => void;
	onCloseTab?: (groupId: string, tabId: string) => void;

	/** Bottom panel tabs; undefined/empty hides the panel. */
	panelTabs?: readonly PanelTab[];
	panelActiveTabId?: string;
	panelHeaderActions?: ReactNode;
	defaultPanelHeight?: number;

	/** Status bar items. */
	statusBarItems?: readonly StatusBarItem[];
	onStatusBarClick?: (item: StatusBarItem) => void;

	/** Auxiliary (right) sidebar; optional. Rendered as a React node. */
	auxiliaryBar?: ReactNode;

	/** Backend seam (unimplemented). Passed down to children that need it. */
	backend?: WorkbenchBackend;
}

export function Workbench(props: WorkbenchProps) {
	const [sidebarWidth, setSidebarWidth] = useState(props.defaultSidebarWidth ?? 280);
	const [panelHeight, setPanelHeight] = useState(props.defaultPanelHeight ?? 200);
	const [sidebarHidden, setSidebarHidden] = useState(!props.sidebar);
	const [panelHidden, setPanelHidden] = useState(!props.panelTabs || props.panelTabs.length === 0);

	// Re-evaluate visibility when props change.
	const sidebarActuallyHidden = sidebarHidden || !props.sidebar;
	const panelActuallyHidden = panelHidden || !props.panelTabs || props.panelTabs.length === 0;

	const onSidebarSash = useCallback((delta: number) => {
		setSidebarWidth((w) => Math.max(170, Math.min(800, w + delta)));
	}, []);
	const onPanelSash = useCallback((delta: number) => {
		// Dragging the panel sash up (negative delta) grows the panel.
		setPanelHeight((h) => Math.max(80, Math.min(600, h - delta)));
	}, []);

	return (
		<div
			className="wg-workbench"
			style={{
				'--wg-layout-sidebar-width': `${sidebarActuallyHidden ? 0 : sidebarWidth}px`,
				'--wg-layout-panel-height': `${panelActuallyHidden ? 0 : panelHeight}px`,
				'--wg-layout-auxiliarybar-width': props.auxiliaryBar ? '300px' : '0px',
			} as React.CSSProperties}
			data-sidebar-hidden={sidebarActuallyHidden}
			data-panel-hidden={panelActuallyHidden}
			data-auxiliarybar-hidden={!props.auxiliaryBar}
		>
			<TitleBar title={props.title} menubar={props.menubar} onMenuSelect={props.onMenuSelect} />

			<ActivityBar
				items={props.activityItems ?? []}
				actions={props.activityActions}
				activeViewContainerId={props.activeViewContainerId}
				onSelect={(item) => {
					if (item.viewContainerId === props.activeViewContainerId) {
						setSidebarHidden((h) => !h);
					} else {
						setSidebarHidden(false);
						props.onActivitySelect?.(item);
					}
				}}
			/>

			{!sidebarActuallyHidden ? (
				<Sidebar container={props.sidebar} headerActions={props.sidebarHeaderActions} />
			) : null}

			{/* Sidebar resize sash — overlay at the sidebar's right edge. */}
			{!sidebarActuallyHidden ? (
				<div style={{ position: 'absolute', left: `calc(var(--wg-layout-activitybar-width) + var(--wg-layout-sidebar-width) - 2px)`, top: 'var(--wg-layout-titlebar-height)', bottom: 'var(--wg-layout-statusbar-height)', zIndex: 20 }}>
					<Sash orientation="vertical" onResize={onSidebarSash} />
				</div>
			) : null}

			<div className="wg-editor">
				{props.editorGroup ? (
					<EditorArea
						group={props.editorGroup}
						onActivateTab={props.onActivateTab}
						onCloseTab={props.onCloseTab}
					/>
				) : null}
			</div>

			{!panelActuallyHidden ? (
				<div className="wg-panel-wrap" style={{ gridArea: 'panel', position: 'relative', display: 'flex', flexDirection: 'column' }}>
					{/* Panel resize sash — overlay at the panel's top edge. */}
					<div style={{ position: 'absolute', left: 0, right: 0, top: '-2px', height: '4px', zIndex: 20 }}>
						<Sash orientation="horizontal" onResize={onPanelSash} />
					</div>
					<Panel
						tabs={props.panelTabs!}
						activeTabId={props.panelActiveTabId}
						headerActions={props.panelHeaderActions}
					/>
				</div>
			) : null}

			{props.auxiliaryBar ? (
				<div className="wg-auxiliarybar">{props.auxiliaryBar}</div>
			) : null}

			<StatusBar
				items={props.statusBarItems ?? []}
				onClick={props.onStatusBarClick}
			/>
		</div>
	);
}
