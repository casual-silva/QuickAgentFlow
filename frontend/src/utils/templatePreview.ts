/**
 * 前端模板「预渲染」：用上次运行日志构造近似后端的上下文，便于核对 {{nodes.*.output.*}} 等引用。
 * 与后端 read_path 语义对齐（仅用于展示，非执行）。
 */
import type { RunLogItem, WorkflowNode } from "../types/workflow";

export function readPath(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const key of path.split(".").filter(Boolean)) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    if (typeof cur === "object" && !Array.isArray(cur) && key in (cur as object)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 由节点与日志构建与后端 render_ctx 类似的预览根对象（无 env 真实值） */
export function buildPreviewContext(
  nodes: WorkflowNode[],
  logs: RunLogItem[],
  inputOverride?: Record<string, unknown>
): Record<string, unknown> {
  const mergedInput: Record<string, unknown> = { query: "", ...(inputOverride || {}) };
  for (const log of logs) {
    if (log.node_type !== "trigger" && log.node_type !== "start") {
      continue;
    }
    const acc = (log.output as { accepted_input?: Record<string, unknown> })?.accepted_input;
    if (acc && typeof acc === "object") {
      Object.assign(mergedInput, acc);
    }
  }
  const nodesNs: Record<string, { output: Record<string, unknown> }> = {};
  const byId: Record<string, Record<string, unknown>> = {};
  for (const log of logs) {
    if (log.status === "failed") {
      continue;
    }
    const o = (log.output || {}) as Record<string, unknown>;
    byId[log.node_id] = o;
    nodesNs[log.node_id] = { output: o };
  }
  for (const n of nodes) {
    if (!nodesNs[n.id]) {
      nodesNs[n.id] = { output: {} };
    }
  }
  const globalsFlat: Record<string, unknown> = {};
  for (const n of nodes) {
    if (n.type !== "global") continue;
    const vars = (n.data as { variables?: Record<string, unknown> | undefined })?.variables;
    if (vars && typeof vars === "object") {
      Object.assign(globalsFlat, vars);
    }
  }
  return {
    input: mergedInput,
    chat_input: mergedInput.query,
    nodes: nodesNs,
    vars: byId,
    globals: globalsFlat
  };
}

const TOKEN_RE = /\{\{([^}]+)\}\}/g;

/** 变量树：按路径给出上次运行上下文下的取值摘要（仅展示，非后端执行）。 */
export function previewVariablePathValue(path: string, nodes: WorkflowNode[], logs: RunLogItem[], maxLen = 120): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("env.")) {
    return "（仅服务端解析）";
  }
  const ctx = buildPreviewContext(nodes, logs);
  const raw = readPath(ctx, trimmed);
  if (raw === undefined) {
    return "（先运行工作流或依赖触发输入后可有预览）";
  }
  let s = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (s.length > maxLen) {
    s = `${s.slice(0, maxLen)}…`;
  }
  return s;
}

/** 提取模板中的占位并给出解析预览（字符串化，过长截断）。 */
export function previewTemplateTokens(
  template: string,
  ctx: Record<string, unknown>,
  maxLen = 280
): { token: string; preview: string; ok: boolean }[] {
  if (!template?.includes("{{")) {
    return [];
  }
  const out: { token: string; preview: string; ok: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) {
    const token = m[1].trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    if (token.startsWith("env.")) {
      out.push({ token, preview: "（服务端注入，预览不可用）", ok: true });
      continue;
    }
    const raw = readPath(ctx, token);
    if (raw === undefined) {
      out.push({ token, preview: "（上次运行无此路径或无日志）", ok: false });
      continue;
    }
    let s = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (s.length > maxLen) {
      s = `${s.slice(0, maxLen)}…`;
    }
    out.push({ token, preview: s, ok: true });
  }
  return out;
}
