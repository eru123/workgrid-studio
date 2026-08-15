// SSH server editor — the form behind the SSH view. A server references a
// vault identity for authentication and carries every connection parameter:
// proxy jumps / ProxyCommand, timeouts, keepalives, host-key policy and
// arbitrary extra OpenSSH options. Test Connection runs the current form
// (saved or not) and reports the path, auth method and host fingerprint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { codiconClass } from '../icon.js';
import { credentialsGetTree } from '../../backend/ipc.js';
import { sshTestConnection, sshUpsertServer } from '../../backend/ipc.js';
import type { SshServerInput, SshTestResult } from '../../backend/types.js';
import { displayNameOf } from '../credentials/vaultNaming.js';
import { WgSelect } from '../WgSelect.js';

export interface SshServerEditorProps {
  /** Server id to edit. Null = create a new server. */
  serverId?: string | null;
  /** Run Test Connection once after the form loads. */
  autoTest?: boolean;
  onSaved?: (savedId: string) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

interface IdentityOption {
  id: string;
  label: string;
  path: string;
}

interface ExtraOptionRow {
  key: string;
  value: string;
}

export function SshServerEditor({ serverId, autoTest, onSaved, onCancel, onDirtyChange }: SshServerEditorProps) {
  // ---- form state -----------------------------------------------------------
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [identityId, setIdentityId] = useState('');
  const [user, setUser] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [proxyJump, setProxyJump] = useState('');
  const [proxyCommand, setProxyCommand] = useState('');
  const [connectTimeout, setConnectTimeout] = useState('');
  const [keepaliveInterval, setKeepaliveInterval] = useState('');
  const [keepaliveCount, setKeepaliveCount] = useState('');
  const [compression, setCompression] = useState(false);
  const [strictHostKey, setStrictHostKey] = useState('accept-new');
  const [extraRows, setExtraRows] = useState<ExtraOptionRow[]>([]);
  const [notes, setNotes] = useState('');

  const [identities, setIdentities] = useState<IdentityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SshTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const autoTestRef = useRef(false);

  const snapshot = useRef('');
  const current = JSON.stringify([name, host, port, identityId, user, privateKeyPath, proxyJump, proxyCommand, connectTimeout, keepaliveInterval, keepaliveCount, compression, strictHostKey, extraRows, notes]);
  const dirty = !loading && current !== snapshot.current;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange, serverId]);

  // Reset the host's dirty flag on unmount. Saving closes the editor before
  // the dirty effect can re-run (the snapshot is a ref — no re-render), so
  // without this the stale `true` would prompt "Discard?" on the next open.
  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  // Identity picker options — vault entries (`.store` hidden), flattened.
  useEffect(() => {
    let cancelled = false;
    credentialsGetTree()
      .then((tree) => {
        if (cancelled) return;
        const options: IdentityOption[] = [];
        const walk = (nodes: typeof tree, trail: string[]) => {
          for (const n of nodes) {
            if (n.type === 'entry') {
              options.push({ id: n.id, label: displayNameOf(n), path: trail.join(' / ') });
            }
            if (n.children?.length) walk(n.children, [...trail, n.name]);
          }
        };
        walk(tree, []);
        setIdentities(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the server record (or reset for create) and snapshot for dirty tracking.
  useEffect(() => {
    const reset = (values: {
      name: string; host: string; port: string; identityId: string; user: string;
      privateKeyPath: string; proxyJump: string; proxyCommand: string; connectTimeout: string;
      keepaliveInterval: string; keepaliveCount: string; compression: boolean;
      strictHostKey: string; extraRows: ExtraOptionRow[]; notes: string;
    }) => {
      setName(values.name);
      setHost(values.host);
      setPort(values.port);
      setIdentityId(values.identityId);
      setUser(values.user);
      setPrivateKeyPath(values.privateKeyPath);
      setProxyJump(values.proxyJump);
      setProxyCommand(values.proxyCommand);
      setConnectTimeout(values.connectTimeout);
      setKeepaliveInterval(values.keepaliveInterval);
      setKeepaliveCount(values.keepaliveCount);
      setCompression(values.compression);
      setStrictHostKey(values.strictHostKey);
      setExtraRows(values.extraRows);
      setNotes(values.notes);
      snapshot.current = JSON.stringify([values.name, values.host, values.port, values.identityId, values.user, values.privateKeyPath, values.proxyJump, values.proxyCommand, values.connectTimeout, values.keepaliveInterval, values.keepaliveCount, values.compression, values.strictHostKey, values.extraRows, values.notes]);
      setError(null);
    };

    if (!serverId) {
      reset({ name: '', host: '', port: '22', identityId: '', user: '', privateKeyPath: '', proxyJump: '', proxyCommand: '', connectTimeout: '', keepaliveInterval: '', keepaliveCount: '', compression: false, strictHostKey: 'accept-new', extraRows: [], notes: '' });
      autoTestRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    // The record comes from the registry via a prop-less fetch: the parent
    // passes the id; we read the list and pick ours (small registry).
    import('../../backend/ipc.js').then(async ({ sshServersList }) => {
      const servers = await sshServersList();
      if (cancelled) return;
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        setError('Server not found.');
        setLoading(false);
        return;
      }
      const extra = Object.entries(server.extraOptions ?? {}).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
      reset({
        name: server.name,
        host: server.host,
        port: String(server.port ?? 22),
        identityId: server.identityId ?? '',
        user: server.user ?? '',
        privateKeyPath: server.privateKeyPath ?? '',
        proxyJump: server.proxyJump ?? '',
        proxyCommand: server.proxyCommand ?? '',
        connectTimeout: server.connectTimeoutSecs != null ? String(server.connectTimeoutSecs) : '',
        keepaliveInterval: server.keepaliveIntervalSecs != null ? String(server.keepaliveIntervalSecs) : '',
        keepaliveCount: server.keepaliveCount != null ? String(server.keepaliveCount) : '',
        compression: server.compression === true,
        strictHostKey: server.strictHostKey ?? 'accept-new',
        extraRows: extra,
        notes: server.notes ?? '',
      });
      setLoading(false);
    }).catch((e: unknown) => {
      if (!cancelled) {
        setError(messageOf(e));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const buildInput = (): SshServerInput => {
    const extra: Record<string, unknown> = {};
    for (const row of extraRows) {
      if (row.key.trim()) extra[row.key.trim()] = row.value;
    }
    const num = (v: string): number | null => {
      const trimmed = v.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    return {
      id: serverId ?? null,
      name: name.trim(),
      host: host.trim(),
      port: port.trim() ? Number(port.trim()) || 22 : null,
      identityId: identityId || null,
      user: user.trim() || null,
      privateKeyPath: privateKeyPath.trim() || null,
      proxyJump: proxyJump.trim() || null,
      proxyCommand: proxyCommand.trim() || null,
      connectTimeoutSecs: num(connectTimeout),
      keepaliveIntervalSecs: num(keepaliveInterval),
      keepaliveCount: num(keepaliveCount),
      compression,
      strictHostKey,
      extraOptions: Object.keys(extra).length > 0 ? extra : null,
      notes: notes.trim() || null,
    };
  };

  const runTest = async () => {
    if (!host.trim()) {
      setTestError('A host is required before testing.');
      setTestResult(null);
      return;
    }
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await sshTestConnection(buildInput());
      setTestResult(result);
    } catch (e: unknown) {
      setTestError(messageOf(e));
    } finally {
      setTesting(false);
    }
  };

  // Auto-test once loaded (context-menu "Test Connection").
  useEffect(() => {
    if (autoTest && !loading && !autoTestRef.current && host) {
      autoTestRef.current = true;
      void runTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTest, loading, host]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }
    if (!host.trim()) {
      setError('A host is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await sshUpsertServer(buildInput());
      snapshot.current = current;
      onSaved?.(saved.id);
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const identity = useMemo(
    () => identities.find((i) => i.id === identityId),
    [identities, identityId],
  );

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
              {serverId ? 'Edit SSH server' : 'New SSH server'}
            </div>
            <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>
              Authentication comes from a vault identity; every connection parameter lives here.
            </div>
          </div>
        </div>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        {loading ? (
          <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>Loading server…</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. prod bastion" required style={{ ...inputStyle, width: '100%' }} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <Field label="Host">
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="host or IP" required spellCheck={false} style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="Port">
                <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <Field label="Identity" hint={identity?.path ? `vault: ${identity.path}` : 'Pick a vault identity for user / key / password'}>
                <WgSelect
                  ariaLabel="Identity"
                  value={identityId}
                  onChange={setIdentityId}
                  options={[
                    { value: '', label: '— no identity —' },
                    ...identities.map((i) => ({
                      value: i.id,
                      label: i.path ? `${i.path} / ${i.label}` : i.label,
                    })),
                  ]}
                />
              </Field>
              <Field label="User override">
                <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="from identity" autoComplete="off" style={{ ...inputStyle, width: '100%' }} />
              </Field>
            </div>

            <Field label="Private key path" hint="Used when no identity is selected (legacy setups); tilde (~) allowed.">
              <input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} placeholder="~/.ssh/id_ed25519" spellCheck={false} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
            </Field>

            <Field label="ProxyJump" hint="Comma-separated hops — host, user@host, host:port, user@host:port. Each hop authenticates with this identity.">
              <input value={proxyJump} onChange={(e) => setProxyJump(e.target.value)} placeholder="jump.example.com, root@10.0.0.9:2200" spellCheck={false} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
            </Field>

            <Field label="ProxyCommand" hint="Executed via sh; %h and %p are replaced with host and port.">
              <input value={proxyCommand} onChange={(e) => setProxyCommand(e.target.value)} placeholder="ssh -W %h:%p gate.example.com" spellCheck={false} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <Field label="Connect timeout (s)">
                <input value={connectTimeout} onChange={(e) => setConnectTimeout(e.target.value)} placeholder="15" inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="Keepalive every (s)">
                <input value={keepaliveInterval} onChange={(e) => setKeepaliveInterval(e.target.value)} placeholder="off" inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="Keepalive count">
                <input value={keepaliveCount} onChange={(e) => setKeepaliveCount(e.target.value)} placeholder="3" inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Host key policy">
                <WgSelect
                  ariaLabel="Host key policy"
                  value={strictHostKey}
                  onChange={setStrictHostKey}
                  options={[
                    { value: 'accept-new', label: 'accept-new (TOFU)' },
                    { value: 'yes', label: 'yes (strict)' },
                    { value: 'no', label: 'no (accept any)' },
                  ]}
                />
              </Field>
              <Field label="Compression">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--wg-foreground)', paddingTop: 4 }}>
                  <input type="checkbox" checked={compression} onChange={(e) => setCompression(e.target.checked)} />
                  request compression (stored; not negotiated by the test client)
                </label>
              </Field>
            </div>

            <Field label="Extra options" hint="Arbitrary OpenSSH options kept with the server (e.g. ServerAliveInterval, ForwardAgent, IPQoS).">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {extraRows.map((row, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                    <input
                      value={row.key}
                      onChange={(e) => setExtraRows((rows) => rows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)))}
                      placeholder="OptionName"
                      spellCheck={false}
                      style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <input
                      value={row.value}
                      onChange={(e) => setExtraRows((rows) => rows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                      placeholder="value"
                      spellCheck={false}
                      style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <button type="button" title="Remove option" onClick={() => setExtraRows((rows) => rows.filter((_, i) => i !== idx))} style={btnSecondary}>
                      <span className={codiconClass('close')} />
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" onClick={() => setExtraRows((rows) => [...rows, { key: '', value: '' }])} style={btnSecondary}>
                    <span className={codiconClass('add')} style={{ marginRight: 6 }} />
                    Add option
                  </button>
                </div>
              </div>
            </Field>

            <Field label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this server" style={{ ...inputStyle, width: '100%', minHeight: 70, resize: 'vertical' }} />
            </Field>

            {testError ? <ErrorBox>{testError}</ErrorBox> : null}
            {testResult ? (
              <div
                style={{
                  border: `1px solid ${testResult.ok ? 'var(--wg-testing-iconForeground, #73c991)' : 'var(--wg-errorForeground, #ff6b6b)'}`,
                  borderRadius: 4,
                  padding: '8px 10px',
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: testResult.ok ? 'var(--wg-testing-iconForeground, #73c991)' : 'var(--wg-errorForeground, #ff6b6b)' }}>
                  <span className={codiconClass(testResult.ok ? 'pass' : 'error')} />
                  <strong>{testResult.message}</strong>
                </div>
                {testResult.authUsed ? <div>auth: {testResult.authUsed}</div> : null}
                {testResult.hostFingerprint ? (
                  <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{testResult.hostFingerprint}</div>
                ) : null}
                {testResult.hops.length > 0 ? (
                  <div style={{ color: 'var(--wg-descriptionForeground, #999999)' }}>via {testResult.hops.join(' → ')}</div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button type="button" disabled={testing || saving || loading} onClick={() => { void runTest(); }} style={btnSecondary}>
                <span className={codiconClass(testing ? 'loading' : 'play')} style={{ marginRight: 6 }} />
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              {onCancel ? (
                <button type="button" onClick={onCancel} disabled={saving} style={btnSecondary}>Cancel</button>
              ) : null}
              <button type="submit" disabled={saving || loading} style={btnPrimary}>
                {saving ? 'Saving…' : serverId ? 'Save server' : 'Create server'}
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

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: 'var(--wg-errorForeground, #ff6b6b)', fontSize: 12, padding: '6px 8px', border: '1px solid var(--wg-errorForeground, #ff6b6b)', borderRadius: 4 }}>
      {children}
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Request failed.';
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
