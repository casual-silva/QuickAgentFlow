import {
  ApiOutlined,
  ApartmentOutlined,
  BookOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  CompressOutlined,
  DatabaseOutlined,
  DownOutlined,
  ExperimentOutlined,
  FormOutlined,
  GroupOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  RetweetOutlined,
  RobotOutlined,
  SplitCellsOutlined,
  ThunderboltOutlined,
  UpOutlined
} from "@ant-design/icons";
import { Button, Card, Collapse, Input, Popover, Space, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NodeType } from "../../types/workflow";
import { useWorkflowStore } from "../../store/workflowStore";
import { useNodeTypeSpecs } from "../../store/nodeTypeSpecStore";

type CatalogItem = { type: NodeType; label: string; description: string; category?: string };

type PaletteRow =
  | { kind: "base"; catalog: CatalogItem; dragPayload: string }
  | { kind: "tool_preset"; catalog: CatalogItem; preset: Record<string, unknown>; dragPayload: string };

function dragPayloadFor(type: NodeType, preset?: Record<string, unknown>): string {
  if (preset && Object.keys(preset).length > 0) {
    return JSON.stringify({ type, preset });
  }
  return type;
}

const iconByType: Record<string, ReactNode> = {
  global: <ApartmentOutlined />,
  trigger: <PlayCircleOutlined />,
  start: <PlayCircleOutlined />,
  end: <PlayCircleOutlined />,
  llm: <RobotOutlined />,
  llm_compare: <ExperimentOutlined />,
  agent: <ThunderboltOutlined />,
  memory: <DatabaseOutlined />,
  tool: <ApiOutlined />,
  http: <LinkOutlined />,
  if: <BranchesOutlined />,
  condition: <BranchesOutlined />,
  switch: <BranchesOutlined />,
  loop: <RetweetOutlined />,
  split_in_batches: <SplitCellsOutlined />,
  parallel: <CompressOutlined />,
  delay: <ClockCircleOutlined />,
  action: <ThunderboltOutlined />,
  code: <ApiOutlined />,
  knowledge_retrieve: <BookOutlined />,
  set_fields: <FormOutlined />,
  group: <GroupOutlined />
};

const CATEGORY_ORDER: Record<string, number> = {
  "基础": 0,
  "AI 模型": 1,
  "逻辑": 2,
  "工具": 3,
};

const CATEGORY_ICON: Record<string, ReactNode> = {
  "基础": <PlayCircleOutlined />,
  "AI 模型": <RobotOutlined />,
  "逻辑": <BranchesOutlined />,
  "工具": <ApiOutlined />,
};

interface NodePaletteProps {
  collapsed?: boolean;
}

