import { useEffect, useState } from "react";
import { Button, Card, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { createWorkflow, deleteWorkflow, listWorkflows } from "../api/client";
import type { WorkflowItem } from "../types/workflow";

export function WorkflowListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  async function load() {
    setLoading(true);
    try {
      setItems(await listWorkflows());
    } finally {
      setLoading(false);
    }
  }

  async function createDefault() {
    const item = await createWorkflow({
      name: newName.trim() || `新建工作流-${Date.now()}`,
      description: "全新空白流程，请从 Trigger 节点开始搭建",
      status: "draft",
      graph: {
        entry: "trigger_1",
        nodes: [
          {
            id: "global_1",
            type: "global",
            position: { x: 120, y: 80 },
            data: { label: "GLOBAL CONTEXT", variables: { user_id: "", system_prompt: "" } }
          },
          { id: "trigger_1", type: "trigger", position: { x: 120, y: 200 }, data: { label: "When chat message received", trigger_type: "chat" } }
        ],
        edges: []
      }
    });
    setCreateOpen(false);
    setNewName("");
    navigate(`/workflows/${item.id}`);
  }

  async function onDeleteWorkflow(id: string) {
    try {
      await deleteWorkflow(id);
      message.success("工作流已删除");
      await load();
    } catch {
      message.error("删除失败，请检查后端接口");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            工作流列表
          </Typography.Title>
          <Space>
            <Button onClick={load} loading={loading}>
              刷新
            </Button>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建工作流
            </Button>
          </Space>
        </Space>
        <Table
          rowKey="id"
          dataSource={items}
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (_, row: WorkflowItem) => <Link to={`/workflows/${row.id}`}>{row.name}</Link>
            },
            { title: "描述", dataIndex: "description" },
            {
              title: "状态",
              dataIndex: "status",
              width: 120,
              render: (value: string) => <Tag color={value === "published" ? "green" : "blue"}>{value}</Tag>
            },
            {
              title: "更新时间",
              dataIndex: "updated_at",
              width: 200,
              render: (value: string) => new Date(value).toLocaleString()
            },
            {
              title: "操作",
              width: 120,
              render: (_, row: WorkflowItem) => (
                <Popconfirm title="确认删除该工作流？" okText="删除" cancelText="取消" onConfirm={() => void onDeleteWorkflow(row.id)}>
                  <Button danger size="small">
                    删除
                  </Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </Card>
      <Modal
        title="新建工作流"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void createDefault()}
      >
        <Input placeholder="输入工作流名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </Modal>
    </div>
  );
}
