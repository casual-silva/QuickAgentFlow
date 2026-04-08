import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BranchesOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  CompressOutlined,
  FullscreenOutlined,
  PlayCircleOutlined,
  StepForwardOutlined
} from "@ant-design/icons";
import { Button, Collapse, List, Space, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { debugWorkflowStep } from "../../api/client";
import { useRunObservationStore } from "../../store/runObservationStore";
import { useWorkflowStore } from "../../store/workflowStore";
import type { RunItem, RunLogItem } from "../../types/workflow";
import { RunLogsTable } from "./RunLogsTable";

function formatTokenUsage(output: Record<string, unknown>): string {
  const u = output.token_usage as Record<string, unknown> | undefined;
  if (!u || typeof u !== "object") return "";
  const p = u.prompt_tokens ?? u.input_tokens;
  const c = u.completion_tokens ?? u.output_tokens;
  const t = u.total_tokens;
  const parts: string[] = [];
  if (p != null) parts.push(`p${p}`);
  if (c != null) parts.push(`c${c}`);
  if (t != null && parts.length === 0) parts.push(`Σ${t}`);
  return parts.length ? `tok ${parts.join("/")}` : "";
}

const PANEL_HEIGHT_LS = "silva.executionPanelHeight";

function HttpStatusTag({ nodeType, output }: { nodeType: string; output: Record<string, unknown> }) {
  if (nodeType !== "http") return null;
  const err = output.error != null ? String(output.error) : "";
  const msg = output.message != null ? String(output.message) : "";
  if (err) {
    return (
      <Tag color="error" title={msg || err}>
        HTTP·{err}
      </Tag>
    );
  }
  const sc = output.status_code;
  if (typeof sc === "number") {
    const ok = sc >= 200 && sc < 300;
    return (
      <Tag color={ok ? "success" : "warning"} title={output.truncated ? "响应体已截断" : undefined}>
        HTTP {sc}
      </Tag>
    );
  }
  return null;
}

function JsonBlock({ label, data, maxPreHeight = 160 }: { label: string; data: unknown; maxPreHeight?: number }) {
  return (
    <div style={{ marginTop: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{label}</Typography.Text>
      <pre
        className="run-obs-json-pre"
        style={{
          margin: "4px 0 0",
          maxHeight: maxPreHeight,
          overflow: "auto",
          fontSize: 11,
          background: "#fafafa",
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          padding: 8
        }}
      >
        {typeof data === "string" ? data : JSON.stringify(data ?? {}, null, 2)}
      </pre>
    </div>
  );
}

type Props = {
  workflowId: string;
  run: RunItem | null;
  onReplay: () => void;
};

export function ExecutionBottomPanel({ workflowId, run, onReplay }: Props) {
  const [open, setOpen] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [obsTabKey, setObsTabKey] = useState("timeline");
  const [viewportH, setViewportH] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 800
  );
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window === "undefined") return 280;
    const n = Number(localStorage.getItem(PANEL_HEIGHT_LS));
    const maxH = Math.max(200, Math.floor(window.innerHeight * 0.92));
    return Number.isFinite(n) && n >= 120 && n <= maxH ? n : Math.min(280, maxH);
  });
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const { nodes, edges, selectedNodeId, setSelectedNode } = useWorkflowStore();
  const logs = useRunObservationStore((s) => s.logs);
  const selectedTimelineNodeId = useRunObservationStore((s) => s.selectedTimelineNodeId);
  const setSelectedTimelineNode = useRunObservationStore((s) => s.setSelectedTimelineNode);
  const runStatus = useRunObservationStore((s) => s.runStatus);
  const runError = useRunObservationStore((s) => s.runError);

  const [debugVars, setDebugVars] = useState<Record<string, Record<string, unknown>>>({});
  const [lastStepNodeId, setLastStepNodeId] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PANEL_HEIGHT_LS, String(panelHeight)); } catch { /* */ }
  }, [panelHeight]);

  useEffect(() => {
    function onResize() {
      setViewportH(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const maxPanelHeight = Math.max(200, Math.floor(viewportH * 0.92));

  useEffect(() => {
    setPanelHeight((h) => Math.min(h, maxPanelHeight));
  }, [maxPanelHeight]);

  useEffect(() => {
    if (!open) setFullScreen(false);
  }, [open]);

  useEffect(() => {
    if (!fullScreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullScreen]);

  function clampHeight(h: number) {
    return Math.min(maxPanelHeight, Math.max(120, h));
  }

  // 中文注释：拖拽手柄——上下拖动直接改变面板高度，取消低/中/高按钮
  function onResizeGripDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - ev.clientY;
      setPanelHeight(clampHeight(dragRef.current.startH + dy));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const jsonPreMax = fullScreen ? Math.min(560, Math.floor(viewportH * 0.5)) : 160;
  const innerScrollMax = fullScreen
    ? Math.max(280, viewportH - 120)
    : Math.max(140, panelHeight - 72);

  const lineage = useMemo(() => {
    const id = selectedNodeId;
    if (!id) return [] as string[];
    const up = new Set<string>();
    const q = [id];
    while (q.length) {
      const cur = q.pop()!;
      for (const e of edges) {
        if (e.target === cur && !up.has(e.source)) {
          up.add(e.source);
          q.push(e.source);
        }
      }
    }
    return Array.from(up);
  }, [edges, selectedNodeId]);

  const runInput = run?.input ?? {};

  async function onStepNext() {
    if (!workflowId) return;
    setStepLoading(true);
    try {
      const res = await debugWorkflowStep(workflowId, {
        input: runInput as Record<string, unknown>,
        vars: debugVars,
        last_node_id: lastStepNodeId
      });
      if (res.finished) {
        message.info("已到达图出口（__end__）");
        setStepLoading(false);
        return;
      }
      setDebugVars((res.vars || {}) as Record<string, Record<string, unknown>>);
      setLastStepNodeId(res.node_id || null);
      message.success(`已执行节点 ${res.node_id} (${res.node_type})`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e);
      message.error(`单步失败：${msg}`);
    } finally {
      setStepLoading(false);
    }
  }

  function resetStep() {
    setDebugVars({});
    setLastStepNodeId(null);
    message.info("已重置单步状态（下一将从 entry 开始）");
  }

  const timelineItems = [...logs].sort((a, b) => a.id - b.id);

  const panelBody = (
    <Tabs
      size="small"
      className={fullScreen ? "execution-obs-fullscreen-tabs" : undefined}
      activeKey={obsTabKey}
      onChange={(k) => setObsTabKey(k)}
      items={[
        {
          key: "timeline",
          label: "执行时间线",
          children: (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 260px",
                gap: 12,
                minHeight: Math.min(200, innerScrollMax),
                maxHeight: innerScrollMax,
                overflow: "hidden"
              }}
            >
              <List
                size="small"
                bordered
                dataSource={timelineItems}
                locale={{ emptyText: "暂无运行记录，请先「运行」或使用 Chat 触发" }}
                style={{ overflow: "auto", maxHeight: innerScrollMax }}
                renderItem={(item: RunLogItem) => {
                  const active = selectedTimelineNodeId === item.node_id;
                  const tok = formatTokenUsage(item.output);
                  const out = (item.output || {}) as Record<string, unknown>;
                  return (
                    <List.Item
                      style={{
                        cursor: "pointer",
                        background: active ? "rgba(22,119,255,.06)" : undefined
                      }}
                      onClick={() => {
                        setSelectedTimelineNode(item.node_id);
                        setSelectedNode(item.node_id);
                      }}
                    >
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <Space wrap size={6}>
                          <Typography.Text strong style={{ fontSize: 12 }}>{item.node_id}</Typography.Text>
                          <Tag style={{ margin: 0 }}>{item.node_type}</Tag>
                          <HttpStatusTag nodeType={item.node_type} output={out} />
                          <Tag
                            color={item.status === "failed" ? "red" : item.status === "running" ? "blue" : "green"}
                            style={{ margin: 0 }}
                          >
                            {item.status}
                          </Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {item.duration_ms} ms {tok ? `· ${tok}` : ""}
                          </Typography.Text>
                        </Space>
                        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                          <Collapse
                            ghost
                            size="small"
                            items={[
                              {
                                key: "io",
                                label: "输入 / 输出",
                                children: (
                                  <>
                                    <JsonBlock label="Input" data={item.input} maxPreHeight={jsonPreMax} />
                                    <JsonBlock label="Output" data={item.output} maxPreHeight={jsonPreMax} />
                                  </>
                                )
                              }
                            ]}
                          />
                        </div>
                      </Space>
                    </List.Item>
                  );
                }}
              />
              <div
                style={{
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                  padding: 10,
                  overflow: "auto",
                  maxHeight: innerScrollMax
                }}
              >
                <Typography.Text strong style={{ fontSize: 12 }}>
                  <BranchesOutlined /> 数据血缘（选中节点上游）
                </Typography.Text>
                <div style={{ marginTop: 8 }}>
                  {!selectedNodeId ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>在画布或时间线选择节点</Typography.Text>
                  ) : lineage.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>无入边（可能是入口）</Typography.Text>
                  ) : (
                    lineage.map((id) => (
                      <div key={id}>
                        <Button type="link" size="small" style={{ paddingLeft: 0 }} onClick={() => setSelectedNode(id)}>
                          {id}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                {selectedNodeId ? (
                  <div style={{ marginTop: 12 }}>
                    <Tooltip title="从选中节点开始恢复执行，使用最近运行的 vars 快照作为上游输入">
                      <Button
                        size="small"
                        icon={<PlayCircleOutlined />}
                        onClick={() => {
                          const varsFromLogs: Record<string, unknown> = {};
                          for (const log of logs) {
                            if (log.output) varsFromLogs[log.node_id] = log.output;
                          }
                          const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";
                          const url = `${baseUrl}/api/workflows/${workflowId}/resume/stream`;
                          fetch(url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              from_node_id: selectedNodeId,
                              input: runInput,
                              vars: varsFromLogs,
                            }),
                          })
                            .then((res) => {
                              if (!res.ok) throw new Error(`${res.status}`);
                              message.success(`已从 ${selectedNodeId} 开始恢复执行`);
                            })
                            .catch((err) => {
                              message.error(`恢复执行失败: ${err.message}`);
                            });
                        }}
                        style={{ borderColor: "#155eef", color: "#155eef" }}
                      >
                        从此节点继续
                      </Button>
                    </Tooltip>
                  </div>
                ) : null}
              </div>
            </div>
          )
        },
        {
          key: "table",
          label: "表格视图",
          children: (
            <div style={{ maxHeight: innerScrollMax, overflow: "auto" }}>
              <RunLogsTable logs={logs} embedded />
            </div>
          )
        },
        {
          key: "debug",
          label: "单步调试",
          children: (
            <Space direction="vertical" align="start" style={{ width: "100%" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                使用当前选中运行的 input 作为上下文，按与全图一致的路由每次执行一个节点。
              </Typography.Text>
              <Space wrap>
                <Button type="primary" icon={<StepForwardOutlined />} loading={stepLoading} onClick={() => void onStepNext()}>
                  下一步
                </Button>
                <Button onClick={resetStep}>重置单步</Button>
                <Tag>last: {lastStepNodeId || "（从 entry）"}</Tag>
              </Space>
              <JsonBlock label="累计 vars（调试用）" data={debugVars} maxPreHeight={jsonPreMax} />
            </Space>
          )
        }
      ]}
    />
  );

  return (
    <div style={{ borderTop: "1px solid #f0f0f0", background: "#fff", flexShrink: 0 }}>
      {/* 中文注释：标题栏——折叠时显示摘要状态栏，展开时只显示折叠按钮+状态 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          userSelect: "none"
        }}
      >
        <Space align="center" wrap size={8}>
          <Tooltip title={open ? "收起运行观测" : "展开运行观测"}>
            <Button
              type="text"
              size="small"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 6px", height: 32 }}
            >
              {open ? <CaretDownOutlined /> : <CaretUpOutlined />}
              <Typography.Text strong style={{ fontSize: 13 }}>运行观测</Typography.Text>
            </Button>
          </Tooltip>
          <Tag color={runStatus === "success" ? "green" : runStatus === "failed" ? "red" : "blue"}>
            {runStatus || "未加载"}
          </Tag>
          {!open && logs.length > 0 ? (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {logs.length} 节点
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                · 总耗时 {logs.reduce((s, l) => s + l.duration_ms, 0)}ms
              </Typography.Text>
              {logs.filter((l) => l.status === "failed").length > 0 ? (
                <Tag color="red" style={{ fontSize: 10, margin: 0 }}>
                  {logs.filter((l) => l.status === "failed").length} 失败
                </Tag>
              ) : null}
              {logs.length > 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  · 最后: {logs[logs.length - 1].node_id}
                </Typography.Text>
              ) : null}
            </>
          ) : null}
          {runError ? (
            <Typography.Text type="danger" ellipsis style={{ maxWidth: 240, fontSize: 12 }}>{runError}</Typography.Text>
          ) : null}
        </Space>
        <Space size={4} wrap>
          {open ? (
            <Tooltip title={fullScreen ? "退出全屏（Esc）" : "全屏查看日志与 JSON，便于调试大块输出"}>
              <Button
                size="small"
                icon={fullScreen ? <CompressOutlined /> : <FullscreenOutlined />}
                onClick={() => setFullScreen((v) => !v)}
              >
                {fullScreen ? "退出全屏" : "全屏"}
              </Button>
            </Tooltip>
          ) : null}
          <Button size="small" icon={<PlayCircleOutlined />} onClick={onReplay}>
            同输入再运行
          </Button>
        </Space>
      </div>
      {open && fullScreen ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px 10px",
            borderTop: "1px solid #f0f0f0",
            background: "#f6ffed",
            borderBottom: "1px solid #b7eb8f"
          }}
        >
          <Typography.Text style={{ fontSize: 12 }}>
            运行观测已在<strong>全屏</strong>中打开（按 Esc 或点全屏内「退出」关闭）
          </Typography.Text>
          <Button size="small" type="primary" icon={<CompressOutlined />} onClick={() => setFullScreen(false)}>
            退出全屏
          </Button>
        </div>
      ) : null}
      {open && !fullScreen ? (
        <>
          <Tooltip title={`上下拖动调整高度（当前 ${panelHeight}px，最高约 ${maxPanelHeight}px，随窗口变化）`}>
            <div
              role="separator"
              aria-label="拖拽调整运行观测面板高度"
              onMouseDown={onResizeGripDown}
              onClick={(e) => e.stopPropagation()}
              style={{
                height: 10,
                cursor: "ns-resize",
                background: "linear-gradient(180deg, #d9d9d9 0%, #f0f0f0 45%, #fafafa 100%)",
                borderTop: "1px solid #e8e8e8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 3,
                  borderRadius: 2,
                  background: "#bfbfbf",
                  pointerEvents: "none"
                }}
              />
            </div>
          </Tooltip>
          <div
            role="region"
            aria-label="运行观测内容"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ padding: "0 12px 12px", height: panelHeight, overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{panelBody}</div>
          </div>
        </>
      ) : null}
      {fullScreen
        ? createPortal(
            <div
              className="execution-obs-fullscreen-overlay"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 10050,
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 -4px 24px rgba(0,0,0,.12)"
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  gap: 12
                }}
              >
                <Space align="center" wrap>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    运行观测 · 全屏
                  </Typography.Title>
                  <Tag color={runStatus === "success" ? "green" : runStatus === "failed" ? "red" : "blue"}>
                    {runStatus || "未加载"}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Esc 退出
                  </Typography.Text>
                </Space>
                <Space>
                  <Button icon={<PlayCircleOutlined />} onClick={onReplay}>
                    同输入再运行
                  </Button>
                  <Button type="primary" icon={<CompressOutlined />} onClick={() => setFullScreen(false)}>
                    退出全屏
                  </Button>
                </Space>
              </div>
              <div
                role="region"
                aria-label="运行观测全屏内容"
                style={{ flex: 1, minHeight: 0, padding: "12px 16px 16px", overflow: "hidden", display: "flex", flexDirection: "column" }}
              >
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{panelBody}</div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
