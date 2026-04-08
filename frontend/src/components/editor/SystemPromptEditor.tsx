import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  ApiOutlined,
  BranchesOutlined,
  MinusOutlined,
  NodeIndexOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined
} from "@ant-design/icons";
import { Button, Collapse, Modal, Space, Tag, Tooltip, Typography } from "antd";
import type { RunLogItem, WorkflowEdge, WorkflowNode } from "../../types/workflow";
import { buildVariableIndex } from "../../utils/templateIndex";
import { previewVariablePathValue } from "../../utils/templatePreview";
import { TemplateInput } from "./TemplateInput";

type Props = {
  title?: string;
  value: string;
  onChange: (next: string) => void;
  nodes: WorkflowNode[];
  logs: RunLogItem[];
  currentNodeId?: string;
  edges?: WorkflowEdge[];
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
};

function appendSnippet(current: string, snippet: string): string {
  const t = String(current ?? "");
  if (!t.trim()) return snippet;
  if (t.endsWith(snippet)) return t;
  const sep = t.endsWith("\n") || t.endsWith(" ") ? "" : " ";
  return `${t}${sep}${snippet}`;
}

function HighlightedPromptTextarea({
  value,
  onChange,
  placeholder,
  textareaRef,
  minHeight
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  minHeight?: number;
}) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });

  const tokenRe = useMemo(() => /\{\{([^}]+)\}\}/g, []);

  const overlayContent = useMemo(() => {
    const s = String(value ?? "");
    const safePlaceholder = placeholder || "";

    if (!s) {
      return (
        <span style={{ color: "#bfbfbf" }}>{safePlaceholder}</span>
      );
    }

    const nodes: ReactNode[] = [];
    let last = 0;
    for (const m of s.matchAll(tokenRe)) {
      const idx = m.index ?? 0;
      const token = m[0] || "";
      if (idx > last) nodes.push(<span key={`t-${last}`}>{s.slice(last, idx)}</span>);
      nodes.push(
        <span key={`tok-${idx}`} className="token-highlight">
          {token}
        </span>
      );
      last = idx + token.length;
    }
    if (last < s.length) nodes.push(<span key={`tail-${last}`}>{s.slice(last)}</span>);
    return nodes;
  }, [placeholder, tokenRe, value]);

  return (
    <div style={{ position: "relative", border: "1px solid #d9d9d9", borderRadius: 8, overflow: "hidden", background: "#fff", height: "100%" }}>
      <div
        className="prompt-ide-overlay"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          padding: "10px 12px",
          pointerEvents: "none"
        }}
      >
        <div
          style={{
            transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: 1.6
          }}
        >
          {overlayContent}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        onScroll={(e) => {
          const t = e.currentTarget.scrollTop;
          const l = e.currentTarget.scrollLeft;
          setScroll((prev) => (prev.top === t && prev.left === l ? prev : { top: t, left: l }));
        }}
        style={{
          position: "relative",
          width: "100%",
          minHeight,
          height: "100%",
          resize: "none",
          padding: "10px 12px",
          border: 0,
          outline: "none",
          background: "transparent",
          color: "transparent",
          caretColor: "#595959",
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.6
        }}
      />
    </div>
  );
}

