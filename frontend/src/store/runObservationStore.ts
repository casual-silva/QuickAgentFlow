import { create } from "zustand";
import type { RunLogItem } from "../types/workflow";

export type NodeExecutionChrome = "success" | "failed" | "running" | undefined;

type State = {
  activeRunId: string | null;
  runStatus: string | null;
  runError: string | null;
  logs: RunLogItem[];
  selectedTimelineNodeId: string | null;
  /** 画布节点描边：节点 id → 最近一次运行结果 */
  nodeChromeById: Record<string, "success" | "failed" | "running">;
  liveSeq: number;
  setFromRun: (runId: string | null, status: string | null, error: string | null, logs: RunLogItem[]) => void;
  clear: () => void;
  setSelectedTimelineNode: (id: string | null) => void;
  /** Chat/SSE 流式：追加一条临时日志（负数 id） */
  appendLiveNodeEnd: (row: {
    node_id: string;
    node_type: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    duration_ms: number;
    usage?: Record<string, unknown>;
  }) => void;
  /** 细粒度 trace（MCP/知识库等），与 node_end 日志区分展示 */
  appendLiveTrace: (row: {
    phase: string;
    message: string;
    node_id?: string;
    meta?: Record<string, unknown>;
    seq?: number;
  }) => void;
  markNodeRunning: (nodeId: string) => void;
  resetLive: () => void;
};

function deriveChrome(
  logs: RunLogItem[],
  runStatus: string | null,
  runError: string | null
): Record<string, "success" | "failed" | "running"> {
  const out: Record<string, "success" | "failed" | "running"> = {};
  for (const log of logs) {
    if (log.status === "failed") {
      out[log.node_id] = "failed";
    } else if (log.status === "running") {
      out[log.node_id] = "running";
    } else {
      out[log.node_id] = "success";
    }
  }
  if (runStatus === "failed" && runError && logs.length > 0) {
    const last = logs[logs.length - 1];
    if (last.status !== "failed") {
      out[last.node_id] = "failed";
    }
  }
  return out;
}

export const useRunObservationStore = create<State>((set, get) => ({
  activeRunId: null,
  runStatus: null,
  runError: null,
  logs: [],
  selectedTimelineNodeId: null,
  nodeChromeById: {},
  liveSeq: 0,
  setFromRun: (runId, status, error, logs) =>
    set({
      activeRunId: runId,
      runStatus: status,
      runError: error,
      logs,
      nodeChromeById: deriveChrome(logs, status, error),
      liveSeq: 0
    }),
  clear: () =>
    set({
      activeRunId: null,
      runStatus: null,
      runError: null,
      logs: [],
      selectedTimelineNodeId: null,
      nodeChromeById: {},
      liveSeq: 0
    }),
  setSelectedTimelineNode: (id) => set({ selectedTimelineNodeId: id }),
  appendLiveTrace: (row) => {
    const seq = get().liveSeq + 1;
    const item: RunLogItem = {
      id: -seq,
      run_id: get().activeRunId || "live",
      node_id: row.node_id?.trim() ? String(row.node_id) : "—",
      node_type: "trace",
      status: "success",
      input: { phase: row.phase, seq: row.seq },
      output: { message: row.message, meta: row.meta ?? {} },
      duration_ms: 0,
      created_at: new Date().toISOString()
    };
    const persisted = get().logs.filter((l) => l.id >= 0);
    const prevLive = get().logs.filter((l) => l.id < 0);
    const nextLogs = [...persisted, ...prevLive, item];
    set({
      liveSeq: seq,
      logs: nextLogs,
      nodeChromeById: deriveChrome(nextLogs, get().runStatus, get().runError)
    });
  },
  appendLiveNodeEnd: (row) => {
    const seq = get().liveSeq + 1;
    const output = { ...row.output };
    if (row.usage) {
      output.token_usage = row.usage;
    }
    const item: RunLogItem = {
      id: -seq,
      run_id: get().activeRunId || "live",
      node_id: row.node_id,
      node_type: row.node_type,
      status: "success",
      input: row.input,
      output,
      duration_ms: row.duration_ms,
      created_at: new Date().toISOString()
    };
    const persisted = get().logs.filter((l) => l.id >= 0);
    const prevLive = get().logs.filter((l) => l.id < 0);
    const nextLogs = [...persisted, ...prevLive, item];
    set({
      liveSeq: seq,
      logs: nextLogs,
      nodeChromeById: deriveChrome(nextLogs, get().runStatus, get().runError)
    });
  },
  markNodeRunning: (nodeId) =>
    set((s) => ({
      nodeChromeById: { ...s.nodeChromeById, [nodeId]: "running" }
    })),
  resetLive: () =>
    set((s) => {
      const kept = s.logs.filter((l) => l.id >= 0);
      return {
        logs: kept,
        liveSeq: 0,
        nodeChromeById: deriveChrome(kept, s.runStatus, s.runError)
      };
    })
}));
