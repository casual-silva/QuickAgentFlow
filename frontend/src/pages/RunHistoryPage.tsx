import { useEffect, useState } from "react";
import { Button, Card, Collapse, Descriptions, Input, Select, Space, Table, Tag, Typography } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { listRunLogs, listRunsPaginated } from "../api/client";
import type { RunItem, RunLogItem } from "../types/workflow";

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: 220,
        overflow: "auto",
        fontSize: 11,
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        padding: 8,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all"
      }}
    >
      {typeof data === "string" ? data : JSON.stringify(data ?? {}, null, 2)}
    </pre>
  );
}

function RunDetailDrawer({ run }: { run: RunItem }) {
  const [logs, setLogs] = useState<RunLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadLogs() {
    if (loaded) return;
    setLoading(true);
    try {
      const data = await listRunLogs(run.id);
      setLogs(data);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, [run.id]);

  return (
    <div style={{ padding: "8px 0" }}>
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Run ID" span={2}>
          <Typography.Text copyable style={{ fontSize: 12 }}>{run.id}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Workflow ID">
          <Typography.Text copyable style={{ fontSize: 12 }}>{run.workflow_id}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={run.status === "success" ? "green" : run.status === "failed" ? "red" : "blue"}>
            {run.status}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {new Date(run.created_at).toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="完成时间">
          {run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}
        </Descriptions.Item>
        {run.error ? (
          <Descriptions.Item label="错误信息" span={2}>
            <Typography.Text type="danger" style={{ fontSize: 12 }}>{run.error}</Typography.Text>
          </Descriptions.Item>
        ) : null}
      </Descriptions>

      <Collapse
        size="small"
        defaultActiveKey={["io"]}
        items={[
          {
            key: "io",
            label: "输入 / 输出",
            children: (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Input</Typography.Text>
                  <JsonBlock data={run.input} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Output</Typography.Text>
                  <JsonBlock data={run.output} />
                </div>
              </div>
            )
          },
          {
            key: "logs",
            label: `节点执行日志（${loaded ? logs.length : "..."}条）`,
            children: loading ? (
              <Typography.Text type="secondary">加载中...</Typography.Text>
            ) : logs.length === 0 ? (
              <Typography.Text type="secondary">暂无日志</Typography.Text>
            ) : (
              <Table
                rowKey="id"
                dataSource={logs}
                size="small"
                pagination={false}
                scroll={{ y: 320 }}
                columns={[
                  {
                    title: "节点",
                    dataIndex: "node_id",
                    width: 160,
                    render: (v: string, row: RunLogItem) => (
                      <Space size={4}>
                        <Typography.Text strong style={{ fontSize: 12 }}>{v}</Typography.Text>
                        <Tag style={{ margin: 0, fontSize: 10 }}>{row.node_type}</Tag>
                      </Space>
                    )
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 80,
                    render: (s: string) => (
                      <Tag color={s === "success" ? "green" : s === "failed" ? "red" : "blue"}>{s}</Tag>
                    )
                  },
                  {
                    title: "耗时",
                    dataIndex: "duration_ms",
                    width: 80,
                    render: (v: number) => `${v}ms`
                  },
                  {
                    title: "输出",
                    dataIndex: "output",
                    render: (v: Record<string, unknown>) => (
                      <div style={{ maxHeight: 100, overflow: "auto" }}>
                        <JsonBlock data={v} />
                      </div>
                    )
                  }
                ]}
              />
            )
          }
        ]}
      />
    </div>
  );
}

export function RunHistoryPage() {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await listRunsPaginated({ page, page_size: pageSize, keyword, status_filter: statusFilter });
      setItems(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page, pageSize]);

  return (
    <div style={{ padding: 20 }}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          执行历史
        </Typography.Title>
        <Space style={{ marginBottom: 12 }}>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索 run_id" />
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            style={{ width: 140 }}
            options={[
              { value: "", label: "全部状态" },
              { value: "pending", label: "pending" },
              { value: "running", label: "running" },
              { value: "success", label: "success" },
              { value: "failed", label: "failed" }
            ]}
          />
          <Button
            onClick={() => {
              setPage(1);
              void load();
            }}
            loading={loading}
          >
            查询
          </Button>
        </Space>
        <Table
          rowKey="id"
          dataSource={items}
          loading={loading}
          expandable={{
            expandedRowRender: (record) => <RunDetailDrawer run={record} />,
            expandRowByClick: true
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            }
          }}
          columns={[
            {
              title: "Run ID",
              dataIndex: "id",
              width: 280,
              render: (v: string) => (
                <Typography.Text copyable style={{ fontSize: 12 }}>{v}</Typography.Text>
              )
            },
            {
              title: "Workflow ID",
              dataIndex: "workflow_id",
              width: 280,
              render: (v: string) => (
                <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text>
              )
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (status: string) => (
                <Tag color={status === "success" ? "green" : status === "failed" ? "red" : "blue"}>{status}</Tag>
              )
            },
            {
              title: "创建时间",
              dataIndex: "created_at",
              width: 180,
              render: (v: string) => new Date(v).toLocaleString()
            },
            {
              title: "操作",
              width: 80,
              render: () => (
                <Button type="link" size="small" icon={<EyeOutlined />}>
                  详情
                </Button>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}
