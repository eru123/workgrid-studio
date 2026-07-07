// Connection modal — a simple form for connecting to a MySQL database.
// Calls the Rust db_connect command via the IPC shim. UI-only concerns live
// here; the actual connection logic is in the Rust backend.

import { useState } from "react";
import type { ConnectParams, ConnectionHandle } from "../backend/types";
import { dbConnect } from "../backend/ipc";

export interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (handle: ConnectionHandle) => void;
}

const DEFAULT_PORT: Record<string, number> = {
  mysql: 3306,
  postgres: 5432,
  mssql: 1433,
  sqlite: 0,
};

export function ConnectModal({ open, onClose, onConnected }: ConnectModalProps) {
  const [dbType, setDbType] = useState("mysql");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(3306);
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [profileId, setProfileId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const pid = profileId || `conn-${Date.now()}`;
      const params: ConnectParams = {
        profileId: pid,
        dbType,
        host,
        port,
        user,
        password,
        database: database || undefined,
      };
      const handle = await dbConnect(params);
      onConnected(handle);
      onClose();
    } catch (e: unknown) {
      // Tauri errors come as serialized strings; extract the message.
      const msg = typeof e === "string"
        ? e
        : (e as { message?: string })?.message
          ?? (typeof e === "object" ? JSON.stringify(e) : String(e));
      setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--wg-editorWidget-background, #252526)",
          color: "var(--wg-foreground, #cccccc)",
          border: "1px solid var(--wg-editorWidget-border, #454545)",
          borderRadius: 6,
          padding: 24,
          width: 420,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>New Connection</h2>

        <Field label="Database type">
          <select
            value={dbType}
            onChange={(e) => {
              setDbType(e.target.value);
              setPort(DEFAULT_PORT[e.target.value] ?? 3306);
            }}
            style={inputStyle}
          >
            <option value="mysql">MySQL / MariaDB</option>
            <option value="postgres">PostgreSQL (stub)</option>
            <option value="sqlite">SQLite (stub)</option>
            <option value="mssql">SQL Server (stub)</option>
          </select>
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Host" style={{ flex: 1 }}>
            <input value={host} onChange={(e) => setHost(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Port" style={{ width: 90 }}>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Field label="User" style={{ flex: 1 }}>
            <input value={user} onChange={(e) => setUser(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Password" style={{ flex: 1 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Database (optional)">
          <input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="Leave empty to list all"
            style={inputStyle}
          />
        </Field>

        <Field label="Profile name (optional)">
          <input
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="Auto-generated if empty"
            style={inputStyle}
          />
        </Field>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: "var(--wg-inputOption-activeBorder, #5a1d1d)",
              border: "1px solid var(--wg-errorForeground, #f48771)",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--wg-errorForeground, #f48771)",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button onClick={handleConnect} disabled={connecting} style={btnPrimary}>
            {connecting ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: "block", fontSize: 11, marginBottom: 4, opacity: 0.8 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  background: "var(--wg-input-background, #3c3c3c)",
  color: "var(--wg-input-foreground, #cccccc)",
  border: "1px solid var(--wg-input-border, #3c3c3c)",
  borderRadius: 2,
  fontSize: 13,
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 16px",
  background: "var(--wg-button-background, #0e639c)",
  color: "var(--wg-button-foreground, #ffffff)",
  border: "none",
  borderRadius: 2,
  cursor: "pointer",
  fontSize: 13,
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 16px",
  background: "var(--wg-button-secondaryBackground, #3a3d41)",
  color: "var(--wg-button-secondaryForeground, #ffffff)",
  border: "none",
  borderRadius: 2,
  cursor: "pointer",
  fontSize: 13,
};
