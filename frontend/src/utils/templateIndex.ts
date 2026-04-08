import type { RunLogItem, WorkflowEdge, WorkflowNode } from "../types/workflow";

const TOKEN_RE = /\{\{([^}]+)\}\}/g;

export function extractTemplateTokens(text: string): string[] {
  if (!text || !text.includes("{{")) {
    return [];
  }
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push(m[1].trim());
  }
  return out;
}

export type VariableLeaf = { path: string; label: string };

// ---------------------------------------------------------------------------
// 拓扑：反向 BFS 收集当前节点的所有上游节点 id
// ---------------------------------------------------------------------------

export function buildUpstreamNodeIds(
  edges: WorkflowEdge[],
  currentNodeId: string
): Set<string> {
  const upstream = new Set<string>();
  const queue = [currentNodeId];
  while (queue.length > 0) {
    const nid = queue.shift()!;
    for (const e of edges) {
      if (e.target === nid && !upstream.has(e.source)) {
        upstream.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return upstream;
}

// ---------------------------------------------------------------------------
// 核心：构建变量 picker 数据，支持拓扑、静态 output、globals 展开
// ---------------------------------------------------------------------------

export interface VariableIndexOptions {
  /** 当前正在编辑的节点 id，用于拓扑过滤 */
  currentNodeId?: string;
  /** 画布边列表 */
  edges?: WorkflowEdge[];
  /** 各节点类型的静态输出字段（来自后端 output_schema） */
  outputSchemas?: Record<string, Record<string, string>>;
}

export function buildVariableIndex(
  nodes: WorkflowNode[],
  lastRunOutputs?: Record<string, Record<string, unknown>>,
  options?: VariableIndexOptions
): { groups: { title: string; leaves: VariableLeaf[] }[] } {
  const { currentNodeId, edges, outputSchemas } = options ?? {};

  // 拓扑上游节点集合
  const upstreamIds: Set<string> | null =
    currentNodeId && edges ? buildUpstreamNodeIds(edges, currentNodeId) : null;

  // --- 1. Input / chat_input ---
  const inputGroup: VariableLeaf[] = [
    { path: "input.query", label: "input.query" },
    { path: "chat_input", label: "chat_input" },
  ];

  // --- 2. Globals（从画布中 global 类型节点的 data.variables 展开） ---
  const globalsGroup: VariableLeaf[] = [];
  for (const n of nodes) {
    if (n.type !== "global") continue;
    const vars = (n.data as { variables?: Record<string, unknown> })?.variables;
    if (vars && typeof vars === "object") {
      for (const k of Object.keys(vars)) {
        globalsGroup.push({ path: `globals.${k}`, label: `globals.${k}` });
      }
    }
  }

  // --- 3. 节点输出（上游优先 + 静态 schema 与日志合并） ---
  const upstreamLeaves: VariableLeaf[] = [];
  const otherLeaves: VariableLeaf[] = [];

  for (const n of nodes) {
    if (currentNodeId && n.id === currentNodeId) continue;
    const isUpstream = upstreamIds ? upstreamIds.has(n.id) : true;
    const target = isUpstream ? upstreamLeaves : otherLeaves;
    const label = String((n.data as { label?: string } | undefined)?.label || n.id);

    // 合并静态 schema 与运行日志的字段
    const staticKeys = new Set<string>(
      Object.keys(outputSchemas?.[n.type] ?? {})
    );
    const runOut = lastRunOutputs?.[n.id];
    if (runOut && typeof runOut === "object") {
      for (const k of Object.keys(runOut).filter((k) => !k.startsWith("_")).slice(0, 20)) {
        staticKeys.add(k);
      }
    }

    if (staticKeys.size === 0) {
      target.push({
        path: `nodes.${n.id}.output`,
        label: `${label}（运行后可补全字段）`,
      });
    } else {
      for (const k of staticKeys) {
        target.push({
          path: `nodes.${n.id}.output.${k}`,
          label: `${label} · ${k}`,
        });
      }
    }
  }

  // --- 4. 环境变量 ---
  const envGroup: VariableLeaf[] = [
    { path: "env.OPENAI_API_KEY", label: "env.OPENAI_API_KEY" },
  ];

  // --- 组装分组 ---
  const groups: { title: string; leaves: VariableLeaf[] }[] = [
    { title: "Input", leaves: inputGroup },
  ];
  if (globalsGroup.length > 0) {
    groups.push({ title: "Globals（全局变量）", leaves: globalsGroup });
  }
  if (upstreamIds) {
    groups.push({ title: "上游节点输出（已连接）", leaves: upstreamLeaves });
    if (otherLeaves.length > 0) {
      groups.push({ title: "其他节点输出（未连接）", leaves: otherLeaves });
    }
  } else {
    groups.push({ title: "节点输出（nodes.<id>.output.*）", leaves: upstreamLeaves });
  }
  groups.push({ title: "环境（仅服务端解析）", leaves: envGroup });

  return { groups };
}

export function validateTemplateAgainstIndex(value: string, nodeIds: Set<string>): string[] {
  const issues: string[] = [];
  for (const t of extractTemplateTokens(value)) {
    if (t.includes("<") || t.includes(">")) {
      continue;
    }
    if (t.startsWith("nodes.")) {
      const parts = t.split(".");
      if (parts.length < 3) {
        issues.push(`应为 nodes.<id>.output…：{{${t}}}`);
        continue;
      }
      const nid = parts[1];
      if (parts[2] !== "output") {
        issues.push(`nodes 引用需包含 .output.：{{${t}}}`);
        continue;
      }
      if (!nodeIds.has(nid)) {
        issues.push(`未知节点 id「${nid}」：{{${t}}}`);
      }
    }
  }
  return issues;
}

export function buildKnownPathsSet(nodes: WorkflowNode[], logs: RunLogItem[]): Set<string> {
  const s = new Set<string>();
  s.add("input.query");
  s.add("chat_input");
  const byNode: Record<string, Record<string, unknown>> = {};
  for (const log of logs) {
    if (log.output && typeof log.output === "object") {
      byNode[log.node_id] = log.output as Record<string, unknown>;
    }
  }
  for (const n of nodes) {
    const o = byNode[n.id];
    if (o) {
      for (const k of Object.keys(o)) {
        s.add(`nodes.${n.id}.output.${k}`);
      }
    } else {
      s.add(`nodes.${n.id}.output`);
    }
  }
  return s;
}

export function validateTemplatePathsDetailed(value: string, known: Set<string>): string[] {
  const issues: string[] = [];
  for (const t of extractTemplateTokens(value)) {
    if (t.startsWith("env.")) {
      continue;
    }
    if (t.startsWith("input.") || t === "input" || t === "chat_input" || t.startsWith("chat_input.")) {
      continue;
    }
    if (t.startsWith("globals.") || t.startsWith("vars.")) {
      continue;
    }
    if (!t.startsWith("nodes.")) {
      issues.push(`未识别命名空间：{{${t}}}`);
      continue;
    }
    let ok = false;
    if (known.has(t)) {
      ok = true;
    } else {
      for (const prefix of known) {
        if (t.startsWith(`${prefix}.`)) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      issues.push(`路径可能无效（对照上次运行/图中节点）：{{${t}}}`);
    }
  }
  return issues;
}
