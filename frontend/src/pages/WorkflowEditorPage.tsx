import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CloudUploadOutlined,
  EyeOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlayCircleOutlined,
  SaveOutlined
} from "@ant-design/icons";
import { Button, Card, Drawer, Form, Input, Modal, Space, Tag, Tooltip, Typography, message } from "antd";
import {
  createTemplate,
  getRun,
  getWorkflow,
  listRunLogs,
  listWorkflowRuns,
  runWorkflow,
  updateWorkflow,
  validateWorkflowGraph
} from "../api/client";
import { ChatTestPanel } from "../components/editor/ChatTestPanel";
import { ExecutionBottomPanel } from "../components/editor/ExecutionBottomPanel";
import { NodePalette } from "../components/editor/NodePalette";
import { PropertyPanel } from "../components/editor/PropertyPanel";
import { ParameterPreviewPanel } from "../components/editor/ParameterPreviewPanel";
import { RunHistoryPanel } from "../components/editor/RunHistoryPanel";
import { WorkflowReadinessPanel } from "../components/editor/WorkflowReadinessPanel";
import { WorkflowCanvas } from "../components/editor/WorkflowCanvas";
import { useRunObservationStore } from "../store/runObservationStore";
import { useWorkflowStore } from "../store/workflowStore";
import type { RunItem } from "../types/workflow";
import { firstBlockingIssue } from "../utils/workflowReadiness";
import { useDrawerWidth } from "../hooks/useDrawerWidth";
import { useMediaQuery } from "../hooks/useMediaQuery";

function getErrorDetail(error: unknown): string {
  const maybe = error as { response?: { data?: { detail?: string } }; message?: string };
  return maybe?.response?.data?.detail || maybe?.message || "unknown error";
}

