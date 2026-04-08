import { MessageOutlined, MinusOutlined } from "@ant-design/icons";
import { Button, Card, Collapse, Input, Modal, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useMemo, useRef, useState } from "react";
import { useRunObservationStore } from "../../store/runObservationStore";
import { useWorkflowStore } from "../../store/workflowStore";
import { firstBlockingIssue } from "../../utils/workflowReadiness";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

type TraceLine = {
  key: string;
  phase: "start" | "end" | "trace";
  nodeId: string;
  nodeType: string;
  durationMs?: number;
  hint?: string;
};

type ChatRound = {
  id: string;
  userText: string;
  finalText: string;
  traces: TraceLine[];
};

function httpTraceHint(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;
  if (o.error) return String(o.message ?? o.error);
  const sc = o.status_code;
  if (typeof sc === "number") return `HTTP ${sc}`;
  return undefined;
}

interface Props {
  workflowId: string;
  onRunEvent?: (evt: any) => void;
}

export function ChatTestPanel({ workflowId, onRunEvent }: Props) {
  const { nodes, edges } = useWorkflowStore();
  const globalVariables = useMemo(
    () =>
      nodes
        .filter((node) => node.type === "global")
        .reduce(
          (acc, node) => ({
            ...acc,
            ...(((node.data.variables as Record<string, string> | undefined) || {}) as Record<string, string>)
          }),
          {} as Record<string, string>
        ),
    [nodes]
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rounds, setRounds] = useState<ChatRound[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  function patchLastRound(fn: (r: ChatRound) => ChatRound) {
    setRounds((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !workflowId) return;
    const blocker = firstBlockingIssue(nodes, edges);
    if (blocker) {
      Modal.error({ title: "Chat 无法发送", content: `${blocker.message}（请先修复后再试）` });
      return;
    }
    const roundId = `r-${Date.now()}`;
    setInput("");
    setRounds((prev) => [...prev, { id: roundId, userText: text, finalText: "", traces: [] }]);
    setLoading(true);
    onRunEvent?.({ event: "chat_sent" });
    useRunObservationStore.getState().resetLive();
    useRunObservationStore.setState({ activeRunId: null });

    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/workflows/${workflowId}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { query: text, ...globalVariables },
          context: { globals: globalVariables }
        })
      });
      if (!res.body) throw new Error("stream_not_available");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.replace("data: ", ""));
          if (payload.run_id) {
            useRunObservationStore.setState({ activeRunId: String(payload.run_id) });
          }
          onRunEvent?.(payload);
          if (payload.event === "node_start" && payload.node_id) {
            useRunObservationStore.getState().markNodeRunning(String(payload.node_id));
            patchLastRound((r) => ({
              ...r,
              traces: [
                ...r.traces,
                {
                  key: `s-${payload.node_id}-${r.traces.length}`,
                  phase: "start",
                  nodeId: String(payload.node_id),
                  nodeType: String(payload.node_type || "")
                }
              ]
            }));
          }
          if (payload.event === "trace") {
            useRunObservationStore.getState().appendLiveTrace({
              phase: String(payload.phase || ""),
              message: String(payload.message || ""),
              node_id: payload.node_id != null ? String(payload.node_id) : undefined,
              meta: (payload.meta || {}) as Record<string, unknown>,
              seq: typeof payload.seq === "number" ? payload.seq : undefined
            });
            patchLastRound((r) => ({
              ...r,
              traces: [
                ...r.traces,
                {
                  key: `t-${payload.seq}-${r.traces.length}`,
                  phase: "trace",
                  nodeId: String(payload.node_id || ""),
                  nodeType: String(payload.phase || "trace"),
                  hint: String(payload.message || "")
                }
              ]
            }));
          }
          if (payload.event === "node_end") {
            useRunObservationStore.getState().appendLiveNodeEnd({
              node_id: String(payload.node_id),
              node_type: String(payload.node_type),
              input: (payload.input || {}) as Record<string, unknown>,
              output: (payload.output || {}) as Record<string, unknown>,
              duration_ms: Number(payload.duration_ms || 0),
              usage: (payload.usage || payload.token_usage) as Record<string, unknown> | undefined
            });
            const hint =
              payload.node_type === "http"
                ? httpTraceHint(payload.output)
                : payload.node_type === "tool"
                  ? "工具调用完成"
                  : undefined;
            patchLastRound((r) => ({
              ...r,
              traces: [
                ...r.traces,
                {
                  key: `e-${payload.node_id}-${r.traces.length}`,
                  phase: "end",
                  nodeId: String(payload.node_id),
                  nodeType: String(payload.node_type || ""),
                  durationMs: Number(payload.duration_ms || 0),
                  hint
                }
              ]
            }));
          }
          if (payload.event === "done") {
            const out = payload.output as Record<string, unknown> | undefined;
            const final = out?.final as Record<string, unknown> | undefined;
            assistantText = String(
              out?.summary ??
                out?.answer ??
                final?.answer ??
                final?.summary ??
                (typeof out === "object" && out && Object.keys(out).length ? JSON.stringify(out, null, 2) : "")
            );
            patchLastRound((r) => ({ ...r, finalText: assistantText }));
          }
        }
      }
    } catch {
      patchLastRound((r) => ({
        ...r,
        finalText: r.finalText || "流式执行失败，请检查后端日志与网络"
      }));
      onRunEvent?.({ event: "failed" });
    } finally {
      setLoading(false);
    }
  }

  // 中文注释：拖拽标题栏自由移动窗口
  function onTitleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest(".chat-panel-root") as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const currentX = pos.x >= 0 ? pos.x : window.innerWidth - rect.width - 20;
    const currentY = pos.y >= 0 ? pos.y : window.innerHeight - rect.height - 20;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: currentX, origY: currentY };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 100, dragRef.current.origY + dy)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const lastRoundId = rounds.length ? rounds[rounds.length - 1].id : null;

  // 中文注释：最小化态——悬浮气泡按钮
  if (minimized) {
    return (
      <Tooltip title="展开 Chat 测试窗口">
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<MessageOutlined />}
          onClick={() => setMinimized(false)}
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 20,
            width: 48,
            height: 48,
            boxShadow: "0 4px 16px rgba(0,0,0,.18)",
          }}
        />
      </Tooltip>
    );
  }

  const posStyle: React.CSSProperties =
    pos.x >= 0 && pos.y >= 0
      ? { position: "fixed", left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
      : { position: "fixed", right: 20, bottom: 20 };

  return (
    <Card
      className="chat-panel-root"
      title={
        <div
          style={{ cursor: "grab", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
          onMouseDown={onTitleMouseDown}
        >
          <Space>
            <span>Chat 测试</span>
            <Tag color="blue" style={{ margin: 0 }}>SSE</Tag>
          </Space>
          <Tooltip title="最小化为气泡">
            <Button
              type="text"
              size="small"
              icon={<MinusOutlined />}
              onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
              style={{ marginRight: -8 }}
            />
          </Tooltip>
        </div>
      }
      size="small"
      style={{
        ...posStyle,
        width: 400,
        zIndex: 20,
        boxShadow: "0 10px 30px rgba(0,0,0,.12)"
      }}
      styles={{ body: { padding: 10, display: "flex", flexDirection: "column", maxHeight: "min(72vh, 560px)" } }}
    >
      <div style={{ flex: 1, minHeight: 120, overflow: "auto", marginBottom: 8 }}>
        {rounds.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            发送消息后将先展示本轮助手回复，下方折叠区为节点执行轨迹。
          </Typography.Text>
        ) : (
          rounds.map((round) => {
            const isLatest = round.id === lastRoundId;
            const showSpinner = loading && isLatest && !round.finalText;
            return (
              <div key={round.id} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color="geekblue">用户</Tag>
                  <Typography.Text style={{ fontSize: 13 }}>{round.userText}</Typography.Text>
                </div>
                <div
                  style={{
                    border: "1px solid #1677ff",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "linear-gradient(180deg, #f0f7ff 0%, #ffffff 40%)"
                  }}
                >
                  <Typography.Text strong style={{ fontSize: 12, color: "#0958d9" }}>
                    助手输出
                  </Typography.Text>
                  <div style={{ marginTop: 8, minHeight: 36 }}>
                    {showSpinner ? (
                      <Spin size="small" tip="生成中…" />
                    ) : (
                      <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.55 }}>
                        {round.finalText || (isLatest ? "等待结果…" : "—")}
                      </Typography.Paragraph>
                    )}
                  </div>
                </div>
                {round.traces.length > 0 ? (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: 8 }}
                    defaultActiveKey={isLatest ? ["trace"] : []}
                    items={[
                      {
                        key: "trace",
                        label: (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            节点执行轨迹（{round.traces.length} 条）
                          </Typography.Text>
                        ),
                        children: (
                          <div
                            style={{
                              fontSize: 11,
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                              color: "#595959",
                              lineHeight: 1.6,
                              background: "#fafafa",
                              borderRadius: 6,
                              padding: "8px 10px",
                              border: "1px solid #f0f0f0"
                            }}
                          >
                            {round.traces.map((t) => (
                              <div key={t.key}>
                                {t.phase === "trace" ? (
                                  <>
                                    <Typography.Text style={{ color: "#722ed1" }}>⎋ trace</Typography.Text>{" "}
                                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                      {t.nodeType}
                                    </Typography.Text>
                                    {t.nodeId ? (
                                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                        {" "}@{t.nodeId}
                                      </Typography.Text>
                                    ) : null}
                                    {t.hint ? (
                                      <div style={{ color: "#595959", marginTop: 2 }}>{t.hint}</div>
                                    ) : null}
                                  </>
                                ) : (
                                  <>
                                    {t.phase === "start" ? "▸ 开始" : "■ 结束"} {t.nodeId}{" "}
                                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                      ({t.nodeType})
                                    </Typography.Text>
                                    {t.durationMs != null && t.phase === "end" ? (
                                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                        {" "}{t.durationMs}ms
                                      </Typography.Text>
                                    ) : null}
                                    {t.hint ? (
                                      <div style={{ color: "#8c8c8c", marginLeft: 8 }}>{t.hint}</div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      }
                    ]}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <Input.Search
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onSearch={() => void send()}
        enterButton={loading ? "执行中..." : "发送"}
        loading={loading}
        placeholder="输入消息，触发 Trigger 节点"
      />
      <Button style={{ marginTop: 8 }} block onClick={() => setRounds([])}>
        清空
      </Button>
    </Card>
  );
}
