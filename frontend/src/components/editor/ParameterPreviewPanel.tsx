import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Input, Space, Typography } from "antd";
import { previewExpressions } from "../../api/client";
import { useRunObservationStore } from "../../store/runObservationStore";
import { useWorkflowStore } from "../../store/workflowStore";

type PreviewRow = {
  key: string;
  template: string;
  rendered: string;
  diagnostics: Array<{ token: string; ok: boolean; value?: unknown; error?: string }>;
};

function isTemplateLike(text: string): boolean {
  return text.includes("{{") && text.includes("}}");
}

function collectTemplateFields(data: Record<string, unknown>, prefix = ""): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(data || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && isTemplateLike(v)) {
      out.push({ key: path, value: v });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...collectTemplateFields(v as Record<string, unknown>, path));
    }
  }
  return out;
}

export function ParameterPreviewPanel() {
  const { nodes, selectedNodeId } = useWorkflowStore();
  const logs = useRunObservationStore((s) => s.logs);
  const [inputDraft, setInputDraft] = useState('{"query":"请总结今天运行情况"}');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const node = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  const globalsPayload = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "global")
        .reduce(
          (acc, n) => ({
            ...acc,
            ...(((n.data.variables as Record<string, unknown> | undefined) || {}) as Record<string, unknown>)
          }),
          {} as Record<string, unknown>
        ),
    [nodes]
  );
  const varsPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const log of logs) {
      if (log.status !== "failed") {
        out[log.node_id] = log.output || {};
      }
    }
    return out;
  }, [logs]);

  useEffect(() => {
    async function runPreview() {
      if (!node) {
        setRows([]);
        return;
      }
      const templates = collectTemplateFields((node.data || {}) as Record<string, unknown>);
      if (templates.length === 0) {
        setRows([]);
        return;
      }
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(inputDraft || "{}");
      } catch {
        setRows(
          templates.map((t) => ({
            key: t.key,
            template: t.value,
            rendered: "输入 JSON 解析失败",
            diagnostics: []
          }))
        );
        return;
      }
      setBusy(true);
      try {
        const resp = await previewExpressions({
          templates: Object.fromEntries(templates.map((t) => [t.key, t.value])),
          input: parsedInput,
          vars: varsPayload,
          globals: globalsPayload
        });
        setRows(
          templates.map((t) => ({
            key: t.key,
            template: t.value,
            rendered: resp.rendered[t.key] ?? "",
            diagnostics: resp.diagnostics[t.key] ?? []
          }))
        );
      } finally {
        setBusy(false);
      }
    }
    void runPreview();
  }, [node, inputDraft, varsPayload, globalsPayload]);

  return (
    <Card size="small" title="参数预览（实时）" variant="borderless" style={{ height: "100%", overflow: "auto" }}>
      {!node ? (
        <Typography.Text type="secondary">请先在画布选择一个节点</Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Alert
            type="info"
            showIcon
            message="表达式支持"
            description="可视化插入变量后自动生成 {{nodes.xxx.output.field}}；高级场景可用 {{= ... }}，由后端安全执行。"
          />
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              预览输入（JSON）
            </Typography.Text>
            <Input.TextArea value={inputDraft} onChange={(e) => setInputDraft(e.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} />
          </div>
          {rows.length === 0 ? (
            <Typography.Text type="secondary">当前节点没有可预览的模板参数（含 {"{{...}}"} 的字符串）</Typography.Text>
          ) : (
            rows.map((row) => (
              <Card key={row.key} size="small" style={{ background: "#fafafa" }}>
                <Typography.Text strong>{row.key}</Typography.Text>
                <Typography.Paragraph code style={{ marginBottom: 6, marginTop: 4, whiteSpace: "pre-wrap" }}>
                  {row.template}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                  {busy ? "预览计算中..." : row.rendered}
                </Typography.Paragraph>
                {row.diagnostics.some((d) => !d.ok) ? (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    {row.diagnostics.filter((d) => !d.ok).map((d) => d.error).join("; ")}
                  </Typography.Text>
                ) : null}
              </Card>
            ))
          )}
        </Space>
      )}
    </Card>
  );
}
