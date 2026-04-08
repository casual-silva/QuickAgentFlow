import axios from "axios";
import type { PaginatedRuns, PaginatedTemplates, RunItem, RunLogItem, RunTraceItem, TemplateItem, WorkflowItem } from "../types/workflow";

export type ValidateGraphResponse = { ok: boolean; issues: string[] };

export type DebugStepResponse = {
  finished: boolean;
  node_id?: string | null;
  node_type?: string | null;
  output: Record<string, unknown>;
  vars: Record<string, unknown>;
};

export type ExpressionPreviewResponse = {
  rendered: Record<string, string>;
  diagnostics: Record<string, Array<{ token: string; ok: boolean; value?: unknown; error?: string }>>;
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8001",
  timeout: 15000
});

export async function listWorkflows(): Promise<WorkflowItem[]> {
  const { data } = await api.get<WorkflowItem[]>("/api/workflows");
  return data;
}

export async function createWorkflow(payload: {
  name: string;
  description: string;
  status: "draft" | "published";
  graph: WorkflowItem["graph"];
}): Promise<WorkflowItem> {
  const { data } = await api.post<WorkflowItem>("/api/workflows", payload);
  return data;
}

export async function getWorkflow(id: string): Promise<WorkflowItem> {
  const { data } = await api.get<WorkflowItem>(`/api/workflows/${id}`);
  return data;
}

export async function updateWorkflow(id: string, payload: Partial<WorkflowItem>): Promise<WorkflowItem> {
  const { data } = await api.put<WorkflowItem>(`/api/workflows/${id}`, payload);
  return data;
}

export async function validateWorkflowGraph(graph: WorkflowItem["graph"]): Promise<ValidateGraphResponse> {
  const { data } = await api.post<ValidateGraphResponse>("/api/workflows/validate-graph", graph);
  return data;
}

export async function debugWorkflowStep(
  workflowId: string,
  body: { input: Record<string, unknown>; vars: Record<string, unknown>; last_node_id?: string | null }
): Promise<DebugStepResponse> {
  const { data } = await api.post<DebugStepResponse>(`/api/workflows/${workflowId}/debug/step`, body);
  return data;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api.delete(`/api/workflows/${id}`);
}

export async function runWorkflow(id: string, input: Record<string, unknown>): Promise<RunItem> {
  const { data } = await api.post<RunItem>(`/api/workflows/${id}/run`, { input });
  return data;
}

export async function getRun(id: string): Promise<RunItem> {
  const { data } = await api.get<RunItem>(`/api/runs/${id}`);
  return data;
}

export async function listWorkflowRuns(workflowId: string): Promise<RunItem[]> {
  const { data } = await api.get<RunItem[]>(`/api/workflows/${workflowId}/runs`);
  return data;
}

export async function listRunLogs(runId: string): Promise<RunLogItem[]> {
  const { data } = await api.get<RunLogItem[]>(`/api/runs/${runId}/logs`);
  return data;
}

export async function listRunTrace(runId: string): Promise<RunTraceItem[]> {
  const { data } = await api.get<RunTraceItem[]>(`/api/runs/${runId}/trace`);
  return data;
}

export type KnowledgeBaseItem = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  chunk_count?: number;
};
export type KnowledgeChunkItem = {
  id: number;
  knowledge_base_id: string;
  title: string;
  content: string;
  position: number;
  created_at: string;
  has_embedding?: boolean;
  embedding_model?: string | null;
  meta?: Record<string, unknown> | null;
};

export type KnowledgeIngestResult = {
  created_chunks: number;
  skipped_short: number;
  skipped_duplicate: number;
  embedding_ok: number;
  embedding_failed: number;
  warnings: string[];
  chunk_ids: number[];
};

export async function listKnowledgeBases(): Promise<KnowledgeBaseItem[]> {
  const { data } = await api.get<KnowledgeBaseItem[]>("/api/knowledge/bases");
  return data;
}

