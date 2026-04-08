import { READINESS_RULES, buildReadinessContext, type ReadinessIssue } from "../config/readinessRules";
import type { WorkflowEdge, WorkflowNode } from "../types/workflow";

export type { ReadinessIssue };

/**
 * 与后端 validate_for_execution / 保存前体验一致的可运行性检查（前端侧）。
 * 空图时只返回 empty_graph，避免在无节点时刷出一串无意义项。
 */
export function collectReadinessIssues(nodes: WorkflowNode[], edges: WorkflowEdge[]): ReadinessIssue[] {
  const ctx = buildReadinessContext(nodes, edges);
  if (ctx.nodes.length === 0) {
    const emptyRule = READINESS_RULES.find((r) => r.id === "empty_graph");
    return emptyRule ? emptyRule.collect(ctx) : [];
  }
  return READINESS_RULES.filter((r) => r.id !== "empty_graph").flatMap((r) => r.collect(ctx));
}

export function firstBlockingIssue(nodes: WorkflowNode[], edges: WorkflowEdge[]): ReadinessIssue | null {
  return collectReadinessIssues(nodes, edges).find((i) => i.severity === "error") ?? null;
}
