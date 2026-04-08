import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
  OnSelectionChangeParams,
  applyEdgeChanges,
  applyNodeChanges
} from "reactflow";
import { DeleteOutlined, DragOutlined, SearchOutlined } from "@ant-design/icons";
import { Input, Modal, Tooltip, Typography } from "antd";
import "reactflow/dist/style.css";
import { useRunObservationStore } from "../../store/runObservationStore";
import { useWorkflowStore } from "../../store/workflowStore";
import { useNodeTypeSpecs } from "../../store/nodeTypeSpecStore";
import { findCycleEdgeIds } from "../../utils/graphCycle";
import type { WorkflowNode } from "../../types/workflow";
import { AgentFlowNode, GenericFlowNode } from "./nodes/WorkflowNodeCard";

const SNAP_GRID: [number, number] = [16, 16];

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reactFlow = useReactFlow();
  const {
    nodes,
    edges,
    setGraph,
    setSelectedNode,
    setCanvasSelection,
    addEdge,
    addNode,
    deleteNodes,
    deleteEdge,
    triggerPulseToken,
    agentRuntimeStatusById
  } = useWorkflowStore();
  const nodeChromeById = useRunObservationStore((s) => s.nodeChromeById);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [handPan, setHandPan] = useState(false);
  const cycleEdgeIdSet = useMemo(() => new Set(findCycleEdgeIds(nodes, edges)), [nodes, edges]);

  // Command Palette 状态
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const { specs, fetch: fetchSpecs } = useNodeTypeSpecs();
  useEffect(() => { void fetchSpecs(); }, [fetchSpecs]);

  const cmdFiltered = useMemo(() => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return specs;
    return specs.filter(
      (s) => s.type.toLowerCase().includes(q) || s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [specs, cmdQuery]);

  // 中文注释：Cmd/Ctrl+K 唤起快捷搜索
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
        setCmdQuery("");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function onCmdSelect(type: string) {
    setCmdOpen(false);
    addNode(type as WorkflowNode["type"]);
    const latest = useWorkflowStore.getState().nodes;
    const created = latest[latest.length - 1];
    if (created && wrapperRef.current) {
      const center = reactFlow.screenToFlowPosition({
        x: wrapperRef.current.clientWidth / 2,
        y: wrapperRef.current.clientHeight / 2
      });
      const updated = latest.map((n) => (n.id === created.id ? { ...n, position: center } : n));
      setGraph(updated, useWorkflowStore.getState().edges);
    }
  }

  const logs = useRunObservationStore((s) => s.logs);

  const nodeLineageDuration = useMemo(() => {
    const m: Record<string, number> = {};
    for (const log of logs) {
      m[log.node_id] = log.duration_ms;
    }
    return m;
  }, [logs]);

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          __runtimePulseToken: node.type === "trigger" ? triggerPulseToken : undefined,
          __agentRuntimeStatus: node.type === "agent" ? agentRuntimeStatusById[node.id] || "idle" : undefined,
          __executionChrome: nodeChromeById[node.id] as "success" | "failed" | "running" | undefined,
          __lineageDuration: nodeLineageDuration[node.id]
        }
      })),
    [agentRuntimeStatusById, nodeChromeById, nodeLineageDuration, nodes, triggerPulseToken]
  );

  const nodeTypes = useMemo(
    () => ({
      global: GenericFlowNode,
      trigger: GenericFlowNode,
      llm: GenericFlowNode,
      tool: GenericFlowNode,
      http: GenericFlowNode,
      memory: GenericFlowNode,
      condition: GenericFlowNode,
      if: GenericFlowNode,
      switch: GenericFlowNode,
      loop: GenericFlowNode,
      parallel: GenericFlowNode,
      delay: GenericFlowNode,
      action: GenericFlowNode,
      end: GenericFlowNode,
      agent: AgentFlowNode,
      start: GenericFlowNode,
      llm_compare: GenericFlowNode,
      split_in_batches: GenericFlowNode,
      group: GenericFlowNode,
      knowledge_retrieve: GenericFlowNode,
      set_fields: GenericFlowNode
    }),
    []
  );

  const onNodesChange: OnNodesChange = (changes) => {
    const removedIds = new Set(
      changes.filter((c): c is { type: "remove"; id: string } => c.type === "remove").map((c) => c.id)
    );
    const nextNodes = applyNodeChanges(changes, nodes as any) as unknown as WorkflowNode[];
    let nextEdges = edges;
    if (removedIds.size > 0) {
      nextEdges = edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target));
    }
    setGraph(nextNodes, nextEdges);
    const st = useWorkflowStore.getState();
    if (st.selectedNodeId && removedIds.has(st.selectedNodeId)) {
      st.setSelectedNode(null);
    }
  };

  const onEdgesChange: OnEdgesChange = (changes) => {
    const nextEdges = applyEdgeChanges(changes, edges as any) as any;
    setGraph(nodes, nextEdges);
  };

  const isConnectionAllowed = useCallback(
    (params: { source?: string | null; target?: string | null }) => {
      if (!params.source || !params.target) return false;
      const ids = new Set(nodes.map((n) => n.id));
      return ids.has(params.source) && ids.has(params.target);
    },
    [nodes]
  );

  const onConnect: OnConnect = (params) => {
    if (!params.source || !params.target || !isConnectionAllowed(params)) return;
    addEdge({
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle || undefined
    });
  };

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const nodeIds = params.nodes.map((n) => n.id);
      const edgeIds = params.edges.map((e) => e.id);
      setSelectedNodeIds(nodeIds);
      setSelectedEdgeIds(edgeIds);
      setCanvasSelection(nodeIds, edgeIds);
    },
    [setCanvasSelection]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [setSelectedNode]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw || !wrapperRef.current) return;
      let type: WorkflowNode["type"];
      let preset: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(raw) as { type?: string; preset?: Record<string, unknown> };
        if (parsed && typeof parsed.type === "string") {
          type = parsed.type as WorkflowNode["type"];
          preset = parsed.preset;
        } else {
          type = raw as WorkflowNode["type"];
        }
      } catch {
        type = raw as WorkflowNode["type"];
      }
      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      });
      addNode(type, preset);
      const latest = useWorkflowStore.getState().nodes;
      const created = latest[latest.length - 1];
      if (created) {
        const updated = latest.map((n) => (n.id === created.id ? { ...n, position } : n));
        setGraph(updated, useWorkflowStore.getState().edges);
      }
    },
    [addNode, reactFlow, setGraph]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDeleteSelection = useCallback(() => {
    if (selectedNodeIds.length > 0) deleteNodes(selectedNodeIds);
    selectedEdgeIds.forEach((id) => deleteEdge(id));
  }, [deleteEdge, deleteNodes, selectedEdgeIds, selectedNodeIds]);

  const flowEdges = useMemo(
    () =>
      edges.map((item, idx) => {
        const id = item.id || `e_${idx}_${item.source}_${item.target}`;
        const onCycle = cycleEdgeIdSet.has(id);
        const sourceChrome = nodeChromeById[item.source];
        const targetChrome = nodeChromeById[item.target];
        let edgeClassName = "";
        if (sourceChrome === "running" || targetChrome === "running") {
          edgeClassName = "edge-running";
        } else if (sourceChrome === "success" && targetChrome === "success") {
          edgeClassName = "edge-success";
        } else if (sourceChrome === "failed" || targetChrome === "failed") {
          edgeClassName = "edge-failed";
        }
        const stroke = onCycle ? "rgba(255, 77, 79, 0.95)" : "rgba(15, 23, 42, 0.22)";
        return {
          ...item,
          id,
          type: "default" as const,
          className: edgeClassName || undefined,
          style: {
            stroke,
            strokeWidth: onCycle ? 1.5 : 1,
            strokeLinecap: "round" as const,
            strokeLinejoin: "round" as const
          },
          interactionWidth: 20,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 8,
            height: 8
          }
        };
      }),
    [cycleEdgeIdSet, edges, nodeChromeById]
  );

  const selectionCount = selectedNodeIds.length + selectedEdgeIds.length;

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        className="workflow-flow-canvas"
        nodes={decoratedNodes as any}
        edges={flowEdges as any}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={SNAP_GRID}
        deleteKeyCode={["Backspace", "Delete"]}
        selectionOnDrag={!handPan}
        multiSelectionKeyCode={["Meta", "Control"]}
        panOnDrag={handPan ? true : [2]}
        panActivationKeyCode="Space"
        zoomOnScroll
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        onNodeClick={(_, node) => setSelectedNode(node.id)}
        onDrop={onDrop}
        onDragOver={onDragOver}
        isValidConnection={isConnectionAllowed as any}
        connectionLineType={"smoothstep" as any}
        connectionLineStyle={{
          stroke: "rgba(0, 102, 255, 0.5)",
          strokeWidth: 1,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }}
        defaultEdgeOptions={{
          type: "default",
          style: { stroke: "rgba(15, 23, 42, 0.22)", strokeWidth: 1, strokeLinecap: "round", strokeLinejoin: "round" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 8, height: 8, color: "rgba(15, 23, 42, 0.28)" }
        }}
      >
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          className="workflow-flow-minimap-panel"
          style={{ marginBottom: 8, marginLeft: 8 }}
        />
        {/* 中文注释：缩放/适应与拖移、删除同一工具条，避免左下角多块悬浮面板 */}
        <Controls
          showInteractive={false}
          position="bottom-left"
          className="workflow-flow-toolbar-controls"
        >
          <Tooltip title={handPan ? "关闭手型：恢复框选" : "手型拖移画布（或按住空格）"}>
            <ControlButton
              onClick={() => setHandPan((v) => !v)}
              className={handPan ? "workflow-canvas-tool-active" : undefined}
              aria-label="toggle pan"
            >
              <DragOutlined />
            </ControlButton>
          </Tooltip>
          <Tooltip title="删除选中（Delete / Backspace）">
            <span>
              <ControlButton
                onClick={onDeleteSelection}
                disabled={selectionCount === 0}
                aria-label="delete selection"
                style={selectionCount > 0 ? { color: "#ff4d4f" } : undefined}
              >
                <DeleteOutlined />
              </ControlButton>
            </span>
          </Tooltip>
        </Controls>
        <Background variant={BackgroundVariant.Dots} gap={SNAP_GRID[0]} size={1} color="#d0d5dd" />
      </ReactFlow>

      {/* 中文注释：Command Palette——全局快捷搜索添加节点 */}
      <Modal
        open={cmdOpen}
        onCancel={() => setCmdOpen(false)}
        footer={null}
        closable={false}
        width={420}
        styles={{ body: { padding: "12px 16px" } }}
        style={{ top: "20%" }}
      >
        <Input
          autoFocus
          prefix={<SearchOutlined />}
          placeholder="搜索节点类型…（输入后回车或点击添加）"
          value={cmdQuery}
          onChange={(e) => setCmdQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setCmdOpen(false);
            if (e.key === "Enter" && cmdFiltered.length > 0) {
              onCmdSelect(cmdFiltered[0].type);
            }
          }}
          style={{ marginBottom: 8 }}
        />
        <div style={{ maxHeight: 300, overflow: "auto" }}>
          {cmdFiltered.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>无匹配节点类型</Typography.Text>
          ) : (
            cmdFiltered.map((spec) => (
              <div
                key={spec.type}
                onClick={() => onCmdSelect(spec.type)}
                style={{
                  padding: "8px 10px",
                  cursor: "pointer",
                  borderRadius: 6,
                  transition: "background .15s",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#e6f4ff"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>{spec.label}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>{spec.type}</Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11, maxWidth: 180 }} ellipsis>
                  {spec.description}
                </Typography.Text>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
