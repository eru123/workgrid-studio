// WgSelect — themed dropdown replacement. WebKitGTK renders native <select>
// POPUPS with the platform (white) GTK popover that CSS cannot reach, so —
// like VS Code's SelectBox — this draws its own button + list with the
// workbench tokens. Keyboard: Escape closes; click-outside closes.

import { useEffect, useRef, useState } from 'react';
import { codiconClass } from './icon.js';

export interface WgSelectOption {
  value: string;
  label: string;
}

export interface WgSelectProps {
  value: string;
  options: readonly WgSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function WgSelect({ value, options, onChange, ariaLabel }: WgSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        className="wg-form-select"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? '—'}
        </span>
        <span className={codiconClass(open ? 'chevron-up' : 'chevron-down')} style={{ fontSize: 14, flexShrink: 0 }} />
      </button>
      {open ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            right: 0,
            zIndex: 1000,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            color: 'var(--wg-dropdown-foreground, var(--wg-foreground, #cccccc))',
            background: 'var(--wg-dropdown-background, #3c3c3c)',
            border: '1px solid var(--wg-dropdown-border, var(--wg-border, #ffffff33))',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className="wg-select-option"
              data-selected={opt.value === value ? 'true' : undefined}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
