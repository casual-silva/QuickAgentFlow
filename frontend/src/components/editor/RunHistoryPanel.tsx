import { Card, Input, List, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { RunItem } from "../../types/workflow";

interface Props {
  runs: RunItem[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
}

export function RunHistoryPanel({ runs, activeRunId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return runs;
    }
    return runs.filter((item) => {
      const id = item.id.toLowerCase();
      const st = item.status.toLowerCase();
      const time = new Date(item.created_at).toLocaleString().toLowerCase();
      return id.includes(q) || st.includes(q) || time.includes(q);
    });
  }, [runs, query]);

  return (
    <Card
      size="small"
      title="运行历史"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
      styles={{ body: { padding: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }}
    >
      <div style={{ padding: "8px 12px 0" }}>
        <Input.Search allowClear placeholder="搜索 run id / 状态 / 时间" value={query} onChange={(e) => setQuery(e.target.value)} size="small" />
      </div>
      <List
        size="small"
        style={{ flex: 1, overflow: "auto", marginTop: 8 }}
        dataSource={filtered}
        locale={{ emptyText: query.trim() ? "无匹配记录" : "暂无运行记录" }}
        renderItem={(item) => (
          <List.Item
            style={{
              cursor: "pointer",
              background: item.id === activeRunId ? "#e6f4ff" : "transparent",
              padding: "10px 12px"
            }}
            onClick={() => onSelect(item.id)}
          >
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Typography.Text ellipsis style={{ maxWidth: 170 }}>
                  {item.id}
                </Typography.Text>
                <Tag color={item.status === "success" ? "green" : item.status === "failed" ? "red" : "blue"}>
                  {item.status}
                </Tag>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(item.created_at).toLocaleString()}
              </Typography.Text>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
