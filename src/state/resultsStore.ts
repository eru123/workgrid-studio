import { create } from "zustand";
import type { QueryResultSet } from "@/lib/db";

export interface FrozenResultsSnapshot {
  sourceTabId: string;
  sourceTitle: string;
  profileId: string;
  database?: string;
  queryText: string;
  results: QueryResultSet[];
  executionTimeMs: number | null;
  createdAt: string;
}

interface ResultsState {
  tabs: Record<string, FrozenResultsSnapshot>;
  setSnapshot: (tabId: string, snapshot: FrozenResultsSnapshot) => void;
  removeSnapshot: (tabId: string) => void;
}

function cloneResultSet(result: QueryResultSet): QueryResultSet {
  return {
    columns: [...result.columns],
    rows: result.rows.map((row) => [...row]),
    affected_rows: result.affected_rows,
    info: result.info,
  };
}

export function formatResultsTabTitle(results: QueryResultSet[]): string {
  const totalRows = results.reduce((sum, result) => sum + result.rows.length, 0);
  return `Results - ${totalRows.toLocaleString()} rows`;
}

export const useResultsStore = create<ResultsState>((set) => ({
  tabs: {},
  setSnapshot: (tabId, snapshot) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...snapshot,
          results: snapshot.results.map(cloneResultSet),
        },
      },
    })),
  removeSnapshot: (tabId) =>
    set((state) => {
      if (!state.tabs[tabId]) return state;
      const next = { ...state.tabs };
      delete next[tabId];
      return { tabs: next };
    }),
}));