export function WorkflowEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const {
    workflowName,
    nodes,
    edges,
    selectedNodeId,
    setWorkflowMeta,
    setGraph,
    saveStatus,
    setSaveStatus,
    pulseTriggerNodes,
    setAgentRuntimeStatus,
    clearRuntimeStates
  } = useWorkflowStore();
  const [run, setRun] = useState<RunItem | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [paramPreviewOpen, setParamPreviewOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [form] = Form.useForm<{ query: string }>();
  const editorNarrow = useMediaQuery("(max-width: 768px)");
  const propertyDrawerWidth = useDrawerWidth(440, 280, 20);

  // 中文注释：抽屉由 selectedNodeId 驱动——选中节点自动打开，点空白自动关闭
  const drawerOpen = !!selectedNodeId && !immersiveMode;

  // 中文注释：Ctrl/Cmd+B 快捷键切换左侧节点库折叠
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setLeftCollapsed((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    async function load() {
      // 核心流程注释：进入编辑器后先拉取后端工作流定义，再同步到本地 store。
      setWorkflowMeta("", "");
      setGraph([], []);
      const workflow = await getWorkflow(id);
      const loadedNodeIds = new Set(workflow.graph.nodes.map((node) => node.id));
      const cleanedEdges = workflow.graph.edges.filter((edge) => loadedNodeIds.has(edge.source) && loadedNodeIds.has(edge.target));
      setWorkflowMeta(workflow.id, workflow.name);
      setGraph(workflow.graph.nodes, cleanedEdges);
      if (cleanedEdges.length !== workflow.graph.edges.length) {
        Modal.warning({
          title: "检测到历史无效连线",
          content: `已自动忽略 ${workflow.graph.edges.length - cleanedEdges.length} 条引用失效节点的边，请保存以修复该工作流。`
        });
      }
      setSaveStatus("saved");
      await refreshHistory(undefined, false);
    }
    if (id) {
      void load().catch((error: unknown) => {
        const detail = getErrorDetail(error);
        if (detail.includes("404") || detail.includes("not found")) {
          Modal.error({
            title: "工作流不存在",
            content: "该工作流可能已被删除，将返回列表页。",
            onOk: () => navigate("/workflows")
          });
          return;
        }
        message.error(`工作流加载失败：${detail}`);
      });
    }
  }, [id, navigate, setGraph, setSaveStatus, setWorkflowMeta]);

  async function refreshHistory(activeRunId?: string, hydrateObservation = false) {
    const history = await listWorkflowRuns(id);
    setRuns(history);
    const runId = activeRunId || history[0]?.id;
    if (runId && hydrateObservation) {
      const [runDetail, runLogs] = await Promise.all([getRun(runId), listRunLogs(runId)]);
      setRun(runDetail);
      useRunObservationStore.getState().setFromRun(runDetail.id, runDetail.status, runDetail.error ?? null, runLogs);
    } else {
      setRun(null);
      useRunObservationStore.getState().clear();
    }
  }

  async function onSave() {
    // 核心流程注释：保存时只提交工作流必要字段，避免前端临时状态污染持久化数据。
    const nodeIds = new Set(nodes.map((node) => node.id));
    const danglingEdges = edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
    if (danglingEdges.length > 0) {
      Modal.error({
        title: "保存失败：存在无效连线",
        content: `检测到 ${danglingEdges.length} 条边引用了不存在的节点。请删除这些边后重试。`
      });
      setSaveStatus("error");
      return;
    }
    setSaveStatus("saving");
    try {
      const entryNodeId = nodes.find((node) => node.type === "trigger")?.id || nodes[0]?.id || "start_1";
      const graphPayload = {
        entry: entryNodeId,
        nodes,
        edges
      };
      const pre = await validateWorkflowGraph(graphPayload);
      if (!pre.ok) {
        setSaveStatus("error");
        Modal.error({
          title: "保存前校验失败",
          content: pre.issues.join("\n")
        });
        return;
      }
      await updateWorkflow(id, {
        name: workflowName || "untitled-workflow",
        graph: graphPayload
      });
      setSaveStatus("saved");
      message.success("保存成功");
    } catch (error) {
      console.error(error);
      setSaveStatus("error");
      Modal.error({
        title: "保存失败",
        content: getErrorDetail(error)
      });
    }
  }

  async function onSaveAsTemplate() {
    if (!id) return;
    try {
      await createTemplate({
        name: templateName.trim() || `${workflowName || "workflow"}-模板`,
        description: "由工作流编辑器保存",
        source_workflow_id: id
      });
      setTemplateModalOpen(false);
      setTemplateName("");
      message.success("保存模板成功");
    } catch {
      message.error("保存模板失败");
    }
  }

  async function onRunSubmit() {
    // 核心流程注释：先创建运行任务，再查询运行结果，V0 使用轮询保证实现简单稳定。
    const values = form.getFieldsValue();
    const blocker = firstBlockingIssue(nodes, edges);
    if (blocker) {
      Modal.error({
        title: "运行前校验失败",
        content: blocker.message
      });
      return;
    }
    const globalVariables = nodes
      .filter((node) => node.type === "global")
      .reduce(
        (acc, node) => ({
          ...acc,
          ...(((node.data.variables as Record<string, string> | undefined) || {}) as Record<string, string>)
        }),
        {} as Record<string, string>
      );
    setRunning(true);
    try {
      const createdRun = await runWorkflow(id, { query: values.query || "", ...globalVariables });
      setRunModalOpen(false);
      clearRuntimeStates();
      // 中文注释：新运行开始时清空当前观测区；历史详情统一在「运行历史」中查看。
      useRunObservationStore.getState().clear();
      setRun(null);
      await refreshHistory(createdRun.id, false);
      let finalRun = await getRun(createdRun.id);
      if (finalRun.status === "pending" || finalRun.status === "running") {
        for (let i = 0; i < 90; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          finalRun = await getRun(createdRun.id);
          if (finalRun.status === "success" || finalRun.status === "failed") break;
        }
        await refreshHistory(createdRun.id, false);
      }
      if (finalRun.status === "failed") {
        message.error("运行失败");
        Modal.error({ title: "运行失败", content: String(finalRun.error || "unknown") });
      } else if (finalRun.status === "success") {
        message.success("运行成功");
      } else {
        message.warning("运行仍在进行或等待超时，请在右侧历史与底栏「运行观测」查看状态");
      }
    } catch (error) {
      console.error(error);
      Modal.error({ title: "运行失败", content: getErrorDetail(error) });
    } finally {
      clearRuntimeStates();
      setRunning(false);
    }
  }

  const paletteCol = immersiveMode ? "0px" : leftCollapsed ? "40px" : "auto";

  return (
    <div
      className="workflow-editor-root"
      style={{
        display: "grid",
        gridTemplateColumns: editorNarrow ? "1fr" : `${paletteCol} 1fr`,
        gridTemplateRows: immersiveMode
          ? "minmax(0, 1fr)"
          : editorNarrow
            ? "auto minmax(0, 1fr)"
            : "minmax(0, 1fr)",
        flex: 1,
        minHeight: 0,
        height: "100%",
        transition: "grid-template-columns .2s, grid-template-rows .2s"
      }}
    >
      <div
        className="workflow-editor-palette-slot"
        style={{
          overflow: "hidden",
          minHeight: 0,
          display: immersiveMode ? "none" : undefined,
          gridRow: editorNarrow && !immersiveMode ? 1 : undefined
        }}
      >
        <NodePalette collapsed={leftCollapsed} />
      </div>
      <main
        style={{
          minWidth: 0,
          padding: editorNarrow ? 8 : 12,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          flex: 1,
          gridRow: editorNarrow && !immersiveMode ? 2 : undefined
        }}
      >
        <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: "10px 12px" } }}>
          <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap", rowGap: 8 }} align="center">
            <Space size="middle" align="center">
              <Typography.Title level={5} style={{ margin: 0 }}>
                {workflowName || "workflow"}
              </Typography.Title>
              <Tag color={saveStatus === "saved" ? "green" : saveStatus === "error" ? "red" : "blue"}>
                {saveStatus}
              </Tag>
            </Space>
            <Space size={4} wrap>
              <Tooltip title={leftCollapsed ? "展开左侧节点栏" : "折叠左侧节点栏"}>
                <Button
                  type="text"
                  icon={leftCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setLeftCollapsed((v) => !v)}
                />
              </Tooltip>
              <Tooltip title="保存工作流">
                <Button type="text" icon={<SaveOutlined />} onClick={onSave}>
                  保存
                </Button>
              </Tooltip>
              <Tooltip title="保存为模板">
                <Button type="text" icon={<CloudUploadOutlined />} onClick={() => setTemplateModalOpen(true)}>
                  模板
                </Button>
              </Tooltip>
              <Tooltip title="运行工作流">
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setRunModalOpen(true)}>
                  运行
                </Button>
              </Tooltip>
              <Tooltip title="快速查看运行历史">
                <Button type="text" icon={<HistoryOutlined />} onClick={() => setRunHistoryOpen(true)}>
                  历史
                </Button>
              </Tooltip>
              <Tooltip title={immersiveMode ? "退出沉浸模式" : "进入沉浸模式（聚焦画布）"}>
                <Button type={immersiveMode ? "default" : "text"} icon={<EyeOutlined />} onClick={() => setImmersiveMode((v) => !v)}>
                  {immersiveMode ? "退出沉浸" : "沉浸模式"}
                </Button>
              </Tooltip>
            </Space>
          </Space>
        </Card>
        <div
          style={{
            flex: 1,
            minHeight: 200,
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <WorkflowCanvas />
        </div>
        {!immersiveMode ? (
          <>
            <WorkflowReadinessPanel />
            <ExecutionBottomPanel
              workflowId={id}
              run={run}
              onReplay={() => {
                const inp = run?.input as Record<string, unknown> | undefined;
                if (inp) {
                  form.setFieldsValue({
                    query: String(inp.query ?? "")
                  });
                }
                setRunModalOpen(true);
              }}
            />
          </>
        ) : null}
      </main>

      {/* 中文注释：属性面板改为右侧滑入式抽屉，选中节点自动打开，释放画布空间 */}
      <Drawer
        title="节点属性"
        placement="right"
        width={propertyDrawerWidth}
        open={drawerOpen}
        mask={false}
        onClose={() => useWorkflowStore.getState().setSelectedNode(null)}
        className="property-drawer"
        styles={{ body: { padding: 0 } }}
        extra={
          <Space size={4} wrap>
            <Button size="small" type="link" onClick={() => setParamPreviewOpen(true)}>
              预览运行时参数
            </Button>
            <Button size="small" type="link" onClick={() => setRunHistoryOpen(true)}>
              运行历史
            </Button>
          </Space>
        }
      >
        <div className="property-panel-surface" style={{ height: "100%", overflow: "auto", padding: 12 }}>
          <PropertyPanel />
        </div>
      </Drawer>

      <Modal
        title="运行时参数预览"
        open={paramPreviewOpen}
        onCancel={() => setParamPreviewOpen(false)}
        footer={null}
        width={editorNarrow ? "calc(100vw - 24px)" : 640}
        destroyOnClose
        styles={{ body: { maxHeight: "min(70vh, 560px)", overflowY: "auto", paddingTop: 12 } }}
      >
        <ParameterPreviewPanel />
      </Modal>

      <Modal
        title="运行历史"
        open={runHistoryOpen}
        onCancel={() => setRunHistoryOpen(false)}
        footer={null}
        width={editorNarrow ? "calc(100vw - 24px)" : 520}
        destroyOnClose
        styles={{ body: { maxHeight: "min(70vh, 480px)", overflowY: "auto", paddingTop: 12 } }}
      >
        <RunHistoryPanel
          runs={runs}
          activeRunId={run?.id || null}
          onSelect={(runId) => {
            void Promise.all([getRun(runId), listRunLogs(runId)]).then(([detail, items]) => {
              setRun(detail);
              useRunObservationStore.getState().setFromRun(detail.id, detail.status, detail.error ?? null, items);
            });
          }}
        />
      </Modal>

      <Modal
        title="启动工作流"
        open={runModalOpen}
        onCancel={() => setRunModalOpen(false)}
        onOk={() => void form.validateFields().then(onRunSubmit)}
        confirmLoading={running}
      >
        <Form layout="vertical" form={form} initialValues={{ query: "" }}>
          <Form.Item label="Query 输入参数" name="query">
            <Input placeholder="例如：帮我总结这份方案" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="保存到模板库"
        open={templateModalOpen}
        onCancel={() => setTemplateModalOpen(false)}
        onOk={() => void onSaveAsTemplate()}
      >
        <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="模板名称" />
      </Modal>
      <ChatTestPanel
        workflowId={id}
        onRunEvent={(evt) => {
          if (evt.event === "chat_sent") {
            pulseTriggerNodes();
          }
          if (evt.event === "node_start" && evt.node_type === "agent" && evt.node_id) {
            setAgentRuntimeStatus(String(evt.node_id), "thinking");
          }
          if (evt.event === "node_start" && (evt.node_type === "tool" || evt.node_type === "http")) {
            nodes
              .filter((item) => item.type === "agent")
              .forEach((item) => setAgentRuntimeStatus(item.id, "executing_tool"));
          }
          if (evt.event === "node_end" && (evt.node_type === "tool" || evt.node_type === "http")) {
            nodes
              .filter((item) => item.type === "agent")
              .forEach((item) => setAgentRuntimeStatus(item.id, "thinking"));
          }
          if (evt.event === "node_end" && evt.node_type === "agent" && evt.node_id) {
            setAgentRuntimeStatus(String(evt.node_id), "idle");
          }
          if (evt.event === "done") {
            // 中文注释：运行完成后不回填上次日志到当前画布，避免“历史残留”干扰下一次运行观察。
            void refreshHistory(evt.run_id, false);
            useRunObservationStore.getState().clear();
            setRun(null);
            clearRuntimeStates();
          }
          if (evt.event === "failed") {
            clearRuntimeStates();
          }
        }}
      />
    </div>
  );
}