export function SystemPromptEditor({
  title = "系统提示词",
  value,
  onChange,
  nodes,
  logs,
  currentNodeId,
  edges,
  placeholder,
  minRows = 3,
  maxRows = 6
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [treeZoom, setTreeZoom] = useState(1);

  const lastRunOutputs = useMemo(() => {
    const m: Record<string, Record<string, unknown>> = {};
    for (const log of logs) {
      if (log.id < 0) m[log.node_id] = (log.output || {}) as Record<string, unknown>;
    }
    for (const log of logs) {
      if (log.id >= 0 && log.status !== "failed") m[log.node_id] = (log.output || {}) as Record<string, unknown>;
    }
    return m;
  }, [logs]);

  const index = useMemo(
    // 中文注释：高级编辑变量树只使用“当前真实数据”（运行输出+全局变量+输入），不混入静态 schema 猜测字段
    () => buildVariableIndex(nodes, lastRunOutputs, { currentNodeId, edges }),
    [nodes, lastRunOutputs, currentNodeId, edges]
  );

  const upstreamIds = useMemo(() => {
    if (!currentNodeId || !edges || edges.length === 0) return new Set<string>();
    const rev = new Map<string, string[]>();
    for (const e of edges) {
      const arr = rev.get(e.target) || [];
      arr.push(e.source);
      rev.set(e.target, arr);
    }
    const seen = new Set<string>();
    const stack = [currentNodeId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const prev = rev.get(cur) || [];
      for (const p of prev) {
        if (seen.has(p)) continue;
        seen.add(p);
        stack.push(p);
      }
    }
    return seen;
  }, [currentNodeId, edges]);

  const nodeMeta = useMemo(() => {
    const m = new Map<string, { label: string; type: string }>();
    for (const n of nodes) {
      m.set(n.id, {
        label: String(n.data?.label || n.type || n.id),
        type: n.type
      });
    }
    return m;
  }, [nodes]);

  const nodeTypeIcon = useCallback((t: string) => {
    if (t === "trigger" || t === "start") return <PlayCircleOutlined />;
    if (t === "agent" || t === "llm" || t === "llm_compare") return <RobotOutlined />;
    if (t === "tool" || t === "baidu_search") return <SearchOutlined />;
    if (t === "knowledge_retrieve") return <ApiOutlined />;
    return <NodeIndexOutlined />;
  }, []);

  const variableSections = useMemo(() => {
    type Row = {
      path: string;
      fieldLabel: string;
      preview: string;
      nodeId: string;
      nodeLabel: string;
      nodeType: string;
    };
    type Bucket = Record<string, { nodeLabel: string; nodeType: string; rows: Row[] }>;
    const input: Bucket = {};
    const upstream: Bucket = {};
    const library: Bucket = {};

    const pushRow = (bucket: Bucket, row: Row) => {
      if (!bucket[row.nodeId]) {
        bucket[row.nodeId] = { nodeLabel: row.nodeLabel, nodeType: row.nodeType, rows: [] };
      }
      bucket[row.nodeId].rows.push(row);
    };

    for (const g of index.groups) {
      for (const leaf of g.leaves) {
        const p = leaf.path;
        if (p.startsWith("env.")) continue; // 去除环境（仅服务端解析）变量
        const preview = previewVariablePathValue(p, nodes, logs, 96);
        if (p.startsWith("input.")) {
          pushRow(input, {
            path: p,
            fieldLabel: leaf.label,
            preview,
            nodeId: "input",
            nodeLabel: "输入参数",
            nodeType: "input"
          });
          continue;
        }
        if (p.startsWith("nodes.")) {
          const nodeId = p.split(".")[1] || "unknown";
          const outputKey = p.split(".")[3];
          if (!outputKey || !(outputKey in (lastRunOutputs[nodeId] || {}))) {
            continue;
          }
          const meta = nodeMeta.get(nodeId);
          const row: Row = {
            path: p,
            fieldLabel: leaf.label,
            preview,
            nodeId,
            nodeLabel: meta?.label || nodeId,
            nodeType: meta?.type || "node"
          };
          if (upstreamIds.has(nodeId)) pushRow(upstream, row);
          else pushRow(library, row);
          continue;
        }
        pushRow(library, {
          path: p,
          fieldLabel: leaf.label,
          preview,
          nodeId: p.split(".")[0] || "other",
          nodeLabel: g.title || "其他变量",
          nodeType: "other"
        });
      }
    }
    return { input, upstream, library };
  }, [index.groups, lastRunOutputs, logs, nodeMeta, nodes, upstreamIds]);

  const advancedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertAtCursor = useCallback(
    (snippet: string) => {
      const ta = advancedTextareaRef.current;
      const beforeValue = String(value ?? "");
      if (!ta) {
        onChange(appendSnippet(beforeValue, snippet));
        return;
      }

      const start = ta.selectionStart ?? beforeValue.length;
      const end = ta.selectionEnd ?? beforeValue.length;
      const before = beforeValue.slice(0, start);
      const after = beforeValue.slice(end);
      const next = before + snippet + after;
      onChange(next);

      requestAnimationFrame(() => {
        const pos = before.length + snippet.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    },
    [onChange, value]
  );

  useEffect(() => {
    if (!advancedOpen) return;
    // 中文注释：高级编辑打开后，把焦点放到编辑器中，便于立刻键入/插入变量
    requestAnimationFrame(() => {
      advancedTextareaRef.current?.focus();
      const ta = advancedTextareaRef.current;
      if (ta) {
        const pos = String(value ?? "").length;
        ta.setSelectionRange(pos, pos);
      }
    });
  }, [advancedOpen, value]);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        {title ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {title}
          </Typography.Text>
        ) : null}
        <Button size="small" type="primary" ghost onClick={() => setAdvancedOpen(true)}>
          高级编辑
        </Button>
      </div>

      {/* 紧凑侧栏：只保留文本域 + 最基本快捷插入 */}
      <TemplateInput
        value={value}
        onChange={onChange}
        nodes={nodes}
        logs={logs}
        currentNodeId={currentNodeId}
        edges={edges}
        minRows={minRows}
        maxRows={maxRows}
        placeholder={placeholder}
        toolbarMode="none"
        showCompletionHint={false}
        showTokenPreviews={false}
        showVarPills={false}
        expandable={false}
      />
      <Space size={8} wrap style={{ marginTop: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          快速插入
        </Typography.Text>
        <Button size="small" type="dashed" onClick={() => onChange(appendSnippet(String(value ?? ""), "{{input.query}}"))}>
          {"{{input.query}}"}
        </Button>
      </Space>

      {/* 高级编辑：左变量树 + 右高亮编辑器 + 底部快捷插件栏 */}
      <Modal
        title="高级提示词编辑器"
        open={advancedOpen}
        onCancel={() => setAdvancedOpen(false)}
        footer={null}
        width="96vw"
        styles={{
          body: { paddingTop: 12, height: "calc(100vh - 150px)", overflow: "hidden" }
        }}
        destroyOnClose
      >
        <div style={{ height: "100%", display: "flex", gap: 12, minHeight: 0 }}>
          <div style={{ width: 340, minWidth: 280, borderRight: "1px solid #f0f0f0", overflow: "auto", paddingRight: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                变量树（实时）
              </Typography.Text>
              <Space size={4}>
                <Button
                  size="small"
                  icon={<MinusOutlined />}
                  onClick={() => setTreeZoom((z) => Math.max(0.85, Number((z - 0.1).toFixed(2))))}
                />
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setTreeZoom((z) => Math.min(1.35, Number((z + 0.1).toFixed(2))))}
                />
              </Space>
            </div>
            <Collapse
              style={{ zoom: treeZoom as any }}
              size="small"
              defaultActiveKey={["input", "upstream", "library"]}
              items={[
                {
                  key: "input",
                  label: (
                    <Space>
                      <Tag color="default">输入参数</Tag>
                    </Space>
                  ),
                  children: Object.entries(variableSections.input).map(([nodeId, block]) => (
                    <div key={nodeId} style={{ marginBottom: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#1F2937", marginBottom: 6 }}>
                        <Space size={6}>
                          <PlayCircleOutlined />
                          <span>{block.nodeLabel}</span>
                        </Space>
                      </div>
                      {block.rows.map((row) => {
                        const hovered = hoverPath === row.path;
                        return (
                          <Tooltip
                            key={row.path}
                            title={
                              <div>
                                <div>点击插入</div>
                                <div>{`{{${row.path}}}`}</div>
                              </div>
                            }
                          >
                            <div
                              onMouseEnter={() => setHoverPath(row.path)}
                              onMouseLeave={() => setHoverPath((prev) => (prev === row.path ? null : prev))}
                              onClick={() => insertAtCursor(`{{${row.path}}}`)}
                              style={{
                                background: hovered ? "#EFF6FF" : "#F9FAFB",
                                border: hovered ? "1px solid #93C5FD" : "1px solid #e5e7eb",
                                borderRadius: 4,
                                padding: "8px 10px",
                                marginBottom: 6,
                                cursor: "pointer"
                              }}
                            >
                              <div style={{ color: "#2563EB", fontSize: 12, fontWeight: 600 }}>{row.fieldLabel}</div>
                              <div style={{ color: "#6B7280", fontSize: 11 }}>{`值: ${row.preview || "----"}`}</div>
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ))
                },
                {
                  key: "upstream",
                  label: <Tag color="processing">已连节点输出</Tag>,
                  children: Object.entries(variableSections.upstream).map(([nodeId, block]) => (
                    <div key={nodeId} style={{ marginBottom: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#1F2937", marginBottom: 6 }}>
                        <Space size={6}>
                          {nodeTypeIcon(block.nodeType)}
                          <span>{block.nodeLabel}</span>
                        </Space>
                      </div>
                      {block.rows.map((row) => {
                        const hovered = hoverPath === row.path;
                        return (
                          <Tooltip
                            key={row.path}
                            title={
                              <div>
                                <div>点击插入</div>
                                <div>{`{{${row.path}}}`}</div>
                              </div>
                            }
                          >
                            <div
                              onMouseEnter={() => setHoverPath(row.path)}
                              onMouseLeave={() => setHoverPath((prev) => (prev === row.path ? null : prev))}
                              onClick={() => insertAtCursor(`{{${row.path}}}`)}
                              style={{
                                background: hovered ? "#EFF6FF" : "#F9FAFB",
                                border: hovered ? "1px solid #93C5FD" : "1px solid #e5e7eb",
                                borderRadius: 4,
                                padding: "8px 10px",
                                marginBottom: 6,
                                cursor: "pointer"
                              }}
                            >
                              <div style={{ color: "#2563EB", fontSize: 12, fontWeight: 600 }}>{row.fieldLabel}</div>
                              <div style={{ color: "#6B7280", fontSize: 11 }}>{`值: ${row.preview || "----"}`}</div>
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ))
                },
                {
                  key: "library",
                  label: <Tag color="purple">其他节点</Tag>,
                  children: Object.entries(variableSections.library).map(([nodeId, block]) => (
                    <div key={nodeId} style={{ marginBottom: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#1F2937", marginBottom: 6 }}>
                        <Space size={6}>
                          {block.nodeType === "other" ? <BranchesOutlined /> : nodeTypeIcon(block.nodeType)}
                          <span>{block.nodeLabel}</span>
                        </Space>
                      </div>
                      {block.rows.map((row) => {
                        const hovered = hoverPath === row.path;
                        return (
                          <Tooltip
                            key={row.path}
                            title={
                              <div>
                                <div>点击插入</div>
                                <div>{`{{${row.path}}}`}</div>
                              </div>
                            }
                          >
                            <div
                              onMouseEnter={() => setHoverPath(row.path)}
                              onMouseLeave={() => setHoverPath((prev) => (prev === row.path ? null : prev))}
                              onClick={() => insertAtCursor(`{{${row.path}}}`)}
                              style={{
                                background: hovered ? "#EFF6FF" : "#F9FAFB",
                                border: hovered ? "1px solid #93C5FD" : "1px solid #e5e7eb",
                                borderRadius: 4,
                                padding: "8px 10px",
                                marginBottom: 6,
                                cursor: "pointer"
                              }}
                            >
                              <div style={{ color: "#2563EB", fontSize: 12, fontWeight: 600 }}>{row.fieldLabel}</div>
                              <div style={{ color: "#6B7280", fontSize: 11 }}>{`值: ${row.preview || "----"}`}</div>
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ))
                }
              ]}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <HighlightedPromptTextarea
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                textareaRef={advancedTextareaRef}
                minHeight={280}
              />
            </div>

            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 10, marginTop: 10 }}>
              <Space size={8} wrap>
                <Button size="small" type="dashed" onClick={() => insertAtCursor("{{input.query}}")}>
                  快速 {"{{input.query}}"}
                </Button>
                <Button size="small" type="dashed" onClick={() => insertAtCursor("{{input.topic}}")}>
                  快速 {"{{input.topic}}"}
                </Button>
                <Button size="small" onClick={() => insertAtCursor("{{input.query}}")}>
                  +query
                </Button>
                <Button
                  size="small"
                  onClick={() => insertAtCursor("{{= coalesce(input.query, input.topic, '') }}")}
                >
                  +完整（兜底表达式）
                </Button>
              </Space>
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 11 }}>
                点击左侧树叶子将占位符插入到编辑器当前光标位置
              </Typography.Text>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

