import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExpandOutlined } from "@ant-design/icons";
import { Button, Collapse, Input, Modal, Popover, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import type { RunLogItem, WorkflowEdge, WorkflowNode } from "../../types/workflow";
import {
  buildKnownPathsSet,
  buildVariableIndex,
  validateTemplateAgainstIndex,
  validateTemplatePathsDetailed
} from "../../utils/templateIndex";
import { buildPreviewContext, previewTemplateTokens, previewVariablePathValue } from "../../utils/templatePreview";
import { useNodeTypeSpecs } from "../../store/nodeTypeSpecStore";

type Props = {
  value: string;
  onChange: (next: string) => void;
  nodes: WorkflowNode[];
  logs: RunLogItem[];
  currentNodeId?: string;
  edges?: WorkflowEdge[];
  minRows?: number;
  maxRows?: number;
  placeholder?: string;
  /**
   * UI 变体：
   * - `default`：保留变量树/快捷插入/值预览等工具栏（用于通用模板编辑）
   * - `none`：仅保留编辑器本体（用于“系统提示词”侧栏精简）
   */
  toolbarMode?: "default" | "none";
  /** 是否显示 `{{...}}` 触发补全的简短提示文案 */
  showCompletionHint?: boolean;
  /** 是否显示 token 值预览 Collapse（上次运行） */
  showTokenPreviews?: boolean;
  /** 是否显示模板变量引用胶囊 */
  showVarPills?: boolean;
  /** 显示「放大编辑」打开全屏宽 Modal，适合 Agent / LLM 长 Prompt */
  expandable?: boolean;
  expandTitle?: string;
};

/** 从模板字符串中提取 {{ path }} 路径，用于胶囊展示 */
function extractTemplateVarPaths(s: string): string[] {
  const out: string[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const inner = m[1].trim();
    if (inner) out.push(inner);
  }
  return [...new Set(out)];
}

/**
 * 模板输入：变量树插入 + 失焦校验 + {{ 触发式行内自动补全。
 * 输入 {{ 后自动弹出变量路径列表，支持键盘上下选择、回车/点击插入。
 */
export function TemplateInput({
  value,
  onChange,
  nodes,
  logs,
  currentNodeId,
  edges,
  minRows = 2,
  maxRows = 6,
  placeholder,
  toolbarMode = "default",
  showCompletionHint = true,
  showTokenPreviews = true,
  showVarPills = true,
  expandable = false,
  expandTitle = "编辑模板"
}: Props) {
  const [expandOpen, setExpandOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(0);
  const [acFilter, setAcFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const acContainerRef = useRef<HTMLDivElement>(null);
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const { specs } = useNodeTypeSpecs();

  const outputSchemas = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const s of specs) {
      if (s.output_schema && Object.keys(s.output_schema).length > 0) {
        m[s.type] = s.output_schema as Record<string, string>;
      }
    }
    return m;
  }, [specs]);

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
    () => buildVariableIndex(nodes, lastRunOutputs, { currentNodeId, edges, outputSchemas }),
    [nodes, lastRunOutputs, currentNodeId, edges, outputSchemas]
  );
  const known = useMemo(() => buildKnownPathsSet(nodes, logs.filter((l) => l.id >= 0)), [nodes, logs]);

  const issuesStructural = useMemo(() => validateTemplateAgainstIndex(value, nodeIds), [value, nodeIds]);
  const issuesPaths = useMemo(() => (touched ? validateTemplatePathsDetailed(value, known) : []), [value, known, touched]);
  const issues = [...issuesStructural, ...issuesPaths];

  const previewCtx = useMemo(() => buildPreviewContext(nodes, logs), [nodes, logs]);
  const tokenPreviews = useMemo(() => previewTemplateTokens(value, previewCtx), [value, previewCtx]);
  const varPathsForPills = useMemo(() => extractTemplateVarPaths(String(value ?? "")), [value]);

  // 中文注释：将变量索引树扁平化为自动补全候选列表
  const flatPaths = useMemo(() => {
    const out: { path: string; label: string }[] = [];
    for (const g of index.groups) {
      for (const leaf of g.leaves) {
        out.push({ path: leaf.path, label: `${g.title} / ${leaf.label}` });
      }
    }
    return out;
  }, [index.groups]);

  const filteredAc = useMemo(() => {
    if (!acFilter) return flatPaths;
    const q = acFilter.toLowerCase();
    return flatPaths.filter((p) => p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q));
  }, [flatPaths, acFilter]);

  useEffect(() => {
    setAcIdx(0);
  }, [filteredAc.length]);

  const treeData: DataNode[] = useMemo(
    () =>
      index.groups.map((g, gi) => ({
        key: `g-${gi}`,
        title: g.title,
        selectable: false,
        children: g.leaves.map((leaf) => {
          const hint = previewVariablePathValue(leaf.path, nodes, logs, 100);
          return {
            key: `path:${leaf.path}`,
            title: (
              <div style={{ lineHeight: 1.35 }}>
                <div>{leaf.label}</div>
                <div style={{ fontSize: 11, color: "#595959" }}>{`{{${leaf.path}}}`}</div>
                <div style={{ fontSize: 10, color: "#8c8c8c" }} title={hint}>
                  {hint}
                </div>
              </div>
            ),
            isLeaf: true
          };
        })
      })),
    [index.groups, nodes, logs]
  );

  function insertPath(path: string) {
    const snippet = `{{${path}}}`;
    const v = String(value ?? "");
    const sep = v && !v.endsWith(" ") && !v.endsWith("\n") ? " " : "";
    onChange(`${v}${sep}${snippet}`);
  }

  // 中文注释：在光标位置替换 {{ + 过滤词为完整变量引用
  const insertAtCursor = useCallback(
    (path: string) => {
      const ta = textareaRef.current;
      const v = String(value ?? "");
      if (!ta) {
        insertPath(path);
        setAcOpen(false);
        return;
      }
      const cursor = ta.selectionEnd;
      const before = v.slice(0, cursor);
      const after = v.slice(cursor);
      const triggerIdx = before.lastIndexOf("{{");
      if (triggerIdx === -1) {
        insertPath(path);
        setAcOpen(false);
        return;
      }
      const replacement = `{{${path}}}`;
      const newVal = before.slice(0, triggerIdx) + replacement + after;
      onChange(newVal);
      setAcOpen(false);
      setAcFilter("");
      requestAnimationFrame(() => {
        const newCursor = triggerIdx + replacement.length;
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [value, onChange]
  );

  // 中文注释：检测用户输入 {{ 后自动打开补全弹窗
  const handleChange = useCallback(
    (raw: string) => {
      onChange(raw);
      const ta = textareaRef.current;
      if (!ta) return;
      const cursor = ta.selectionEnd;
      const before = raw.slice(0, cursor);
      const triggerIdx = before.lastIndexOf("{{");
      if (triggerIdx === -1 || before.includes("}}", triggerIdx + 2)) {
        setAcOpen(false);
        setAcFilter("");
        return;
      }
      const partial = before.slice(triggerIdx + 2);
      if (partial.includes("\n")) {
        setAcOpen(false);
        return;
      }
      setAcOpen(true);
      setAcFilter(partial);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!acOpen || filteredAc.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIdx((i) => Math.min(i + 1, filteredAc.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertAtCursor(filteredAc[acIdx].path);
      } else if (e.key === "Escape") {
        setAcOpen(false);
      }
    },
    [acOpen, filteredAc, acIdx, insertAtCursor]
  );

  // 滚动自动补全列表以保持活跃项可见
  useEffect(() => {
    if (!acOpen || !acContainerRef.current) return;
    const activeEl = acContainerRef.current.querySelector(".active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }, [acIdx, acOpen]);

  return (
    <div className="template-input-root" style={{ position: "relative" }}>
      {toolbarMode === "default" ? (
        <div
          style={{
            marginBottom: 8,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 11, flex: "1 1 160px", minWidth: 0 }}>
            输入{" "}
            <Typography.Text keyboard style={{ fontSize: 10 }}>
              {"{{"}
            </Typography.Text>{" "}
            触发路径补全
          </Typography.Text>
          <Popover
            title="变量与高级"
            trigger="click"
            placement="bottomLeft"
            content={
              <div style={{ maxWidth: 360, maxHeight: 380, overflow: "auto" }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
                  点击叶子插入变量；第三行为基于上次运行/当前输入的取值预览。
                </Typography.Paragraph>
                <Tree
                  showLine
                  defaultExpandAll
                  treeData={treeData}
                  onSelect={(keys) => {
                    const k = String(keys[0] || "");
                    if (k.startsWith("path:")) insertPath(k.slice("path:".length));
                  }}
                />
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid #f0f0f0",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8
                  }}
                >
                  <Button size="small" onClick={() => insertPath("input.query")}>
                    + input.query
                  </Button>
                  <Button
                    size="small"
                    onClick={() => onChange(`${String(value || "")} {{= coalesce(input.query, input.topic, '') }}`)}
                  >
                    + 兜底表达式
                  </Button>
                  {expandable ? (
                    <Button size="small" icon={<ExpandOutlined />} onClick={() => setExpandOpen(true)}>
                      放大编辑
                    </Button>
                  ) : null}
                </div>
              </div>
            }
          >
            <Button size="small" type="dashed">
              变量与高级
            </Button>
          </Popover>
        </div>
      ) : null}
      {toolbarMode === "none" && showCompletionHint ? (
        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>
          输入{" "}
          <Typography.Text keyboard style={{ fontSize: 10 }}>
            {"{{"}
          </Typography.Text>{" "}
          触发路径补全
        </Typography.Text>
      ) : null}
      <Input.TextArea
        ref={(inst) => {
          textareaRef.current = inst?.resizableTextArea?.textArea ?? null;
        }}
        className="template-input-area"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          setTimeout(() => setAcOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoSize={{ minRows, maxRows }}
        style={issues.length > 0 && touched ? { borderColor: "#ff4d4f", borderRadius: 8 } : { borderRadius: 8 }}
      />

      {showVarPills && varPathsForPills.length > 0 ? (
        <div className="template-var-pills" aria-label="模板中的变量引用">
          {varPathsForPills.map((p) => (
            <span key={p} className="template-var-pill" title={p}>
              {`{{${p}}}`}
            </span>
          ))}
        </div>
      ) : null}

      {/* 中文注释：{{ 触发的行内变量自动补全下拉 */}
      {acOpen && filteredAc.length > 0 ? (
        <div ref={acContainerRef} className="var-autocomplete-dropdown">
          {filteredAc.slice(0, 30).map((item, i) => (
            <div
              key={item.path}
              className={`var-autocomplete-item${i === acIdx ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertAtCursor(item.path);
              }}
              onMouseEnter={() => setAcIdx(i)}
            >
              <span className="var-path">{`{{${item.path}}}`}</span>
              <span className="var-label">{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {touched && issues.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          {issues.slice(0, 6).map((msg) => (
            <Typography.Text key={msg} type="danger" style={{ fontSize: 11, display: "block" }}>
              {msg}
            </Typography.Text>
          ))}
        </div>
      ) : null}
      {showTokenPreviews && tokenPreviews.length > 0 ? (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[
            {
              key: "preview",
              label: (
                <Typography.Text style={{ fontSize: 12 }}>值预览（上次运行）</Typography.Text>
              ),
              children: (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {tokenPreviews.map((row) => (
                    <div
                      key={row.token}
                      style={{
                        borderLeft: `3px solid ${row.ok ? "#52c41a" : "#faad14"}`,
                        paddingLeft: 8,
                        background: "#f8fafc",
                        borderRadius: 8,
                        padding: "6px 8px"
                      }}
                    >
                      <span className="template-var-pill" style={{ fontSize: 10 }}>
                        {`{{${row.token}}}`}
                      </span>
                      <Typography.Paragraph
                        style={{ margin: "4px 0 0", fontSize: 11, marginBottom: 0, wordBreak: "break-all" }}
                        type={row.ok ? undefined : "secondary"}
                      >
                        {row.preview}
                      </Typography.Paragraph>
                    </div>
                  ))}
                </div>
              )
            }
          ]}
        />
      ) : null}

      <Modal
        title={expandTitle}
        open={expandOpen}
        onCancel={() => setExpandOpen(false)}
        footer={null}
        width="90%"
        rootClassName="template-expand-modal-root"
        destroyOnClose={false}
        styles={{
          body: { maxHeight: "min(78vh, 680px)", overflowY: "auto", paddingTop: 12 }
        }}
      >
        <TemplateInput
          value={value}
          onChange={onChange}
          nodes={nodes}
          logs={logs}
          currentNodeId={currentNodeId}
          edges={edges}
          minRows={14}
          maxRows={24}
          placeholder={placeholder}
          expandable={false}
        />
      </Modal>
    </div>
  );
}
