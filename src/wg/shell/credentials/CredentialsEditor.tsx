// Credential editor — fixed, tab-less replacement for the standard EditorArea
// when the Credentials view is active. Backed by the encrypted credentials
// vault (src-tauri/src/services/credentials.rs). Secrets are encrypted at rest
// by the backend; the form sends plaintext fields and the Rust side encrypts
// secret fields before persistence.
//
// Schema (matches models/mod.rs CredentialKind): login | card | identity | note | unknown.

import { useEffect, useState } from 'react';
import { codiconClass } from '../icon.js';
import { credentialsGetEntry, credentialsUpsertEntry } from '../../backend/ipc.js';
import type { CredentialEntryInput, CredentialFields, CredentialKind } from '../../backend/types.js';

export interface CredentialsEditorProps {
  /** Entry id to edit. When null/undefined the form creates a new entry. */
  entryId?: string | null;
  /** Optional parent folder id for new entries. */
  parentId?: string | null;
  /** Called after a successful save. */
  onSaved?: () => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
}

const KINDS: { readonly id: CredentialKind; readonly label: string; readonly icon: string }[] = [
  { id: 'login', label: 'Login', icon: 'key' },
  { id: 'card', label: 'Card', icon: 'credit-card' },
  { id: 'identity', label: 'Identity', icon: 'account' },
  { id: 'note', label: 'Note', icon: 'note' },
  { id: 'unknown', label: 'Other', icon: 'symbol-misc' },
];

function emptyFields(): CredentialFields {
  return {};
}

export function CredentialsEditor({ entryId, parentId, onSaved, onCancel }: CredentialsEditorProps) {
  const [kind, setKind] = useState<CredentialKind>('login');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<CredentialFields>(emptyFields);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load an existing entry by id (with decrypted secrets) when editing.
  useEffect(() => {
    if (!entryId) {
      setKind('login');
      setName('');
      setDescription('');
      setFields(emptyFields());
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    credentialsGetEntry(entryId)
      .then((entry) => {
        if (cancelled) return;
        setKind(entry.kind);
        setName(entry.name);
        setDescription(entry.description ?? '');
        setFields(entry.fields ?? emptyFields());
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageOf(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const set = <K extends keyof CredentialFields>(key: K, value: CredentialFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const input: CredentialEntryInput = {
      id: entryId ?? null,
      parentId: parentId ?? null,
      kind,
      name: name.trim(),
      fields,
      description: description.trim() || null,
    };
    try {
      await credentialsUpsertEntry(input);
      onSaved?.();
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 16,
        color: 'var(--wg-foreground, #e0e0e0)',
        background: 'var(--wg-background, #1e1e1e)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={codiconClass('key')} style={{ fontSize: 18 }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {entryId ? 'Edit credential' : 'New credential'}
            </div>
            <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>
              Secrets are encrypted at rest. Only this entry is fetched with decrypted fields.
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ color: 'var(--wg-errorForeground, #ff6b6b)', fontSize: 12, padding: '6px 8px', border: '1px solid var(--wg-errorForeground, #ff6b6b)', borderRadius: 4 }}>
            {error}
          </div>
        ) : null}

        {loading ? (
          <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>Loading credential…</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production MySQL"
                required
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            <Field label="Kind">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {KINDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setKind(item.id)}
                    style={{
                      ...btnBase,
                      background: kind === item.id ? 'var(--wg-button-hoverBackground, rgba(255,255,255,0.12))' : 'transparent',
                      borderColor: kind === item.id ? 'var(--wg-focusBorder, #007acc)' : 'var(--wg-border, #ffffff22)',
                    }}
                  >
                    <span className={codiconClass(item.icon)} style={{ marginRight: 8 }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note about this credential"
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            {kind === 'login' ? (
              <>
                <Field label="Username / Email">
                  <input value={fields.username ?? ''} onChange={(e) => set('username', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Password">
                  <input type="password" value={fields.password ?? ''} onChange={(e) => set('password', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="URL">
                  <input value={fields.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="https://…" style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </>
            ) : null}

            {kind === 'card' ? (
              <>
                <Field label="Cardholder">
                  <input value={fields.cardholder ?? ''} onChange={(e) => set('cardholder', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Card number">
                  <input value={fields.cardNumber ?? ''} onChange={(e) => set('cardNumber', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Expiry">
                  <input value={fields.expiry ?? ''} onChange={(e) => set('expiry', e.target.value)} placeholder="MM/YY" style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </>
            ) : null}

            {kind === 'identity' ? (
              <>
                <Field label="Full name">
                  <input value={fields.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Email">
                  <input value={fields.email ?? ''} onChange={(e) => set('email', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Phone">
                  <input value={fields.phone ?? ''} onChange={(e) => set('phone', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Address">
                  <input value={fields.address ?? ''} onChange={(e) => set('address', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </>
            ) : null}

            {kind === 'note' ? (
              <Field label="Note content">
                <textarea
                  value={fields.noteContent ?? ''}
                  onChange={(e) => set('noteContent', e.target.value)}
                  style={{ ...inputStyle, width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
                />
              </Field>
            ) : null}

            {kind === 'unknown' ? (
              <Field label="Custom (free text)">
                <textarea
                  value={(fields.noteContent as string) ?? ''}
                  onChange={(e) => set('noteContent', e.target.value)}
                  style={{ ...inputStyle, width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
                />
              </Field>
            ) : null}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {onCancel ? (
                <button type="button" onClick={onCancel} style={btnSecondary}>Cancel</button>
              ) : null}
              <button type="submit" disabled={saving} style={btnPrimary}>
                {saving ? 'Saving…' : entryId ? 'Update credential' : 'Create credential'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: 'var(--wg-sidebarTitle-foreground, #cccccc)', fontSize: 12 }}>{label}</label>
      {children ?? <span style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>—</span>}
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Failed to save credential.';
}

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--wg-foreground, #e0e0e0)',
  border: '1px solid var(--wg-border, #ffffff33)',
  borderRadius: 4,
  padding: '6px 8px',
  outline: 'none',
};

const btnBase: React.CSSProperties = {
  color: 'var(--wg-foreground, #e0e0e0)',
  border: '1px solid var(--wg-border, #ffffff33)',
  borderRadius: 4,
  padding: '6px 10px',
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: 'var(--wg-button-background, #0e639c)',
  borderColor: 'var(--wg-button-background, #0e639c)',
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
};
