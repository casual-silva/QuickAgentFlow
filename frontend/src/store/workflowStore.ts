import { create } from "zustand";
import type { NodeType, WorkflowEdge, WorkflowNode } from "../types/workflow";
import { defaultDataForNodeType, normalizeGraphNodes } from "../utils/nodeDefaults";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
type AgentRuntimeStatus = "idle" | "thinking" | "executing_tool";

type WorkflowState = {
  workflowId: string;
  workflowName: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  selectionNodeIds: string[];
  selectionEdgeIds: string[];
  saveStatus: SaveStatus;
  /** 用于触发 Trigger 节点短暂 pulse 动效 */
  triggerPulseToken: number;
  /** Agent 节点运行状态（驱动胶囊样式） */
  agentRuntimeStatusById: Record<string, AgentRuntimeStatus>;

  setWorkflowMeta: (id: string, name: string) => void;
  setGraph: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setCanvasSelection: (nodeIds: string[], edgeIds: string[]) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  addNode: (type: NodeType, presetData?: Record<string, unknown>) => void;
  addEdge: (edge: Omit<WorkflowEdge, "id">) => void;
  deleteNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  deleteEdge: (edgeId: string) => void;
  pulseTriggerNodes: () => void;
  setAgentRuntimeStatus: (nodeId: string, status: AgentRuntimeStatus) => void;
  clearRuntimeStates: () => void;
};

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflowId: "",
  workflowName: "",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectionNodeIds: [],
  selectionEdgeIds: [],
  saveStatus: "idle",
  triggerPulseToken: 0,
  agentRuntimeStatusById: {},

  setWorkflowMeta: (id, name) =>
    set({
      workflowId: id,
      workflowName: name,
    }),

  setGraph: (nodes, edges) =>
    set({
      nodes: normalizeGraphNodes(nodes || []),
      edges: (edges || []).map((e, idx) => ({ id: e.id || `e_${idx}_${e.source}_${e.target}`, ...e })),
      saveStatus: "idle",
    }),

  setSaveStatus: (status) => set({ saveStatus: status }),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setCanvasSelection: (nodeIds, edgeIds) =>
    set((state) => ({
      selectionNodeIds: nodeIds,
      selectionEdgeIds: edgeIds,
      selectedNodeId: nodeIds.length > 0 ? nodeIds[0] : state.selectedNodeId && edgeIds.length === 0 ? state.selectedNodeId : null,
    })),

  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node)),
      saveStatus: "idle",
    })),

  addNode: (type, presetData) =>
    set((state) => {
      const id = `${type}_${Date.now()}`;
      const index = state.nodes.length;
      const preset = presetData || {};
      const typeDefaults = defaultDataForNodeType(type, preset);
      const labelFromPreset = typeof preset.label === "string" && preset.label.trim() ? preset.label : undefined;
      return {
        nodes: [
          ...state.nodes,
          {
            id,
            type,
            position: { x: 120 + (index % 3) * 240, y: 120 + Math.floor(index / 3) * 140 },
            data: {
              label:
                labelFromPreset ??
                (type === "global"
                  ? "GLOBAL CONTEXT"
                  : type === "http"
                    ? "HTTP 请求"
                    : type === "delay"
                      ? "等待"
                      : type.toUpperCase()),
              ...(type === "global" ? { variables: { user_id: "", system_prompt: "" } } : {}),
              ...typeDefaults,
              ...preset,
            },
          },
        ],
        saveStatus: "idle",
      };
    }),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, { id: `e_${Date.now()}`, ...edge }],
      saveStatus: "idle",
    })),

  deleteNode: (nodeId) =>
    set((state) => {
      const nextSel = state.selectionNodeIds.filter((id) => id !== nodeId);
      const nextSelected = state.selectedNodeId === nodeId ? nextSel[0] ?? null : state.selectedNodeId;
      return {
        nodes: state.nodes.filter((item) => item.id !== nodeId),
        edges: state.edges.filter((item) => item.source !== nodeId && item.target !== nodeId),
        selectedNodeId: nextSelected,
        selectionNodeIds: nextSel,
        selectionEdgeIds: state.selectionEdgeIds,
        saveStatus: "idle",
      };
    }),

  deleteNodes: (nodeIds) =>
    set((state) => {
      const del = new Set(nodeIds);
      const keptNodes = state.nodes.filter((n) => !del.has(n.id));
      const keptEdges = state.edges.filter((e) => !del.has(e.source) && !del.has(e.target));
      const nextSelIds = state.selectionNodeIds.filter((id) => !del.has(id));
      const nextSelected = state.selectedNodeId && del.has(state.selectedNodeId) ? nextSelIds[0] ?? null : state.selectedNodeId;
      return {
        nodes: keptNodes,
        edges: keptEdges,
        selectedNodeId: nextSelected,
        selectionNodeIds: nextSelIds,
        selectionEdgeIds: state.selectionEdgeIds.filter((id) => keptEdges.some((e) => (e.id || "") === id)),
        saveStatus: "idle",
      };
    }),

  deleteEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((item) => (item.id || "") !== edgeId),
      selectionEdgeIds: state.selectionEdgeIds.filter((id) => id !== edgeId),
      saveStatus: "idle",
    })),

  pulseTriggerNodes: () => set((state) => ({ triggerPulseToken: state.triggerPulseToken + 1 })),

  setAgentRuntimeStatus: (nodeId, status) =>
    set((state) => ({
      agentRuntimeStatusById: { ...state.agentRuntimeStatusById, [nodeId]: status },
    })),

  clearRuntimeStates: () =>
    set({
      triggerPulseToken: 0,
      agentRuntimeStatusById: {},
    }),
}));
