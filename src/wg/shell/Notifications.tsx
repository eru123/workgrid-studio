// Notifications / toasts — visual component + enter/exit animation. The
// original notificationsToasts.ts is DI-coupled (backed by INotificationService
// + INotificationService). This is the rendering layer only: the host owns the
// notification list and passes it in.

import { useEffect, useState } from 'react';
import { codiconClass } from './icon.js';
import type { NotificationItem } from './types.js';

export interface NotificationsProps {
	items: readonly NotificationItem[];
	onDismiss?: (id: string) => void;
	onAction?: (notificationId: string, actionId: string) => void;
	/** Auto-dismiss non-sticky, non-error notifications after this many ms. 0 = disabled. */
	autoDismissMs?: number;
}

export function Notifications({ items, onDismiss, onAction, autoDismissMs = 0 }: NotificationsProps) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="wg-notifications-toasts" role="region" aria-label="Notifications">
			{items.map((item) => (
				<Toast
					key={item.id}
					item={item}
					autoDismissMs={autoDismissMs}
					onDismiss={onDismiss}
					onAction={onAction}
				/>
			))}
		</div>
	);
}

function Toast({
	item,
	autoDismissMs,
	onDismiss,
	onAction,
}: {
	item: NotificationItem;
	autoDismissMs: number;
	onDismiss?: (id: string) => void;
	onAction?: (notificationId: string, actionId: string) => void;
}) {
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		if (autoDismissMs > 0 && !item.sticky && item.severity !== 'error') {
			const t = setTimeout(() => dismiss(), autoDismissMs);
			return () => clearTimeout(t);
		}
		return;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoDismissMs, item.sticky, item.severity]);

	const dismiss = () => {
		setLeaving(true);
		// Match the leave animation duration in shell.css.
		setTimeout(() => onDismiss?.(item.id), 180);
	};

	const severityIcon = item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : 'info';

	return (
		<div className="wg-notification" data-severity={item.severity} data-leaving={leaving} role="alert">
			<div className="wg-notification-header">
				<span className={codiconClass(severityIcon)} />
				<span>{item.severity === 'error' ? 'Error' : item.severity === 'warning' ? 'Warning' : 'Notification'}</span>
				{item.source && <span className="wg-notification-source">({item.source})</span>}
				<span className="wg-notification-close" title="Dismiss" onClick={dismiss}>
					<span className={codiconClass('close')} />
				</span>
			</div>
			<div className="wg-notification-message">{item.message}</div>
			{item.actions && item.actions.length > 0 && (
				<div className="wg-notification-actions">
					{item.actions.map((action) => (
						<button
							key={action.id}
							className="wg-notification-action"
							onClick={() => onAction?.(item.id, action.id)}
						>
							{action.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