export async function createKnowledgeBase(body: { name: string; description?: string }): Promise<KnowledgeBaseItem> {
  const { data } = await api.post<KnowledgeBaseItem>("/api/knowledge/bases", body);
  return data;
}

export async function updateKnowledgeBase(
  kbId: string,
  body: { name?: string; description?: string }
): Promise<KnowledgeBaseItem> {
  const { data } = await api.patch<KnowledgeBaseItem>(`/api/knowledge/bases/${kbId}`, body);
  return data;
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  await api.delete(`/api/knowledge/bases/${kbId}`);
}

export async function listKnowledgeChunks(kbId: string): Promise<KnowledgeChunkItem[]> {
  const { data } = await api.get<KnowledgeChunkItem[]>(`/api/knowledge/bases/${kbId}/chunks`);
  return data;
}

export async function createKnowledgeChunk(
  kbId: string,
  body: { title?: string; content: string; position?: number }
): Promise<KnowledgeChunkItem> {
  const { data } = await api.post<KnowledgeChunkItem>(`/api/knowledge/bases/${kbId}/chunks`, body);
  return data;
}

export async function deleteKnowledgeChunk(chunkId: number): Promise<void> {
  await api.delete(`/api/knowledge/chunks/${chunkId}`);
}

export async function updateKnowledgeChunk(
  chunkId: number,
  body: { title?: string; content?: string; position?: number; refresh_embedding?: boolean }
): Promise<KnowledgeChunkItem> {
  const { data } = await api.patch<KnowledgeChunkItem>(`/api/knowledge/chunks/${chunkId}`, body);
  return data;
}

export async function ingestKnowledgeText(
  kbId: string,
  body: {
    text: string;
    title_prefix?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    min_chunk_chars?: number;
    dedupe?: boolean;
    embed?: boolean;
  }
): Promise<KnowledgeIngestResult> {
  const { data } = await api.post<KnowledgeIngestResult>(`/api/knowledge/bases/${kbId}/ingest-text`, body, {
    timeout: 120000
  });
  return data;
}

export async function ingestKnowledgeFile(
  kbId: string,
  file: File,
  opts?: {
    chunk_size?: number;
    chunk_overlap?: number;
    min_chunk_chars?: number;
    dedupe?: boolean;
    embed?: boolean;
    title_prefix?: string;
  }
): Promise<KnowledgeIngestResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("chunk_size", String(opts?.chunk_size ?? 480));
  fd.append("chunk_overlap", String(opts?.chunk_overlap ?? 72));
  fd.append("min_chunk_chars", String(opts?.min_chunk_chars ?? 20));
  fd.append("dedupe", String(opts?.dedupe ?? true));
  fd.append("embed", String(opts?.embed ?? true));
  fd.append("title_prefix", opts?.title_prefix ?? "");
  const { data } = await api.post<KnowledgeIngestResult>(`/api/knowledge/bases/${kbId}/ingest-file`, fd, {
    timeout: 120000
  });
  return data;
}

export type KnowledgeRetrievalPreviewResponse = {
  knowledge_base_id: string;
  query: string;
  chunks: Array<{
    id: number;
    title: string;
    content: string;
    score: number;
    score_breakdown?: Record<string, unknown>;
  }>;
  retrieval: Record<string, unknown>;
  query_explain?: Record<string, unknown> | null;
  fusion_summary?: string;
};

export async function previewKnowledgeRetrieval(
  kbId: string,
  body: {
    query: string;
    top_k?: number;
    recall_pool_size?: number;
    rag_weights?: Record<string, number>;
    include_score_breakdown?: boolean;
    include_query_explain?: boolean;
  }
): Promise<KnowledgeRetrievalPreviewResponse> {
  const { data } = await api.post<KnowledgeRetrievalPreviewResponse>(
    `/api/knowledge/bases/${kbId}/preview-retrieval`,
    body
  );
  return data;
}

