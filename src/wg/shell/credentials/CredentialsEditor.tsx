// Credential editor — fixed, tab-less replacement for the standard EditorArea
// when the Credentials view is active. Vault entries are SSH identities
// consumed by SSH server connections. The private key can be pasted or
// loaded from a file; in both cases the CONTENTS are stored in the vault.
// Secret fields (user password, key contents, key passphrase) are sealed
// with AES-256-GCM before persistence and the whole credentials file is
// encrypted as well.

import { useEffect, useRef, useState } from 'react';
import { codiconClass } from '../icon.js';
import { credentialsGetEntry, credentialsUpsertEntry } from '../../backend/ipc.js';
import type { CredentialEntryInput } from '../../backend/types.js';
import { displayNameOf, ensureStoreSuffix } from './vaultNaming.js';

export interface CredentialsEditorProps {
  /** Entry id to edit. When null/undefined the form creates a new entry. */
  entryId?: string | null;
  /** Optional parent folder id for new entries. */
  parentId?: string | null;
  /** Called after a successful save with the saved entry id (created
   *  identities report their new id so hosts can keep the form open). */
  onSaved?: (savedId?: string) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
  /** Notified whenever the form gains/loses unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Lightweight private-key format detection for the info hint under the
 *  paste area. Returns null when no key content is present. */
function keyInfoOf(text: string): { label: string; ok: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    const algo = detectOpenSshAlgo(t);
    return { label: algo ? `OpenSSH · ${algo}` : 'OpenSSH private key', ok: true };
  }
  const pem = /^-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----/.exec(t);
  if (pem) {
    return { label: `PEM private key${pem[1] ? ` (${pem[1].trim().toLowerCase()})` : ''}`, ok: true };
  }
  if (t.startsWith('PuTTY-User-Key-File-')) {
    return { label: 'PuTTY PPK key', ok: true };
  }
  return { label: 'Unrecognized format — expected an OpenSSH/PEM private key', ok: false };
}

/** The key algorithm name is a length-prefixed string near the start of the
 *  OpenSSH key body; searching the decoded prefix for known names is enough. */
function detectOpenSshAlgo(text: string): string | null {
  const b64 = text.split(/\s+/).filter((l) => !l.startsWith('-----')).join('');
  const known = [
    'ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521', 'sk-ssh-ed25519', 'sk-ecdsa-sha2-nistp256', 'ssh-dss',
  ];
  try {
    const bin = atob(b64.slice(0, 256));
    for (const algo of known) {
      if (bin.includes(algo)) {
        return algo.replace(/^sk-/, '').replace(/^ssh-/, '').replace(/^ecdsa-sha2-/, 'ecdsa-');
      }
    }
  } catch {
    // malformed base64 — fall through to the generic label
  }
  return null;
}

