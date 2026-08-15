// Database server editor — the form behind the Servers view. One record
// shape covers four connection types:
//   tcp        direct host:port
//   docker     container on the local docker daemon (address resolved at
//              connect time via `docker port` / `docker inspect`)
//   ssh        database reachable through a registered SSH server
//   sshDocker  container on a remote daemon, `docker exec` over SSH
// The container fields offer a picker backed by `docker ps` (local or over
// the selected SSH server), and Test Connection resolves + dials the current
// form without saving.

import { useEffect, useMemo, useRef, useState } from 'react';
import { codiconClass } from '../icon.js';
import {
  dbServerTest,
  dbUpsertServer,
  dockerListContainers,
  sshDockerListContainers,
  sshServersList,
} from '../../backend/ipc.js';
import type {
  DbConnectionType,
  DbServerInput,
  DbServerTestResult,
  DockerContainerDto,
  SshServerDto,
} from '../../backend/types.js';
import { WgSelect } from '../WgSelect.js';

export interface DbServerEditorProps {
  /** Server id to edit. Null = create a new server. */
  serverId?: string | null;
  /** Run Test Connection once after the form loads. */
  autoTest?: boolean;
  onSaved?: (savedId: string) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const CONNECTION_TYPES: { value: DbConnectionType; label: string }[] = [
  { value: 'tcp', label: 'TCP' },
  { value: 'docker', label: 'Docker (Internal Host)' },
  { value: 'ssh', label: 'SSH' },
  { value: 'sshDocker', label: 'SSH + Docker (Remote)' },
];

const DB_TYPES = ['mysql', 'postgres', 'mssql', 'sqlite'];

const DEFAULT_PORTS: Record<string, string> = {
  mysql: '3306',
  postgres: '5432',
  mssql: '1433',
  sqlite: '',
};

export function DbServerEditor({ serverId, autoTest, onSaved, onCancel, onDirtyChange }: DbServerEditorProps) {
  // ---- form state -----------------------------------------------------------
  const [name, setName] = useState('');
  const [connectionType, setConnectionType] = useState<DbConnectionType>('tcp');
  const [dbType, setDbType] = useState('mysql');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [ssl, setSsl] = useState(false);
  const [container, setContainer] = useState('');
  const [sshServerId, setSshServerId] = useState('');
  const [notes, setNotes] = useState('');

  const [sshServers, setSshServers] = useState<SshServerDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DbServerTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const autoTestRef = useRef(false);

  const snapshot = useRef('');
  const current = JSON.stringify([name, connectionType, dbType, host, port, database, user, password, ssl, container, sshServerId, notes]);
  const dirty = !loading && current !== snapshot.current;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange, serverId]);

  // Reset the host's dirty flag on unmount (see SshServerEditor for why).
  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  // SSH server options for the ssh / sshDocker pickers.
  useEffect(() => {
    let cancelled = false;
    sshServersList()
      .then((servers) => {
        if (!cancelled) setSshServers(servers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the record (or reset for create) and snapshot for dirty tracking.
  useEffect(() => {
    const reset = (values: {
      name: string; connectionType: DbConnectionType; dbType: string; host: string;
      port: string; database: string; user: string; password: string; ssl: boolean;
      container: string; sshServerId: string; notes: string;
    }) => {
      setName(values.name);
      setConnectionType(values.connectionType);
      setDbType(values.dbType);
      setHost(values.host);
      setPort(values.port);
      setDatabase(values.database);
      setUser(values.user);
      setPassword(values.password);
      setSsl(values.ssl);
      setContainer(values.container);
      setSshServerId(values.sshServerId);
      setNotes(values.notes);
      snapshot.current = JSON.stringify([values.name, values.connectionType, values.dbType, values.host, values.port, values.database, values.user, values.password, values.ssl, values.container, values.sshServerId, values.notes]);
      setError(null);
    };

    if (!serverId) {
      reset({ name: '', connectionType: 'tcp', dbType: 'mysql', host: '', port: '3306', database: '', user: '', password: '', ssl: false, container: '', sshServerId: '', notes: '' });
      autoTestRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    import('../../backend/ipc.js').then(async ({ dbServersList }) => {
      const servers = await dbServersList();
      if (cancelled) return;
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        setError('Server not found.');
        setLoading(false);
        return;
      }
      const fallbackPort = DEFAULT_PORTS[server.dbType] ?? '';
      reset({
        name: server.name,
        connectionType: server.connectionType,
        dbType: server.dbType,
        host: server.host ?? '',
        port: server.port != null ? String(server.port) : fallbackPort,
        database: server.database ?? '',
        user: server.user ?? '',
        password: server.password ?? '',
        ssl: server.ssl === true,
        container: server.dockerContainer ?? '',
        sshServerId: server.sshServerId ?? '',
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

  // When the db type changes, follow its default port unless the user typed
  // a custom one matching another type's default.
  const handleDbTypeChange = (next: string) => {
    const currentDefault = Object.entries(DEFAULT_PORTS).find(([, p]) => p === port.trim())?.[0];
    if (!port.trim() || currentDefault) {
      setPort(DEFAULT_PORTS[next] ?? '');
    }
    setDbType(next);
  };

  const buildInput = (): DbServerInput => ({
    id: serverId ?? null,
    name: name.trim(),
    connectionType,
    dbType,
    host: host.trim() || null,
    port: port.trim() ? Number(port.trim()) || null : null,
    database: database.trim() || null,
    user: user.trim() || null,
    password: password || null,
    ssl,
    dockerContainer: container || null,
    sshServerId: sshServerId || null,
    notes: notes.trim() || null,
  });

  const validate = (): string | null => {
    if (!name.trim()) return 'A name is required.';
    if (connectionType === 'tcp' && !host.trim()) return 'A host is required for TCP servers.';
    if ((connectionType === 'docker' || connectionType === 'sshDocker') && !container) {
      return 'A container is required for docker servers.';
    }
    if ((connectionType === 'ssh' || connectionType === 'sshDocker') && !sshServerId) {
      return 'Pick the SSH server to connect through.';
    }
    return null;
  };

  const runTest = async () => {
    const problem = validate();
    if (problem) {
      setTestError(problem);
      setTestResult(null);
      return;
    }
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await dbServerTest(buildInput());
      setTestResult(result);
    } catch (e: unknown) {
      setTestError(messageOf(e));
    } finally {
      setTesting(false);
    }
  };

  // Auto-test once loaded (context-menu "Test Connection").
  useEffect(() => {
    if (autoTest && !loading && !autoTestRef.current && (host || container)) {
      autoTestRef.current = true;
      void runTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTest, loading, host, container]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await dbUpsertServer(buildInput());
      snapshot.current = current;
      onSaved?.(saved.id);
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const sshServer = useMemo(
    () => sshServers.find((s) => s.id === sshServerId),
    [sshServers, sshServerId],
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
          <span className={codiconClass('database')} style={{ fontSize: 18 }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {serverId ? 'Edit database server' : 'New database server'}
            </div>
            <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>
              TCP, local Docker, SSH tunnel or SSH + remote Docker — one saved recipe per server.
            </div>
          </div>
        </div>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        {loading ? (
          <div style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 12 }}>Loading server…</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. prod mysql" required style={{ ...inputStyle, width: '100%' }} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <Field label="Connection type" hint={typeHint(connectionType)}>
                <WgSelect
                  ariaLabel="Connection type"
                  value={connectionType}
                  onChange={(v) => setConnectionType(v as DbConnectionType)}
                  options={CONNECTION_TYPES}
                />
              </Field>
              <Field label="Database type">
                <WgSelect
                  ariaLabel="Database type"
                  value={dbType}
                  onChange={handleDbTypeChange}
                  options={DB_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </Field>
            </div>

            {connectionType === 'tcp' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                <Field label="Host">
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="host or IP" spellCheck={false} style={{ ...inputStyle, width: '100%' }} />
                </Field>
                <Field label="Port">
                  <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={DEFAULT_PORTS[dbType] || 'port'} inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </div>
            ) : null}

            {connectionType === 'docker' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                <Field label="Container" hint="From the local docker daemon (docker ps).">
                  <ContainerPicker
                    value={container}
                    onChange={setContainer}
                    mode="local"
                    sshServerId={null}
                  />
                </Field>
                <Field label="Container port" hint="Port inside the container.">
                  <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={DEFAULT_PORTS[dbType] || 'port'} inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </div>
            ) : null}

            {connectionType === 'ssh' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                  <Field label="SSH server" hint={sshServer ? `${sshServer.host}:${sshServer.port ?? 22}` : 'Registered SSH servers; identity + jumps come from there.'}>
                    <WgSelect
                      ariaLabel="SSH server"
                      value={sshServerId}
                      onChange={setSshServerId}
                      options={[
                        { value: '', label: '— pick a server —' },
                        ...sshServers.map((s) => ({ value: s.id, label: s.name })),
                      ]}
                    />
                  </Field>
                  <Field label="Port" hint="Database port.">
                    <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={DEFAULT_PORTS[dbType] || 'port'} inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
                  </Field>
                </div>
                <Field label="Database host" hint="As reachable from the SSH server — 127.0.0.1 when the DB runs on the same box.">
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" spellCheck={false} style={{ ...inputStyle, width: '100%' }} />
                </Field>
              </>
            ) : null}

            {connectionType === 'sshDocker' ? (
              <>
                <Field label="SSH server" hint={sshServer ? `${sshServer.host}:${sshServer.port ?? 22}` : 'docker ps runs on this host over SSH.'}>
                  <WgSelect
                    ariaLabel="SSH server"
                    value={sshServerId}
                    onChange={setSshServerId}
                    options={[
                      { value: '', label: '— pick a server —' },
                      ...sshServers.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                  <Field label="Container" hint="Containers on the remote daemon (docker ps over SSH).">
                    <ContainerPicker
                      value={container}
                      onChange={setContainer}
                      mode="ssh"
                      sshServerId={sshServerId}
                    />
                  </Field>
                  <Field label="Container port" hint="Port inside the container.">
                    <input value={port} onChange={(e) => setPort(e.target.value)} placeholder={DEFAULT_PORTS[dbType] || 'port'} inputMode="numeric" style={{ ...inputStyle, width: '100%' }} />
                  </Field>
                </div>
              </>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <Field label="Database" hint="Optional default database.">
                <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="e.g. app" spellCheck={false} style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="SSL">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--wg-foreground)', paddingTop: 4 }}>
                  <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                  use SSL/TLS
                </label>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="User">
                <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="e.g. root" autoComplete="off" style={{ ...inputStyle, width: '100%' }} />
              </Field>
              <Field label="Password">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="stored encrypted" autoComplete="new-password" style={{ ...inputStyle, width: '100%' }} />
              </Field>
            </div>

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
                {testResult.resolvedAddress ? <div>dialed: <span style={{ fontFamily: 'monospace' }}>{testResult.resolvedAddress}</span></div> : null}
                {testResult.serverVersion ? <div>server: {testResult.serverVersion}</div> : null}
                {testResult.path.length > 0 ? (
                  <div style={{ color: 'var(--wg-descriptionForeground, #999999)' }}>via {testResult.path.join(' → ')}</div>
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

// ---------------------------------------------------------------- - container picker

function ContainerPicker({
  value,
  onChange,
  mode,
  sshServerId,
}: {
  value: string;
  onChange: (name: string) => void;
  mode: 'local' | 'ssh';
  sshServerId: string | null;
}) {
  const [containers, setContainers] = useState<DockerContainerDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (mode === 'ssh' && !sshServerId) {
      setError('Pick the SSH server first, then load containers.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = mode === 'ssh' && sshServerId
        ? await sshDockerListContainers(sshServerId)
        : await dockerListContainers();
      setContainers(list);
      if (list.length === 0) setError('No running containers found.');
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  // Options: the saved value stays selectable even before loading.
  const options = [{ value: '', label: containers ? '— pick a container —' : '— not loaded —' }];
  if (value && !containers?.some((c) => c.name === value)) {
    options.push({ value, label: value });
  }
  for (const c of containers ?? []) {
    options.push({ value: c.name, label: `${c.name} (${c.image})` });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <WgSelect ariaLabel="Container" value={value} onChange={onChange} options={options} />
        </div>
        <button
          type="button"
          title={mode === 'local' ? 'Run docker ps locally' : 'Run docker ps over SSH'}
          disabled={loading}
          onClick={() => { void load(); }}
          style={{ ...btnSecondary, padding: '5px 8px' }}
        >
          <span className={codiconClass(loading ? 'loading' : 'refresh')} />
        </button>
      </div>
      {error ? (
        <span style={{ color: 'var(--wg-descriptionForeground, #999999)', fontSize: 11 }}>{error}</span>
      ) : null}
    </div>
  );
}

function typeHint(type: DbConnectionType): string {
  switch (type) {
    case 'tcp': return 'Dial the database directly.';
    case 'docker': return 'Container on the local docker daemon; the address is resolved at connect time.';
    case 'ssh': return 'Tunnel through a registered SSH server (identity + jumps from there).';
    case 'sshDocker': return 'SSH to the host, then a docker exec proxy inside the container.';
  }
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
