import type { WorkflowEdge, WorkflowNode } from "../types/workflow";
import { findCycleEdgeIds } from "../utils/graphCycle";
import { effectiveLlmModel, effectiveToolName } from "../utils/nodeDefaults";

export type ReadinessIssue = {
  severity: "error" | "warn";
  nodeId?: string;
  message: string;
  /** 成环时高亮边的 id（与画布 edge.id 或 e_idx 规则一致） */
  edgeIds?: string[];
};

/**
 * 可运行性体检：声明式规则表，便于与产品对齐、后续扩展或与后端校验字段对齐。
 * collect 只读 ctx，不修改图数据。
 */
export type ReadinessContext = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeIds: Set<string>;
  /** 入口节点 id（trigger 优先，否则第一个节点） */
  entryId: string | undefined;
};

/** 从当前图构建一次体检上下文，供各条规则只读使用（与 collectReadinessIssues 数据流一致）。 */
export function buildReadinessContext(nodes: WorkflowNode[], edges: WorkflowEdge[]): ReadinessContext {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const entryId = nodes.find((n) => n.type === "trigger")?.id ?? nodes[0]?.id;
  return { nodes, edges, nodeIds, entryId };
}

export type ReadinessRuleDef = {
  id: string;
  collect: (ctx: ReadinessContext) => ReadinessIssue[];
};

export const READINESS_RULES: ReadinessRuleDef[] = [
  {
    id: "empty_graph",
    collect: (ctx) =>
      ctx.nodes.length === 0 ? [{ severity: "error", message: "画布上没有节点" }] : []
  },
  {
    id: "dag_cycle",
    collect: (ctx) => {
      const edgeIds = findCycleEdgeIds(ctx.nodes, ctx.edges);
      if (edgeIds.length === 0) {
        return [];
      }
      return [
        {
          severity: "error" as const,
          message: "图中存在有向环路（DAG 不允许），请删除或调整连线",
          edgeIds
        }
      ];
    }
  },
  {
    id: "dangling_edges",
    collect: (ctx) => {
      const out: ReadinessIssue[] = [];
      for (const edge of ctx.edges) {
        if (!ctx.nodeIds.has(edge.source) || !ctx.nodeIds.has(edge.target)) {
          out.push({
            severity: "error",
            message: `无效连线：${edge.source} → ${edge.target}（节点不存在）`
          });
        }
      }
      return out;
    }
  },
  {
    id: "entry_missing",
    collect: (ctx) => {
      const entryId = ctx.entryId;
      if (entryId && !ctx.nodeIds.has(entryId)) {
        return [{ severity: "error", message: "入口节点 ID 不在图中" }];
      }
      return [];
    }
  },
  {
    id: "node_data_required",
    collect: (ctx) => {
      const out: ReadinessIssue[] = [];
      for (const node of ctx.nodes) {
        const data = (node.data || {}) as Record<string, unknown>;
        if (node.type === "tool" && !effectiveToolName(data)) {
          out.push({ severity: "error", nodeId: node.id, message: `工具节点 ${node.id} 缺少 tool_name` });
        }
        if (node.type === "llm" && !effectiveLlmModel(data)) {
          out.push({ severity: "error", nodeId: node.id, message: `LLM 节点 ${node.id} 缺少 model/model_name` });
        }
        if (node.type === "knowledge_retrieve" && !String(data.knowledge_base_id ?? "").trim()) {
          out.push({
            severity: "error",
            nodeId: node.id,
            message: `知识库检索节点 ${node.id} 未选择知识库（属性面板下拉选择，或高级模式填写 ID）`
          });
        }
        if (node.type === "http" && !String(data.url ?? "").trim()) {
          out.push({
            severity: "error",
            nodeId: node.id,
            message: `HTTP 请求节点 ${node.id} 未填写 URL`
          });
        }
        if (node.type === "agent") {
          const useMcp = Boolean(data.use_mcp_tools);
          const names = Array.isArray(data.mcp_tool_names) ? (data.mcp_tool_names as unknown[]).filter(Boolean) : [];
          if (useMcp && names.length === 0) {
            out.push({
              severity: "warn",
              nodeId: node.id,
              message: `Agent ${node.id} 已开启 MCP 工具但未选择任何工具`
            });
          }
        }
      }
      return out;
    }
  },
  {
    id: "trigger_end_hints",
    collect: (ctx) => {
      const out: ReadinessIssue[] = [];
      if (!ctx.nodes.some((n) => n.type === "trigger")) {
        out.push({ severity: "warn", message: "未检测到 Trigger 节点，入口将使用第一个节点" });
      }
      if (!ctx.nodes.some((n) => n.type === "end")) {
        out.push({ severity: "warn", message: "未检测到 End 节点，输出可能不符合预期" });
      }
      return out;
    }
  }
];
