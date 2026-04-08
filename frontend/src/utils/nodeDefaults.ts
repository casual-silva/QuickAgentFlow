import type { NodeType, WorkflowNode } from "../types/workflow";

/** 与后端 Settings.llm_model 默认一致，用于新建节点与体检逻辑 */
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
/** MCP Tool 节点须显式填写 tool_name，与后端校验一致 */
export const DEFAULT_TOOL_NAME = "";

/** 按节点类型补齐核心字段（不覆盖已有 data） */
export function defaultDataForNodeType(type: NodeType, preset?: Record<string, unknown>): Record<string, unknown> {
  const p = preset || {};
  switch (type) {
    case "llm":
      return {
        model_name: DEFAULT_LLM_MODEL,
        temperature: 0.2,
        system_prompt: "",
        user_prompt: "{{input.query}}",
        ...p
      };
    case "tool":
      return {
        tool_name: DEFAULT_TOOL_NAME,
        parameters_mapping: { query: "{{input.query}}", top_k: 3 },
        ...p
      };
    case "http":
      return {
        method: "GET",
        url: "",
        headers: {} as Record<string, string>,
        body: "",
        timeout_sec: 30,
        ...p
      };
    case "delay":
      return { duration_ms: 1000, ...p };
    case "agent":
      return {
        agent_strategy: "react",
        model: DEFAULT_LLM_MODEL,
        temperature: 0.7,
        system_prompt: "你是一个智能助手。请根据用户输入的问题、上游工具返回的数据和对话记忆，给出准确、简洁、有帮助的回答。",
        query_template: "{{input.query}}",
        max_iterations: 6,
        use_memory: false,
        memory_key: "history",
        use_mcp_tools: false,
        mcp_tool_names: [] as string[],
        mcp_parameters_mapping: { query: "{{input.query}}", top_k: 3 },
        ...p
      };
    case "loop":
      return { array_path: "input.items", max_iterations: 10, ...p };
    case "split_in_batches":
      return { array_path: "input.items", batch_size: 5, ...p };
    case "llm_compare":
      return {
        model_names: "gpt-4o-mini,gpt-4o",
        temperature: 0.2,
        system_prompt: "",
        user_prompt: "{{input.query}}",
        ...p
      };
    case "knowledge_retrieve":
      return {
        knowledge_base_id: "",
        query_template: "{{input.query}}",
        top_k: 5,
        recall_pool_size: 64,
        rag_weights: { keyword: 0.38, phrase: 0.37, title: 0.2, order: 0.05, dense: 0 },
        include_score_breakdown: true,
        ...p
      };
    case "set_fields":
      return { assignments: { enriched_query: "{{input.query}}" }, ...p };
    case "group":
      return { ...p };
    case "switch":
    case "parallel":
      return { ...p };
    default:
      return { ...p };
  }
}

export function normalizeNodeData(type: NodeType, data: Record<string, unknown> | undefined): Record<string, unknown> {
  const d = data && typeof data === "object" ? { ...data } : {};
  const defaults = defaultDataForNodeType(type);
  return { ...defaults, ...d };
}

export function normalizeGraphNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((n) => ({ ...n, data: normalizeNodeData(n.type, n.data) }));
}

export function effectiveToolName(data: Record<string, unknown>): string {
  return String(data.tool_name ?? "").trim();
}

export function effectiveLlmModel(data: Record<string, unknown>): string {
  const s = String(data.model_name || data.model || "").trim();
  return s || DEFAULT_LLM_MODEL;
}