export function NodePalette({ collapsed = false }: NodePaletteProps) {
  const { addNode } = useWorkflowStore();
  const { specs, mcpTools: mcpToolsFromStore, fetch: fetchSpecs, loaded } = useNodeTypeSpecs();
  const [listOpen, setListOpen] = useState(true);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteWidth, setPaletteWidth] = useState(260);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => { void fetchSpecs(); }, [fetchSpecs]);

  const nodeTypes = useMemo((): CatalogItem[] => {
    if (!loaded) return [];
    const fromApi = specs.map((s) => ({
      type: s.type as NodeType,
      label: s.label,
      description: s.description,
      category: (s as any).category as string | undefined
    }));
    const hasGlobal = fromApi.some((item) => item.type === "global");
    return hasGlobal
      ? fromApi
      : [
          { type: "global" as const, label: "Global Context", description: "定义全局变量，作为 Trigger 的初始上下文", category: "基础" },
          ...fromApi,
        ];
  }, [specs, loaded]);
  const mcpTools = mcpToolsFromStore;

  const rows = useMemo((): PaletteRow[] => {
    const out: PaletteRow[] = [];
    const withoutGenericTool = nodeTypes.filter((n) => n.type !== "tool");
    for (const catalog of withoutGenericTool) {
      out.push({ kind: "base", catalog, dragPayload: dragPayloadFor(catalog.type) });
    }
    out.push({
      kind: "base",
      catalog: {
        type: "tool",
        label: "Tool（MCP）",
        description: "绑定 MCP 目录中的工具名；通用 REST 请使用「HTTP 请求」节点",
        category: "工具"
      },
      dragPayload: dragPayloadFor("tool")
    });
    for (const t of mcpTools) {
      out.push({
        kind: "tool_preset",
        catalog: {
          type: "tool",
          label: t.label || t.name,
          description: t.description || `调用工具 ${t.name}`,
          category: "工具"
        },
        preset: { tool_name: t.name, label: t.label || t.name },
        dragPayload: dragPayloadFor("tool", { tool_name: t.name, label: t.label || t.name })
      });
    }
    return out;
  }, [nodeTypes, mcpTools]);

  const filteredRows = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.catalog.type.toLowerCase().includes(q) ||
        r.catalog.label.toLowerCase().includes(q) ||
        r.catalog.description.toLowerCase().includes(q)
    );
  }, [rows, paletteQuery]);

  const groupedRows = useMemo(() => {
    const groups: Record<string, PaletteRow[]> = {};
    for (const row of filteredRows) {
      const cat = row.catalog.category || "其它";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(row);
    }
    return Object.entries(groups).sort(
      (a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99)
    );
  }, [filteredRows]);

  function onAddRow(row: PaletteRow) {
    if (row.kind === "base") {
      addNode(row.catalog.type);
      return;
    }
    addNode("tool", row.preset);
  }

  function renderRow(row: PaletteRow, idx: number) {
    return (
      <Tooltip key={`${row.kind}-${row.catalog.label}-${idx}`} title={row.catalog.description} placement="right">
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/reactflow", row.dragPayload);
            event.dataTransfer.effectAllowed = "move";
          }}
        >
          <Button
            block
            size="small"
            onClick={() => onAddRow(row)}
            style={{ display: "flex", justifyContent: "flex-start", marginBottom: 2 }}
          >
            <span style={{ marginRight: 8 }}>{iconByType[row.catalog.type] || <ApartmentOutlined />}</span>
            <span style={{ textAlign: "left" }}>
              {row.catalog.label}
              {row.kind === "tool_preset" ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  (tool)
                </Typography.Text>
              ) : null}
            </span>
          </Button>
        </div>
      </Tooltip>
    );
  }

  // 中文注释：拖拽调整节点库宽度
  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: paletteWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      setPaletteWidth(Math.max(180, Math.min(480, dragRef.current.startW + dx)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // 中文注释：折叠态——仅显示分类图标栏，点击弹出对应分类节点列表
  if (collapsed) {
    return (
      <aside
        style={{
          borderRight: "1px solid #f0f0f0",
          padding: "12px 4px",
          background: "#fff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          width: 40,
        }}
      >
        {groupedRows.map(([category, catRows]) => (
          <Popover
            key={category}
            placement="rightTop"
            trigger="click"
            title={<span style={{ fontSize: 12 }}>{category}（{catRows.length}）</span>}
            content={
              <div style={{ maxHeight: 320, overflow: "auto", width: 220 }}>
                <Space direction="vertical" style={{ width: "100%" }} size={2}>
                  {catRows.map((row, idx) => renderRow(row, idx))}
                </Space>
              </div>
            }
          >
            <Tooltip title={category} placement="right">
              <Button
                type="text"
                size="small"
                icon={CATEGORY_ICON[category] || <ApartmentOutlined />}
                style={{ width: 32, height: 32 }}
              />
            </Tooltip>
          </Popover>
        ))}
      </aside>
    );
  }

  // 中文注释：展开态——完整节点库
  return (
    <aside
      style={{
        borderRight: "1px solid #f0f0f0",
        background: "#fff",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        width: paletteWidth,
      }}
    >
      <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
        <Card
          size="small"
          title={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
              <span>节点库</span>
              <Tooltip title={listOpen ? "收起节点列表" : "展开节点列表"}>
                <Button
                  type="text"
                  size="small"
                  icon={listOpen ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setListOpen((v) => !v)}
                />
              </Tooltip>
            </div>
          }
          variant="borderless"
        >
          <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
            拖拽或点击添加节点。<Typography.Text keyboard style={{ fontSize: 11 }}>Ctrl/Cmd+B</Typography.Text> 折叠
          </Typography.Paragraph>
          {listOpen ? (
            <>
              <Input.Search
                allowClear
                placeholder="搜索类型 / 名称 / 说明"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              {paletteQuery.trim() ? (
                <Space direction="vertical" style={{ width: "100%" }} size={2}>
                  {filteredRows.length === 0 ? (
                    <Typography.Text type="secondary">无匹配节点类型</Typography.Text>
                  ) : (
                    filteredRows.map((row, idx) => renderRow(row, idx))
                  )}
                </Space>
              ) : (
                <Collapse
                  size="small"
                  defaultActiveKey={groupedRows.map(([cat]) => cat)}
                  className="node-palette-category"
                  items={groupedRows.map(([category, catRows]) => ({
                    key: category,
                    label: `${category}（${catRows.length}）`,
                    children: (
                      <Space direction="vertical" style={{ width: "100%" }} size={2}>
                        {catRows.map((row, idx) => renderRow(row, idx))}
                      </Space>
                    )
                  }))}
                />
              )}
            </>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已收起 · 点击 ↑ 展开
            </Typography.Text>
          )}
        </Card>
      </div>
      {/* 中文注释：右侧拖拽条——拖动调整节点库宽度 */}
      <div
        onMouseDown={onResizeStart}
        style={{
          width: 4,
          cursor: "col-resize",
          background: "transparent",
          flexShrink: 0,
          transition: "background .15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#d0d5dd"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      />
    </aside>
  );
}
