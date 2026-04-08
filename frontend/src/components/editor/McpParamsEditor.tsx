/**
 * 动态参数映射编辑器：根据 MCP 工具元数据（或内置静态参数定义）渲染参数表单，
 * 每个参数值支持 TemplateInput 变量引用。
 *
 * 使用场景：
 * - Tool (MCP) 节点：根据选中的 tool_name 从 MCP 目录获取参数 schema
 * - 需要固定参数表但无 MCP schema 时：使用 static_params
 * - Agent 的 mcp_parameters_mapping：根据选中的多个工具合并参数
 */
import { useMemo, useState } from "react";
import { Button, Input, Space, Typography } from "antd";
import { TemplateInput } from "./TemplateInput";
import { useNodeTypeSpecs } from "../../store/nodeTypeSpecStore";
import type { RunLogItem, WorkflowEdge, WorkflowNode } from "../../types/workflow";

interface ParamDef {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

interface TemplatePassthrough {
  nodes: WorkflowNode[];
  logs: RunLogItem[];
  currentNodeId?: string;
  edges?: WorkflowEdge[];
}

interface Props {
  /** 单个工具名（Tool 节点用） */
  toolName?: string;
  /** 多个工具名（Agent 节点用） */
  toolNames?: string[];
  /** 内置固定参数定义（无 MCP schema 时） */
  staticParams?: ParamDef[];
  /** 当前参数映射值 */
  mapping: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  templateProps: TemplatePassthrough;
}

/** 从 MCP 工具元数据的 inputSchema (JSON Schema) 提取参数列表 */
function extractParamsFromSchema(schema: Record<string, unknown> | undefined): ParamDef[] {
  if (!schema) return [];
  const props = (schema.properties ?? schema) as Record<string, Record<string, unknown>>;
  if (!props || typeof props !== "object") return [];
  const requiredSet = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(props)
    .filter(([k]) => k !== "type" && k !== "required" && k !== "properties")
    .map(([name, def]) => ({
      name,
      type: String(def?.type ?? "string"),
      required: requiredSet.has(name),
      description: String(def?.description ?? ""),
    }));
}

export function McpParamsEditor({ toolName, toolNames, staticParams, mapping, onChange, templateProps }: Props) {
  const { getMcpTool } = useNodeTypeSpecs();
  const [customKeyDraft, setCustomKeyDraft] = useState("");

  // 合并参数定义：静态 > MCP 工具 schema
  const paramDefs = useMemo((): ParamDef[] => {
    if (staticParams && staticParams.length > 0) return staticParams;

    const names = toolNames ?? (toolName ? [toolName] : []);
    const merged = new Map<string, ParamDef>();
    for (const tn of names) {
      const tool = getMcpTool(tn);
      if (!tool?.parameters) continue;
      for (const p of extractParamsFromSchema(tool.parameters as Record<string, unknown>)) {
        if (!merged.has(p.name)) merged.set(p.name, p);
      }
    }
    return merged.size > 0 ? Array.from(merged.values()) : [];
  }, [staticParams, toolName, toolNames, getMcpTool]);

  // 如果无参数定义（MCP 未连接或无 schema），展示自定义键值编辑
  const hasSchema = paramDefs.length > 0;

  // mapping 中可能有不在 paramDefs 里的额外键
  const extraKeys = useMemo(() => {
    const knownNames = new Set(paramDefs.map((p) => p.name));
    return Object.keys(mapping).filter((k) => !knownNames.has(k));
  }, [paramDefs, mapping]);

  function updateKey(key: string, value: unknown) {
    onChange({ ...mapping, [key]: value });
  }

  function removeKey(key: string) {
    const next = { ...mapping };
    delete next[key];
    onChange(next);
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {hasSchema ? (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            参数映射（值支持 {"{{变量}}"} 引用）
          </Typography.Text>
          {paramDefs.map((p) => (
            <div key={p.name}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <Typography.Text style={{ fontSize: 12, fontWeight: 500 }}>
                  {p.name}
                  {p.required ? <span style={{ color: "#ff4d4f" }}> *</span> : null}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {p.type}
                </Typography.Text>
              </div>
              {p.description ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                  {p.description}
                </Typography.Text>
              ) : null}
              {p.type === "number" ? (
                <Input
                  value={String(mapping[p.name] ?? p.name === "top_k" ? mapping[p.name] ?? 3 : "")}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateKey(p.name, raw.includes("{{") ? raw : (Number(raw) || raw));
                  }}
                  placeholder={`${p.name} 值`}
                  size="small"
                />
              ) : (
                <TemplateInput
                  {...templateProps}
                  value={String(mapping[p.name] ?? (p.name === "query" ? "{{input.query}}" : ""))}
                  onChange={(v) => updateKey(p.name, v)}
                  placeholder={`${p.name}（支持 {{}} 变量）`}
                  minRows={1}
                  maxRows={3}
                />
              )}
            </div>
          ))}
        </>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          无工具参数定义；可手动添加自定义参数。
        </Typography.Text>
      )}

      {/* 额外键（不在 schema 中的自定义参数）或无 schema 时的已有 mapping */}
      {(hasSchema ? extraKeys : Object.keys(mapping)).map((key) => (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 6, alignItems: "start" }}>
          <Typography.Text style={{ fontSize: 12, marginTop: 6 }}>{key}</Typography.Text>
          <TemplateInput
            {...templateProps}
            value={String(mapping[key] ?? "")}
            onChange={(v) => updateKey(key, v)}
            placeholder={`${key} 值`}
            minRows={1}
            maxRows={3}
          />
          <Button danger size="small" style={{ marginTop: 4 }} onClick={() => removeKey(key)}>
            删
          </Button>
        </div>
      ))}

      {/* 添加自定义参数 */}
      <div style={{ display: "flex", gap: 6 }}>
        <Input
          size="small"
          placeholder="自定义参数名"
          value={customKeyDraft}
          onChange={(e) => setCustomKeyDraft(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          type="dashed"
          onClick={() => {
            const key = customKeyDraft.trim();
            if (!key || key in mapping) return;
            updateKey(key, "");
            setCustomKeyDraft("");
          }}
        >
          添加
        </Button>
      </div>
    </Space>
  );
}