export function CredentialsEditor({ entryId, parentId, onSaved, onCancel, onDirtyChange }: CredentialsEditorProps) {
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);
  // Snapshot of the loaded state, serialized — dirty = current ≠ snapshot.
  const [snapshot, setSnapshot] = useState('');
  const current = JSON.stringify([name, user, password, privateKey, privateKeyPath, passphrase, description, notes]);
  const dirty = !loading && current !== snapshot;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange, entryId]);

  // Load an existing identity by id (with secrets unsealed) when editing.
  useEffect(() => {
    const resetTo = (values: {
      name: string; user: string; password: string; privateKey: string;
      privateKeyPath: string; passphrase: string; description: string; notes: string;
    }) => {
      setName(values.name);
      setUser(values.user);
      setPassword(values.password);
      setPrivateKey(values.privateKey);
      setPrivateKeyPath(values.privateKeyPath);
      setPassphrase(values.passphrase);
      setDescription(values.description);
      setNotes(values.notes);
      setSnapshot(JSON.stringify([
        values.name, values.user, values.password, values.privateKey,
        values.privateKeyPath, values.passphrase, values.description, values.notes,
      ]));
      setError(null);
    };
    if (!entryId) {
      resetTo({ name: '', user: '', password: '', privateKey: '', privateKeyPath: '', passphrase: '', description: '', notes: '' });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    credentialsGetEntry(entryId)
      .then((entry) => {
        if (cancelled) return;
        resetTo({
          // The name field works in explorer space: the on-disk `.store`
          // suffix is hidden here and re-appended on save.
          name: displayNameOf({ type: 'entry', name: entry.name }),
          user: entry.fields?.user ?? '',
          password: entry.fields?.password ?? '',
          privateKey: entry.fields?.privateKey ?? '',
          privateKeyPath: entry.fields?.privateKeyPath ?? '',
          passphrase: entry.fields?.passphrase ?? '',
          description: entry.description ?? '',
          notes: entry.fields?.notes ?? '',
        });
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

  // "Load from file…" — reads the key contents into the vault store; the
  // file itself is only a source, nothing on disk is referenced afterwards.
  const handleKeyFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) {
        setError('The selected file is empty.');
        return;
      }
      setPrivateKey(text);
      setPrivateKeyPath(file.name);
      setError(null);
    } catch (e: unknown) {
      setError(messageOf(e));
    }
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
      kind: 'ssh',
      name: ensureStoreSuffix(name.trim()),
      fields: {
        user: user.trim() || null,
        password: password || null,
        privateKey: privateKey.trim() || null,
        privateKeyPath: privateKeyPath.trim() || null,
        passphrase: passphrase || null,
        notes: notes.trim() || null,
      },
      description: description.trim() || null,
    };
    try {
      const dto = await credentialsUpsertEntry(input);
      setSnapshot(current); // saved — no longer dirty
      onSaved?.(dto.id);
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="wg-cred-editor"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        padding: 16,
        color: 'var(--wg-foreground, #e0e0e0)',
        background: 'var(--wg-background, #1e1e1e)',
      }}
    >
      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={codiconClass('remote')} style={{ fontSize: 18 }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {entryId ? 'Edit SSH identity' : 'New SSH identity'}
            </div>
            <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>
              Used to authenticate SSH servers. Secrets are encrypted at rest.
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ color: 'var(--wg-errorForeground, #ff6b6b)', fontSize: 12, padding: '6px 8px', border: '1px solid var(--wg-errorForeground, #ff6b6b)', borderRadius: 4 }}>
            {error}
          </div>
        ) : null}

        {loading ? (
          <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>Loading identity…</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Personal key"
                required
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="User">
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="e.g. root, deploy"
                  autoComplete="off"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="SSH login password"
                  autoComplete="new-password"
                  title="User password for password authentication (encrypted at rest)"
                  style={{ ...inputStyle, width: '100%' }}
                />
              </Field>
            </div>

            <Field label="Private key" hint="Paste the key below or load it from a file — its contents are stored encrypted in the vault.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" onClick={() => keyFileRef.current?.click()} style={btnSecondary}>
                  <span className={codiconClass('folder-opened')} style={{ marginRight: 6 }} />
                  Load from file…
                </button>
                {privateKeyPath ? (
                  <span style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span className={codiconClass('check')} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Loaded from {privateKeyPath}</span>
                    <button
                      type="button"
                      title="Clear key"
                      onClick={() => {
                        setPrivateKey('');
                        setPrivateKeyPath('');
                      }}
                      style={{ ...btnSecondary, padding: '0 4px' }}
                    >
                      <span className={codiconClass('close')} />
                    </button>
                  </span>
                ) : null}
              </div>
              <input
                ref={keyFileRef}
                type="file"
                onChange={handleKeyFile}
                style={{ display: 'none' }}
              />
              <textarea
                value={privateKey}
                onChange={(e) => {
                  setPrivateKey(e.target.value);
                  if (privateKeyPath && e.target.value.trim() === '') setPrivateKeyPath('');
                }}
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…paste key contents here…\n-----END OPENSSH PRIVATE KEY-----'}
                spellCheck={false}
                style={{ ...inputStyle, width: '100%', minHeight: 140, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
              {(() => {
                const info = keyInfoOf(privateKey);
                if (!info) return null;
                return (
                  <span style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, color: info.ok ? 'var(--wg-descriptionForeground, #999999)' : 'var(--wg-errorForeground, #ff6b6b)' }}>
                    <span className={codiconClass(info.ok ? 'check' : 'warning')} />
                    {info.label}
                  </span>
                );
              })()}
            </Field>

            <Field label="Key passphrase">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave blank if the key has no passphrase"
                autoComplete="new-password"
                title="Passphrase protecting the private key (encrypted at rest)"
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional summary shown in the vault"
                style={{ ...inputStyle, width: '100%' }}
              />
            </Field>

            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes (e.g. which servers this identity is used for)"
                style={{ ...inputStyle, width: '100%', minHeight: 90, resize: 'vertical' }}
              />
            </Field>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              {onCancel ? (
                <button type="button" onClick={onCancel} disabled={saving} style={btnSecondary}>Cancel</button>
              ) : null}
              <button type="submit" disabled={saving} style={btnPrimary}>
                {saving ? 'Saving…' : entryId ? 'Save identity' : 'Create identity'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <label style={{ color: 'var(--wg-sidebarTitle-foreground, #cccccc)', fontSize: 12 }}>{label}</label>
      {hint ? (
        <span style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 11 }}>{hint}</span>
      ) : null}
      {children ?? <span style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>—</span>}
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Failed to save identity.';
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
