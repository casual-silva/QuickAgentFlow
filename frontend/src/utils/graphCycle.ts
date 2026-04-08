import type { WorkflowEdge, WorkflowNode } from "../types/workflow";

function edgeKey(e: WorkflowEdge, idx: number): string {
  return e.id || `e_${idx}_${e.source}_${e.target}`;
}

/**
 * 有向图环检测：返回参与回边的边 key（与 WorkflowCanvas 中边的 id 规则一致）。
 */
export function findCycleEdgeIds(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const pairs: { source: string; target: string; key: string }[] = [];
  edges.forEach((e, idx) => {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      return;
    }
    if (!adj.has(e.source)) {
      adj.set(e.source, []);
    }
    adj.get(e.source)!.push(e.target);
    pairs.push({ source: e.source, target: e.target, key: edgeKey(e, idx) });
  });

  const visited = new Set<string>();
  const stack = new Set<string>();
  let cycleKeys: string[] = [];

  function dfs(u: string): boolean {
    visited.add(u);
    stack.add(u);
    for (const v of adj.get(u) || []) {
      if (!visited.has(v)) {
        if (dfs(v)) {
          const k = pairs.find((p) => p.source === u && p.target === v)?.key;
          if (k) {
            cycleKeys.push(k);
          }
          return true;
        }
      } else if (stack.has(v)) {
        const k = pairs.find((p) => p.source === u && p.target === v)?.key;
        if (k) {
          cycleKeys = [k];
        }
        return true;
      }
    }
    stack.delete(u);
    return false;
  }

  for (const id of nodeIds) {
    if (!visited.has(id) && dfs(id)) {
      break;
    }
  }
  return cycleKeys;
}
