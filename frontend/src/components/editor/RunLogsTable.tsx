import { Card, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { RunLogItem } from "../../types/workflow";

function JsonTreeNode({ name, value, level = 0 }: { name: string; value: unknown; level?: number }) {
  const isObject = typeof value === "object" && value !== null;
  if (!isObject) {
    return (
      <div style={{ paddingLeft: level * 12, fontSize: 12, lineHeight: "20px" }}>
        <span style={{ color: "#8c8c8c" }}>{name}: </span>
        <span>{JSON.stringify(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item] as const)
    : Object.entries(value as Record<string, unknown>);
  const preview = Array.isArray(value) ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <details open={level === 0}>
      <summary style={{ cursor: "pointer", fontSize: 12, lineHeight: "20px" }}>
        <span style={{ color: "#8c8c8c" }}>{name}: </span>
        <span>{preview}</span>
      </summary>
      <div>
        {entries.map(([entryKey, entryValue]) => (
          <JsonTreeNode key={`${name}-${entryKey}`} name={entryKey} value={entryValue} level={level + 1} />
        ))}
      </div>
    </details>
  );
}

function JsonTreeViewer({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span style={{ color: "#8c8c8c" }}>null</span>;
  }
  return (
    <div
      style={{
        maxHeight: 180,
        overflow: "auto",
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        padding: "4px 8px",
        background: "#fafafa"
      }}
    >
      <JsonTreeNode name="root" value={value} />
    </div>
  );
}

const columns: ColumnsType<RunLogItem> = [
  { title: "节点ID", dataIndex: "node_id", key: "node_id", width: 180 },
  { title: "类型", dataIndex: "node_type", key: "node_type", width: 100 },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 100,
    render: (status: string) => (
      <Tag color={status === "success" ? "green" : status === "failed" ? "red" : "blue"}>{status}</Tag>
    )
  },
  { title: "耗时(ms)", dataIndex: "duration_ms", key: "duration_ms", width: 100 },
  {
    title: "输出",
    dataIndex: "output",
    key: "output",
    render: (output: Record<string, unknown>) => <JsonTreeViewer value={output} />
  }
];

export function RunLogsTable({ logs, embedded }: { logs: RunLogItem[]; embedded?: boolean }) {
  const table = <Table rowKey="id" columns={columns} dataSource={logs} pagination={{ pageSize: 5 }} size="small" />;
  if (embedded) {
    return table;
  }
  return (
    <Card size="small" title="节点执行日志" style={{ marginTop: 12 }}>
      {table}
    </Card>
  );
}
