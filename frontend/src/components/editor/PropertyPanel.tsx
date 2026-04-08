import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BugOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Input, message, Select, Slider, Space, Switch, Tooltip, Typography } from "antd";
import { debugWorkflowStep } from "../../api/client";
import { useRunObservationStore } from "../../store/runObservationStore";
import { useWorkflowStore } from "../../store/workflowStore";
import { useNodeTypeSpecs } from "../../store/nodeTypeSpecStore";
import { DEFAULT_LLM_MODEL } from "../../utils/nodeDefaults";
import { KnowledgeBasePicker } from "./KnowledgeBasePicker";
import { TemplateInput } from "./TemplateInput";
import { McpParamsEditor } from "./McpParamsEditor";
import { SystemPromptEditor } from "./SystemPromptEditor";

/**
 * 单节点测试与数据血缘展示；底部操作区与删除并列，减少视觉抢占。
 */
function NodeTestAndLineage({
  nodeId,
  nodeType,
  onDelete
}: {
  nodeId: string;
  nodeType: string;
  onDelete: () => void;
}) {
  const { workflowId, nodes, edges } = useWorkflowStore();
  const logs = useRunObservationStore((s) => s.logs);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // 中文注释：从最近运行日志获取当前节点的血缘数据（输入来源、输出摘要、耗时）
  const lineage = useMemo(() => {
    const log = [...logs].reverse().find((l) => l.node_id === nodeId);
    if (!log) return null;
    return {
      status: log.status,
      duration_ms: log.duration_ms,
      outputKeys: Object.keys(log.output || {}),
      outputPreview: JSON.stringify(log.output || {}).slice(0, 200),
    };
  }, [logs, nodeId]);

  async function onTest() {
    if (!workflowId) {
      message.warning("请先保存工作流");
      return;
    }
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      // 中文注释：收集已有上游 vars 快照，从最近日志中构建
      const varsFromLogs: Record<string, unknown> = {};
      for (const log of logs) {
        if (log.output && log.node_id !== nodeId) {
          varsFromLogs[log.node_id] = log.output;
        }
      }
      // 找到本节点在图中的前驱节点列表
      const predecessors = edges
        .filter((e) => e.target === nodeId)
        .map((e) => e.source);
      // 如果有前驱节点，以最后一个前驱作为 last_node_id
      const lastNodeId = predecessors.length > 0 ? predecessors[predecessors.length - 1] : null;
      // 如果本节点是入口节点（trigger/start），直接以 null 开始
      const isEntry = nodeType === "trigger" || nodeType === "start" || nodeType === "global";
      const result = await debugWorkflowStep(workflowId, {
        input: { query: "" },
        vars: varsFromLogs,
        last_node_id: isEntry ? null : lastNodeId,
      });
      if (result.output) {
        setTestResult(result.output);
        // 中文注释：写入观测 store，供变量预览使用
        useRunObservationStore.getState().appendLiveNodeEnd({
          node_id: result.node_id || nodeId,
          node_type: result.node_type || nodeType,
          input: {},
          output: result.output as Record<string, unknown>,
          duration_ms: 0,
        });
        message.success(`节点 ${result.node_id || nodeId} 测试完成`);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || "测试失败";
      setTestError(String(detail));
      message.error(`节点测试失败: ${detail}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Space direction="vertical" style={{ width: "100%" }} size={10}>
        {lineage ? (
          <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px", fontSize: 11 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              最近运行
            </Typography.Text>
            <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {lineage.status === "success" ? (
                <CheckCircleOutlined style={{ color: "#52c41a" }} />
              ) : lineage.status === "failed" ? (
                <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
              ) : null}
              <span>{lineage.duration_ms}ms</span>
              <span style={{ color: "#cbd5e1" }}>|</span>
              <span>{lineage.outputKeys.slice(0, 4).join(", ") || "—"}{lineage.outputKeys.length > 4 ? "…" : ""}</span>
            </div>
          </div>
        ) : null}

        {testError ? (
          <Alert type="error" showIcon message="测试失败" description={testError} closable onClose={() => setTestError(null)} />
        ) : null}

        {testResult ? (
          <Collapse
            size="small"
            defaultActiveKey={["test-output"]}
            items={[{
              key: "test-output",
              label: <Typography.Text style={{ fontSize: 12 }}><CheckCircleOutlined style={{ color: "#52c41a", marginRight: 4 }} />输出</Typography.Text>,
              children: (
                <pre style={{ fontSize: 11, maxHeight: 160, overflow: "auto", background: "#fafafa", padding: 8, borderRadius: 8, margin: 0 }}>
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )
            }]}
          />
        ) : null}

        <div className="property-panel-actions">
          <Tooltip title="使用当前配置与上游快照单独执行此节点">
            <Button size="small" icon={testing ? <LoadingOutlined /> : <BugOutlined />} onClick={onTest} loading={testing}>
              测试节点
            </Button>
          </Tooltip>
          <Typography.Link type="danger" onClick={onDelete} style={{ fontSize: 13 }}>
            删除节点
          </Typography.Link>
        </div>
      </Space>
    </div>
  );
}

/** 在模板字符串末尾追加变量，便于拼接多段 */
function appendTemplateVar(current: string, snippet: string) {
  const t = String(current ?? "");
  if (!t.trim()) return snippet;
  if (t.endsWith(snippet)) return t;
  const sep = t.endsWith("\n") || t.endsWith(" ") ? "" : " ";
  return `${t}${sep}${snippet}`;
}

const TEMPLATE_VARS = [{ snippet: "{{input.query}}", label: "query" }] as const;

function TemplateVarChips({ onInsert }: { onInsert: (snippet: string) => void }) {
  return (
    <Space size={[6, 6]} wrap align="center" style={{ marginBottom: 4 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        快速插入
      </Typography.Text>
      {TEMPLATE_VARS.map(({ snippet, label }) => (
        <Button key={snippet} size="small" type="dashed" onClick={() => onInsert(snippet)}>
          {`{{input.${label}}}`}
        </Button>
      ))}
    </Space>
  );
}

export function PropertyPanel() {
  const { selectedNodeId, selectionNodeIds, nodes, edges, updateNodeData, deleteNode } = useWorkflowStore();
  const templateLogs = useRunObservationStore((s) => s.logs);
  const { mcpTools, fetch: fetchSpecs } = useNodeTypeSpecs();
  const [globalKeyDraft, setGlobalKeyDraft] = useState("");
  const [globalValueDraft, setGlobalValueDraft] = useState("");
  const [endMapKeyDraft, setEndMapKeyDraft] = useState("");
  const [setFieldsKeyDraft, setSetFieldsKeyDraft] = useState("");
  const [httpHeaderKeyDraft, setHttpHeaderKeyDraft] = useState("");
  const node = useMemo(() => nodes.find((item) => item.id === selectedNodeId), [nodes, selectedNodeId]);

  useEffect(() => { void fetchSpecs(); }, [fetchSpecs]);

  // 所有 TemplateInput 共享的拓扑 props
  const templateProps = useMemo(
    () => ({ nodes, logs: templateLogs, currentNodeId: node?.id, edges }),
    [nodes, templateLogs, node?.id, edges]
  );

  return (
    <div style={{ background: "#fff", overflow: "auto", minHeight: 0 }}>
      {!node ? (
        <Card size="small" title="节点属性" variant="borderless">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            在<strong>画布上单击</strong>节点即可在此处编辑配置；也可使用{" "}
            <Typography.Text keyboard>Ctrl / ⌘ + K</Typography.Text> 搜索添加节点。
          </Typography.Paragraph>
        </Card>
      ) : (
        <Card size="small" title="节点配置" variant="borderless">
          <Space direction="vertical" style={{ width: "100%" }}>
          {selectionNodeIds.length > 1 ? (
            <Alert
              type="info"
              showIcon
              message={`已选中 ${selectionNodeIds.length} 个节点`}
              description="下方表单仅编辑主选中的节点；批量删除请在画布控件栏使用删除或按 Delete 键。"
              style={{ marginBottom: 8 }}
            />
          ) : null}
          <Typography.Text type="secondary">节点 ID: {node.id}（在此配置参数，预览请切换到右下「参数预览」）</Typography.Text>
          <Input
            value={String(node.data.label ?? "")}
            onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
            placeholder="节点展示名"
          />

          {/* ====== LLM ====== */}
          {node.type === "llm" ? (
            <Collapse
              size="small"
              defaultActiveKey={["llm-core", "llm-prompt"]}
              items={[
                {
                  key: "llm-core",
                  label: "模型与采样",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Input
                        value={String(node.data.model_name ?? node.data.model ?? DEFAULT_LLM_MODEL)}
                        onChange={(e) => updateNodeData(node.id, { model_name: e.target.value, model: e.target.value })}
                        placeholder={`模型名，默认 ${DEFAULT_LLM_MODEL}`}
                      />
                      <div>
                        <Typography.Text type="secondary">
                          Temperature: {Number(node.data.temperature ?? 0.2).toFixed(1)}
                        </Typography.Text>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={Number(node.data.temperature ?? 0.2)}
                          onChange={(v) => updateNodeData(node.id, { temperature: v })}
                        />
                      </div>
                    </Space>
                  )
                },
                {
                  key: "llm-prompt",
                  label: "提示词模板",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        快速插入（用户提示模板）
                      </Typography.Text>
                      <TemplateVarChips
                        onInsert={(snippet) =>
                          updateNodeData(node.id, {
                            user_prompt: appendTemplateVar(String(node.data.user_prompt ?? ""), snippet)
                          })
                        }
                      />
                      <SystemPromptEditor
                        {...templateProps}
                        value={String(node.data.system_prompt ?? "")}
                        onChange={(v) => updateNodeData(node.id, { system_prompt: v })}
                        placeholder="系统提示词"
                        minRows={2}
                        maxRows={5}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        用户提示模板
                      </Typography.Text>
                      <TemplateInput
                        {...templateProps}
                        value={String(node.data.user_prompt ?? "{{input.query}}")}
                        onChange={(v) => updateNodeData(node.id, { user_prompt: v })}
                        placeholder="例如 {{input.query}} 或 {{nodes.xxx.output.message}}"
                        minRows={2}
                        maxRows={6}
                        expandable
                        expandTitle="LLM 用户提示模板（放大编辑）"
                      />
                    </Space>
                  )
                }
              ]}
            />
          ) : null}

          {/* ====== If / Switch ====== */}
          {node.type === "if" || node.type === "switch" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">{node.type === "switch" ? "Switch" : "If"} 条件</Typography.Text>
              <Input
                value={String((node.data.condition as Record<string, unknown> | undefined)?.jsonpath ?? "$.input.query")}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    condition: {
                      ...(node.data.condition as Record<string, unknown> | undefined),
                      jsonpath: e.target.value
                    }
                  })
                }
                placeholder="JSONPath，例如 $.output.score"
              />
              <Select
                value={String((node.data.condition as Record<string, unknown> | undefined)?.operator ?? "equals")}
                onChange={(v) =>
                  updateNodeData(node.id, {
                    condition: {
                      ...(node.data.condition as Record<string, unknown> | undefined),
                      operator: v
                    }
                  })
                }
                options={[
                  { value: "equals", label: "equals" },
                  { value: "contains", label: "contains" },
                  { value: "greater_than", label: "greater than" }
                ]}
              />
              <Input
                value={String((node.data.condition as Record<string, unknown> | undefined)?.target_value ?? "")}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    condition: {
                      ...(node.data.condition as Record<string, unknown> | undefined),
                      target_value: e.target.value
                    }
                  })
                }
                placeholder="目标值"
              />
            </Space>
          ) : null}

          {/* ====== Tool (MCP) — 动态参数 ====== */}
          {node.type === "tool" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">MCP Tool 节点（tool_name 对应 GET /api/mcp/tools）</Typography.Text>
              {mcpTools.length > 0 ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: "100%" }}
                  value={(() => {
                    const tn = String(node.data.tool_name ?? "").trim();
                    return tn || undefined;
                  })()}
                  onChange={(v) => updateNodeData(node.id, { tool_name: v })}
                  options={(() => {
                    const tn = String(node.data.tool_name ?? "").trim();
                    const base = mcpTools.map((item) => ({ value: item.name, label: `${item.label} (${item.name})` }));
                    if (tn && !mcpTools.some((t) => t.name === tn)) {
                      return [{ value: tn, label: `${tn}（自定义名）` }, ...base];
                    }
                    return base;
                  })()}
                  placeholder="从 MCP 目录选择工具"
                />
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  当前 MCP 目录为空或未连接；可下方手填 tool_name。通用 HTTP 请使用「HTTP 请求」节点。
                </Typography.Text>
              )}
              <Input
                value={String(node.data.tool_name ?? "")}
                onChange={(e) => updateNodeData(node.id, { tool_name: e.target.value })}
                placeholder="必填：MCP 工具名（见 /api/mcp/tools）"
              />
              <McpParamsEditor
                toolName={String(node.data.tool_name ?? "")}
                mapping={(node.data.parameters_mapping as Record<string, unknown> | undefined) ?? {}}
                onChange={(m) => updateNodeData(node.id, { parameters_mapping: m })}
                templateProps={templateProps}
              />
            </Space>
          ) : null}

          {/* ====== HTTP 请求 ====== */}
          {node.type === "http" ? (
            <Space direction="vertical" style={{ width: "100%" }} size={10}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                仅 GET/POST；URL 与请求头值、正文支持 {"{{}}"}；仅允许 http/https；响应体过大时后端会截断。
              </Typography.Text>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  方法
                </Typography.Text>
                <Select
                  style={{ width: "100%", marginTop: 4 }}
                  value={String(node.data.method ?? "GET")}
                  onChange={(v) => updateNodeData(node.id, { method: v })}
                  options={[
                    { value: "GET", label: "GET" },
                    { value: "POST", label: "POST" }
                  ]}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  URL
                </Typography.Text>
                <TemplateInput
                  {...templateProps}
                  value={String(node.data.url ?? "")}
                  onChange={(v) => updateNodeData(node.id, { url: v })}
                  placeholder="https://api.example.com/v1?q={{input.query}}"
                  minRows={2}
                  maxRows={4}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  超时（秒，1–120）
                </Typography.Text>
                <Input
                  style={{ marginTop: 4 }}
                  value={String(node.data.timeout_sec ?? 30)}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    updateNodeData(node.id, {
                      timeout_sec: Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : 30
                    });
                  }}
                />
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                请求头（值支持模板）
              </Typography.Text>
              {Object.entries((node.data.headers as Record<string, string> | undefined) || {}).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 6, alignItems: "start" }}>
                  <Typography.Text style={{ marginTop: 6 }}>{key}</Typography.Text>
                  <TemplateInput
                    {...templateProps}
                    value={String(value)}
                    onChange={(v) =>
                      updateNodeData(node.id, {
                        headers: {
                          ...((node.data.headers as Record<string, string> | undefined) || {}),
                          [key]: v
                        }
                      })
                    }
                    minRows={1}
                    maxRows={3}
                  />
                  <Button
                    danger
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      const next = { ...((node.data.headers as Record<string, string> | undefined) || {}) };
                      delete next[key];
                      updateNodeData(node.id, { headers: next });
                    }}
                  >
                    删
                  </Button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Input
                  placeholder="Header 名"
                  value={httpHeaderKeyDraft}
                  onChange={(e) => setHttpHeaderKeyDraft(e.target.value)}
                  style={{ width: 160 }}
                />
                <Button
                  type="dashed"
                  onClick={() => {
                    const key = httpHeaderKeyDraft.trim();
                    if (!key) return;
                    updateNodeData(node.id, {
                      headers: {
                        ...((node.data.headers as Record<string, string> | undefined) || {}),
                        [key]: ""
                      }
                    });
                    setHttpHeaderKeyDraft("");
                  }}
                >
                  添加请求头
                </Button>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  请求体（POST，原始文本或 JSON 字符串）
                </Typography.Text>
                <TemplateInput
                  {...templateProps}
                  value={String(node.data.body ?? "")}
                  onChange={(v) => updateNodeData(node.id, { body: v })}
                  placeholder='例如 {"q":"{{input.query}}"}'
                  minRows={3}
                  maxRows={8}
                />
              </div>
            </Space>
          ) : null}

          {/* ====== 等待 ====== */}
          {node.type === "delay" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                阻塞等待 0–120000 毫秒（执行线程占用，勿设过大）。
              </Typography.Text>
              <Input
                value={String(node.data.duration_ms ?? 1000)}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  updateNodeData(node.id, {
                    duration_ms: Number.isFinite(n) ? Math.max(0, Math.min(120000, n)) : 1000
                  });
                }}
                addonAfter="ms"
              />
            </Space>
          ) : null}

          {/* ====== Agent ====== */}
          {node.type === "agent" ? (
            <Collapse
              size="small"
              defaultActiveKey={["agent-model", "agent-context", "agent-prompt"]}
              items={[
                {
                  key: "agent-model",
                  label: "模型与采样",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        ReAct 默认开启：模型会在最大迭代内决定是否调用工具并收敛答案。
                      </Typography.Text>
                      <Select
                        value={String(node.data.agent_strategy ?? "react")}
                        onChange={(v) => updateNodeData(node.id, { agent_strategy: v })}
                        options={[
                          { value: "react", label: "ReAct（推理-行动）" },
                          { value: "single_pass", label: "单次汇总" }
                        ]}
                        style={{ width: "100%" }}
                      />
                      <Input
                        value={String(node.data.model ?? DEFAULT_LLM_MODEL)}
                        onChange={(e) => updateNodeData(node.id, { model: e.target.value })}
                        placeholder={`模型名，默认 ${DEFAULT_LLM_MODEL}`}
                      />
                      {String(node.data.agent_strategy ?? "react") === "react" ? (
                        <Input
                          type="number"
                          value={String(node.data.max_iterations ?? 6)}
                          onChange={(e) =>
                            updateNodeData(node.id, {
                              max_iterations: Math.max(1, Math.min(20, Number(e.target.value) || 6))
                            })
                          }
                          placeholder="最大迭代次数（1-20）"
                        />
                      ) : null}
                      <div>
                        <Typography.Text type="secondary">
                          Temperature: {Number(node.data.temperature ?? 0.7).toFixed(1)}
                        </Typography.Text>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={Number(node.data.temperature ?? 0.7)}
                          onChange={(v) => updateNodeData(node.id, { temperature: v })}
                        />
                      </div>
                    </Space>
                  )
                },
                {
                  key: "agent-context",
                  label: "记忆与 MCP 工具",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }} size={10}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <Typography.Text style={{ fontSize: 13 }}>注入会话记忆</Typography.Text>
                        <Switch
                          checked={Boolean(node.data.use_memory)}
                          onChange={(v) => updateNodeData(node.id, { use_memory: v })}
                        />
                      </div>
                      {node.data.use_memory ? (
                        <Input
                          value={String(node.data.memory_key ?? "history")}
                          onChange={(e) => updateNodeData(node.id, { memory_key: e.target.value })}
                          placeholder="从 Trigger 输入里读取的字段名，默认 history"
                        />
                      ) : null}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <Typography.Text style={{ fontSize: 13 }}>调用 MCP 工具</Typography.Text>
                        <Switch
                          checked={Boolean(node.data.use_mcp_tools)}
                          onChange={(v) => updateNodeData(node.id, { use_mcp_tools: v })}
                        />
                      </div>
                      {node.data.use_mcp_tools ? (
                        <>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            多选仅包含 MCP 目录（/api/mcp/tools）；与画布「HTTP 请求」节点无关。
                          </Typography.Text>
                          <Select
                            mode="multiple"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            style={{ width: "100%" }}
                            placeholder="从 MCP 目录多选"
                            value={
                              Array.isArray(node.data.mcp_tool_names)
                                ? (node.data.mcp_tool_names as string[])
                                : []
                            }
                            onChange={(v) => updateNodeData(node.id, { mcp_tool_names: v })}
                            options={mcpTools.map((t) => ({
                              value: t.name,
                              label: `${t.label} (${t.name})`
                            }))}
                          />
                          <McpParamsEditor
                            toolNames={Array.isArray(node.data.mcp_tool_names) ? (node.data.mcp_tool_names as string[]) : []}
                            mapping={(node.data.mcp_parameters_mapping as Record<string, unknown> | undefined) ?? {}}
                            onChange={(m) => updateNodeData(node.id, { mcp_parameters_mapping: m })}
                            templateProps={templateProps}
                          />
                        </>
                      ) : null}
                    </Space>
                  )
                },
                {
                  key: "agent-prompt",
                  label: "系统提示词",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        任务输入模板（默认 query），支持变量和表达式。
                      </Typography.Text>
                      <TemplateInput
                        {...templateProps}
                        value={String(node.data.query_template ?? "{{input.query}}")}
                        onChange={(v) => updateNodeData(node.id, { query_template: v })}
                        placeholder="例如：{{input.query}}"
                        minRows={2}
                        maxRows={4}
                      />
                      <SystemPromptEditor
                        {...templateProps}
                        title=""
                        value={String(node.data.system_prompt ?? "")}
                        onChange={(v) => updateNodeData(node.id, { system_prompt: v })}
                        placeholder="Agent 系统提示词 / 总结指令"
                        minRows={3}
                        maxRows={6}
                      />
                    </Space>
                  )
                }
              ]}
            />
          ) : null}

          {/* ====== Loop ====== */}
          {node.type === "loop" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">循环迭代：对指定路径的数组逐元素处理</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>数组路径</Typography.Text>
              <Input
                value={String(node.data.array_path ?? "input.items")}
                onChange={(e) => updateNodeData(node.id, { array_path: e.target.value })}
                placeholder="例如：input.items 或 nodes.xxx.output.results"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>最大迭代次数</Typography.Text>
              <Input
                type="number"
                value={String(node.data.max_iterations ?? 10)}
                onChange={(e) => updateNodeData(node.id, { max_iterations: Number(e.target.value) || 10 })}
              />
            </Space>
          ) : null}

          {/* ====== Split in Batches ====== */}
          {node.type === "split_in_batches" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">批量拆分：将数组按指定大小拆分为多个批次</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>数组路径</Typography.Text>
              <Input
                value={String(node.data.array_path ?? "input.items")}
                onChange={(e) => updateNodeData(node.id, { array_path: e.target.value })}
                placeholder="例如：input.items"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>批次大小</Typography.Text>
              <Input
                type="number"
                value={String(node.data.batch_size ?? 5)}
                onChange={(e) => updateNodeData(node.id, { batch_size: Number(e.target.value) || 5 })}
              />
            </Space>
          ) : null}

          {/* ====== LLM Compare ====== */}
          {node.type === "llm_compare" ? (
            <Collapse
              size="small"
              defaultActiveKey={["compare-models", "compare-prompt"]}
              items={[
                {
                  key: "compare-models",
                  label: "模型列表与采样",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        输入多个模型名（逗号分隔），将并行调用并对比结果
                      </Typography.Text>
                      <Input
                        value={String(node.data.model_names ?? "gpt-4o-mini,gpt-4o")}
                        onChange={(e) => updateNodeData(node.id, { model_names: e.target.value })}
                        placeholder="gpt-4o-mini,gpt-4o,claude-3-haiku"
                      />
                      <div>
                        <Typography.Text type="secondary">
                          Temperature: {Number(node.data.temperature ?? 0.2).toFixed(1)}
                        </Typography.Text>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={Number(node.data.temperature ?? 0.2)}
                          onChange={(v) => updateNodeData(node.id, { temperature: v })}
                        />
                      </div>
                    </Space>
                  )
                },
                {
                  key: "compare-prompt",
                  label: "共用 Prompt",
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <TemplateVarChips
                        onInsert={(snippet) =>
                          updateNodeData(node.id, {
                            user_prompt: appendTemplateVar(String(node.data.user_prompt ?? ""), snippet)
                          })
                        }
                      />
                      <SystemPromptEditor
                        {...templateProps}
                        value={String(node.data.system_prompt ?? "")}
                        onChange={(v) => updateNodeData(node.id, { system_prompt: v })}
                        placeholder="系统提示词"
                        minRows={2}
                        maxRows={4}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>用户提示模板</Typography.Text>
                      <TemplateInput
                        {...templateProps}
                        value={String(node.data.user_prompt ?? "{{input.query}}")}
                        onChange={(v) => updateNodeData(node.id, { user_prompt: v })}
                        placeholder="例如 {{input.query}}"
                        minRows={2}
                        maxRows={6}
                      />
                    </Space>
                  )
                }
              ]}
            />
          ) : null}

          {/* ====== Knowledge retrieve ====== */}
          {node.type === "knowledge_retrieve" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <strong>多路召回</strong>：词法 / 短语整句 / 标题 / 顺序；在召回池内分路归一化后<strong>加权融合重排</strong>。输出含{" "}
                <code>retrieval</code> 与各条 <code>score_breakdown</code>。管理文本见{" "}
                <Link to="/knowledge">知识库</Link>。
              </Typography.Text>
              <KnowledgeBasePicker
                key={node.id}
                value={String(node.data.knowledge_base_id ?? "").trim()}
                onChange={(id) => updateNodeData(node.id, { knowledge_base_id: id })}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>查询模板</Typography.Text>
              <TemplateInput
                {...templateProps}
                value={String(node.data.query_template ?? "{{input.query}}")}
                onChange={(v) => updateNodeData(node.id, { query_template: v })}
                placeholder="{{input.query}}"
                minRows={2}
                maxRows={4}
              />
              <Typography.Text type="secondary">返回条数 top_k</Typography.Text>
              <Input
                type="number"
                value={Number(node.data.top_k ?? 5)}
                onChange={(e) => updateNodeData(node.id, { top_k: Number(e.target.value) || 5 })}
              />
              <Collapse
                size="small"
                items={[
                  {
                    key: "rag",
                    label: "多路召回与重排（可选）",
                    children: (
                      <Space direction="vertical" style={{ width: "100%" }} size={12}>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          权重会在服务端按非负值自动归一化为 1；召回池为多路候选并集后再精排。
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          召回池上限
                        </Typography.Text>
                        <Input
                          type="number"
                          value={Number(node.data.recall_pool_size ?? 64)}
                          min={8}
                          max={200}
                          onChange={(e) =>
                            updateNodeData(node.id, {
                              recall_pool_size: Math.min(200, Math.max(8, Number(e.target.value) || 64))
                            })
                          }
                        />
                        <Space align="center">
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            输出分项分数 score_breakdown
                          </Typography.Text>
                          <Switch
                            checked={Boolean(node.data.include_score_breakdown ?? true)}
                            onChange={(v) => updateNodeData(node.id, { include_score_breakdown: v })}
                          />
                        </Space>
                        {(["keyword", "phrase", "title", "order", "dense"] as const).map((key) => {
                          const rw = (node.data.rag_weights as Record<string, number> | undefined) || {};
                          const defaults: Record<string, number> = {
                            keyword: 0.38,
                            phrase: 0.37,
                            title: 0.2,
                            order: 0.05,
                            dense: 0
                          };
                          const labelMap: Record<string, string> = {
                            keyword: "词法（正文 token）",
                            phrase: "短语（整句 / 最长中文片）",
                            title: "标题命中",
                            order: "顺序先验（position）",
                            dense: "向量 dense（需块已入库 embedding）"
                          };
                          const val = Number(rw[key] ?? defaults[key]);
                          return (
                            <div key={key}>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                {labelMap[key]}：{val.toFixed(2)}
                              </Typography.Text>
                              <Slider
                                min={0}
                                max={1}
                                step={0.01}
                                value={val}
                                onChange={(v) =>
                                  updateNodeData(node.id, {
                                    rag_weights: { ...defaults, ...rw, [key]: v }
                                  })
                                }
                              />
                            </div>
                          );
                        })}
                      </Space>
                    )
                  }
                ]}
              />
            </Space>
          ) : null}

          {/* ====== Set fields (n8n-style) ====== */}
          {node.type === "set_fields" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">字段赋值 → 输出在 nodes.*.output.fields.*</Typography.Text>
              {Object.entries((node.data.assignments as Record<string, string> | undefined) || {}).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 6, alignItems: "start" }}>
                  <Typography.Text style={{ marginTop: 6 }}>{key}</Typography.Text>
                  <TemplateInput
                    {...templateProps}
                    value={String(value)}
                    onChange={(v) =>
                      updateNodeData(node.id, {
                        assignments: {
                          ...((node.data.assignments as Record<string, string> | undefined) || {}),
                          [key]: v
                        }
                      })
                    }
                    minRows={2}
                    maxRows={4}
                  />
                  <Button
                    danger
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      const next = { ...((node.data.assignments as Record<string, string> | undefined) || {}) };
                      delete next[key];
                      updateNodeData(node.id, { assignments: next });
                    }}
                  >
                    删
                  </Button>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 6 }}>
                <Input
                  placeholder="新字段名"
                  value={setFieldsKeyDraft}
                  onChange={(e) => setSetFieldsKeyDraft(e.target.value)}
                />
                <Button
                  type="dashed"
                  onClick={() => {
                    const key = setFieldsKeyDraft.trim();
                    if (!key) return;
                    updateNodeData(node.id, {
                      assignments: {
                        ...((node.data.assignments as Record<string, string> | undefined) || {}),
                        [key]: "{{input.query}}"
                      }
                    });
                    setSetFieldsKeyDraft("");
                  }}
                >
                  添加字段
                </Button>
              </div>
            </Space>
          ) : null}

          {/* ====== Group ====== */}
          {node.type === "group" ? (
            <Typography.Text type="secondary">
              视觉分组容器；保存后后端按透传节点执行，请避免将入口设为 group（入口应为 Trigger）。
            </Typography.Text>
          ) : null}

          {/* ====== Parallel ====== */}
          {node.type === "parallel" ? (
            <Typography.Text type="secondary">并行网关占位节点；与后续 Send/Map 编排对接前，可当作透传节点连线使用。</Typography.Text>
          ) : null}

          {/* ====== End ====== */}
          {node.type === "end" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">输出映射（key → 模板字符串，引用 nodes.*.output）</Typography.Text>
              {Object.entries((node.data.output_mapping as Record<string, string> | undefined) || {}).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 6, alignItems: "start" }}>
                  <Typography.Text style={{ marginTop: 6 }}>{key}</Typography.Text>
                  <TemplateInput
                    {...templateProps}
                    value={String(value)}
                    onChange={(v) =>
                      updateNodeData(node.id, {
                        output_mapping: {
                          ...((node.data.output_mapping as Record<string, string> | undefined) || {}),
                          [key]: v
                        }
                      })
                    }
                    minRows={2}
                    maxRows={4}
                  />
                  <Button
                    danger
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      const next = { ...((node.data.output_mapping as Record<string, string> | undefined) || {}) };
                      delete next[key];
                      updateNodeData(node.id, { output_mapping: next });
                    }}
                  >
                    删
                  </Button>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 6 }}>
                <Input
                  placeholder="新字段名"
                  value={endMapKeyDraft}
                  onChange={(e) => setEndMapKeyDraft(e.target.value)}
                />
                <Button
                  type="dashed"
                  onClick={() => {
                    const key = endMapKeyDraft.trim();
                    if (!key) return;
                    updateNodeData(node.id, {
                      output_mapping: {
                        ...((node.data.output_mapping as Record<string, string> | undefined) || {}),
                        [key]: "{{input.query}}"
                      }
                    });
                    setEndMapKeyDraft("");
                  }}
                >
                  添加映射项
                </Button>
              </div>
            </Space>
          ) : null}

          {/* ====== Global ====== */}
          {node.type === "global" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">Global Context Variables</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                此处定义的变量可在任意节点中通过 {"{{globals.<变量名>}}"} 引用
              </Typography.Text>
              {Object.entries((node.data.variables as Record<string, string> | undefined) || {}).map(([key, value]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "88px 1fr auto", gap: 6 }}>
                  <Typography.Text>{key}</Typography.Text>
                  <Input
                    value={value}
                    onChange={(e) =>
                      updateNodeData(node.id, {
                        variables: {
                          ...((node.data.variables as Record<string, string> | undefined) || {}),
                          [key]: e.target.value
                        }
                      })
                    }
                  />
                  <Button
                    danger
                    onClick={() => {
                      const next = { ...((node.data.variables as Record<string, string> | undefined) || {}) };
                      delete next[key];
                      updateNodeData(node.id, { variables: next });
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "88px 1fr auto", gap: 6 }}>
                <Input placeholder="变量名" value={globalKeyDraft} onChange={(e) => setGlobalKeyDraft(e.target.value)} />
                <Input placeholder="初始值" value={globalValueDraft} onChange={(e) => setGlobalValueDraft(e.target.value)} />
                <Button
                  type="primary"
                  onClick={() => {
                    const key = globalKeyDraft.trim();
                    if (!key) return;
                    updateNodeData(node.id, {
                      variables: {
                        ...((node.data.variables as Record<string, string> | undefined) || {}),
                        [key]: globalValueDraft
                      }
                    });
                    setGlobalKeyDraft("");
                    setGlobalValueDraft("");
                  }}
                >
                  添加
                </Button>
              </div>
            </Space>
          ) : null}

          {/* ====== Action (目录驱动) ====== */}
          {node.type === "action" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                value={String(node.data.action_type ?? "send_message")}
                onChange={(v) => updateNodeData(node.id, { action_type: v })}
                options={[
                  { value: "send_message", label: "发送消息" },
                  { value: "http_callback", label: "HTTP 回调" },
                ]}
                style={{ width: "100%" }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                内容模板
              </Typography.Text>
              <TemplateInput
                {...templateProps}
                value={String(node.data.template ?? "")}
                onChange={(v) => updateNodeData(node.id, { template: v })}
                placeholder="输出内容模板，支持 {{}} 变量引用"
                minRows={2}
                maxRows={6}
              />
            </Space>
          ) : null}

          {/* ====== Memory ====== */}
          {node.type === "memory" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">记忆字段名</Typography.Text>
              <Input
                value={String(node.data.memory_key ?? "history")}
                onChange={(e) => updateNodeData(node.id, { memory_key: e.target.value })}
                placeholder="从 Trigger 输入里读取的字段名，默认 history"
              />
            </Space>
          ) : null}

          {/* ====== Fallback ====== */}
          {![
            "llm", "if", "switch", "tool", "http", "delay", "agent",
            "global", "end", "loop", "parallel", "action", "memory",
            "trigger", "start", "llm_compare", "split_in_batches", "condition",
            "knowledge_retrieve", "set_fields", "group", "code"
          ].includes(node.type) ? (
            <Typography.Text type="secondary">当前节点暂无专用 Schema，已显示通用字段。</Typography.Text>
          ) : null}

          <NodeTestAndLineage nodeId={node.id} nodeType={node.type} onDelete={() => deleteNode(node.id)} />
        </Space>
        </Card>
      )}
    </div>
  );
}