export async function previewKnowledgeRetrievalAll(
  body: {
    query: string;
    top_k?: number;
    recall_pool_size?: number;
    rag_weights?: Record<string, number>;
    include_score_breakdown?: boolean;
    include_query_explain?: boolean;
  }
): Promise<KnowledgeRetrievalPreviewResponse> {
  const { data } = await api.post<KnowledgeRetrievalPreviewResponse>("/api/knowledge/preview-retrieval", body);
  return data;
}

export type McpHealth = {
  configured: boolean;
  reachable: boolean;
  tool_count: number;
  error: string | null;
};

export async function getMcpHealth(): Promise<McpHealth> {
  const { data } = await api.get<McpHealth>("/api/mcp/health");
  return data;
}

export async function listRunsPaginated(params: {
  page: number;
  page_size: number;
  keyword?: string;
  status_filter?: string;
}): Promise<PaginatedRuns> {
  const { data } = await api.get<PaginatedRuns>("/api/runs", { params });
  return data;
}

/** 节点类型元数据 config_fields 中的字段描述 */
export interface NodeConfigField {
  key: string;
  label: string;
  widget: "text" | "template" | "number" | "select" | "switch" | "key_value" | "mcp_select" | "mcp_select_single" | "mcp_params" | "custom";
  default?: unknown;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  template_value?: boolean;
  visible_when?: { key: string; eq: unknown };
  /** 节点目录中带 static_params 的固定参数定义 */
  static_params?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
}

export interface NodeTypeSpec {
  type: string;
  label: string;
  description: string;
  config_fields: NodeConfigField[];
  output_schema: Record<string, string>;
}

export async function listNodeTypes(): Promise<NodeTypeSpec[]> {
  const { data } = await api.get("/api/node-types");
  return data;
}

/** MCP 工具参数定义 */
export interface McpToolParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface McpToolEntry {
  name: string;
  label: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** MCP 工具目录（与画布独占能力解耦） */
export async function listMcpTools(): Promise<McpToolEntry[]> {
  const { data } = await api.get("/api/mcp/tools");
  return data;
}

export async function listTemplates(): Promise<TemplateItem[]> {
  const { data } = await api.get<TemplateItem[]>("/api/templates");
  return data;
}

export async function listTemplatesPaginated(params: {
  page: number;
  page_size: number;
  keyword?: string;
}): Promise<PaginatedTemplates> {
  const { data } = await api.get<PaginatedTemplates>("/api/templates/paginated", { params });
  return data;
}

export async function createTemplate(payload: {
  name: string;
  description: string;
  source_workflow_id: string;
}): Promise<TemplateItem> {
  const { data } = await api.post<TemplateItem>("/api/templates", payload);
  return data;
}

export async function applyTemplate(templateId: string, payload: { name: string; status: "draft" | "published" }): Promise<WorkflowItem> {
  const { data } = await api.post<WorkflowItem>(`/api/templates/${templateId}/apply`, payload);
  return data;
}

export async function updateTemplate(templateId: string, payload: { name?: string; description?: string }): Promise<TemplateItem> {
  const { data } = await api.patch<TemplateItem>(`/api/templates/${templateId}`, payload);
  return data;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await api.delete(`/api/templates/${templateId}`);
}

/** 断点续跑：从指定节点恢复流式执行 */
export async function resumeWorkflowFromNode(
  workflowId: string,
  body: { from_node_id: string; input: Record<string, unknown>; vars: Record<string, unknown> }
): Promise<EventSource> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";
  const url = `${baseUrl}/api/workflows/${workflowId}/resume/stream`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`resume failed: ${response.status}`);
  return response as any;
}

export async function previewExpressions(payload: {
  templates: Record<string, string>;
  input?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  globals?: Record<string, unknown>;
}): Promise<ExpressionPreviewResponse> {
  const { data } = await api.post<ExpressionPreviewResponse>("/api/expressions/preview", payload);
  return data;
}
