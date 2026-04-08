export type NodeType =
  | "start"
  | "trigger"
  | "llm"
  | "llm_compare"
  | "tool"
  | "http"
  | "knowledge_retrieve"
  | "set_fields"
  | "group"
  | "memory"
  | "if"
  | "condition"
  | "switch"
  | "loop"
  | "split_in_batches"
  | "parallel"
  | "delay"
  | "action"
  | "code"
  | "agent"
  | "global"
  | "end";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entry: string;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
}

export interface RunItem {
  id: string;
  workflow_id: string;
  status: "pending" | "running" | "success" | "failed";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

export interface RunLogItem {
  id: number;
  run_id: string;
  node_id: string;
  node_type: string;
  status: "running" | "success" | "failed";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
  created_at: string;
}

export interface RunTraceItem {
  id: number;
  run_id: string;
  seq: number;
  phase: string;
  message: string;
  node_id: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface PaginatedRuns {
  items: RunItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface TemplateItem {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  source_workflow_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedTemplates {
  items: TemplateItem[];
  total: number;
  page: number;
  page_size: number;
}
