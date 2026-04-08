import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, List, Modal, Pagination, Space, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { applyTemplate, deleteTemplate, listTemplatesPaginated, updateTemplate } from "../api/client";
import type { TemplateItem } from "../types/workflow";

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await listTemplatesPaginated({ page, page_size: pageSize, keyword: keyword.trim() || undefined });
      setTemplates(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  async function apply(item: TemplateItem) {
    try {
      const workflow = await applyTemplate(item.id, {
        name: newWorkflowName.trim() || `${item.name}-实例`,
        status: "draft"
      });
      message.success("模板已应用为新工作流");
      navigate(`/workflows/${workflow.id}`);
    } catch {
      message.error("应用模板失败");
    }
  }

  useEffect(() => {
    void load();
  }, [page, pageSize]);

  async function onSearch() {
    if (page !== 1) {
      setPage(1);
      return;
    }
    await load();
  }

  function openEdit(item: TemplateItem) {
    setEditing(item);
    setEditName(item.name);
    setEditDesc(item.description || "");
  }

  async function onSaveEdit() {
    if (!editing) return;
    if (!editName.trim()) {
      message.warning("模板名称不能为空");
      return;
    }
    try {
      await updateTemplate(editing.id, { name: editName.trim(), description: editDesc.trim() });
      message.success("模板已更新");
      setEditing(null);
      await load();
    } catch {
      message.error("模板更新失败");
    }
  }

  function onDelete(item: TemplateItem) {
    Modal.confirm({
      title: `删除模板「${item.name}」？`,
      content: "删除后不可恢复，但不影响由它创建出的工作流。",
      okType: "danger",
      onOk: async () => {
        try {
          await deleteTemplate(item.id);
          message.success("模板已删除");
          if (templates.length === 1 && page > 1) {
            setPage((p) => p - 1);
          } else {
            await load();
          }
        } catch {
          message.error("模板删除失败");
        }
      }
    });
  }

  const listHeader = useMemo(
    () => (
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => void onSearch()}
          placeholder="按模板名称或描述搜索"
          style={{ width: 280 }}
        />
        <Input
          value={newWorkflowName}
          onChange={(e) => setNewWorkflowName(e.target.value)}
          placeholder="应用后工作流名称（可选）"
          style={{ width: 260 }}
        />
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Space>
    ),
    [keyword, newWorkflowName, loading]
  );

  return (
    <div style={{ padding: 20 }}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          模板库
        </Typography.Title>
        {listHeader}
        <List
          loading={loading}
          dataSource={templates}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <>
                    {item.name} <Tag color="green">可用</Tag>
                  </>
                }
                description={
                  <div>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      {item.description || "无描述"}
                    </Typography.Paragraph>
                    <div style={{ height: 180, border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
                      <ReactFlow
                        nodes={item.graph.nodes.map((n) => ({ ...n, data: { label: String(n.data?.label || n.type) } })) as any}
                        edges={item.graph.edges.map((e, idx) => ({ id: `e_${idx}`, ...e })) as any}
                        fitView
                        panOnDrag={false}
                        zoomOnScroll={false}
                        zoomOnPinch={false}
                        zoomOnDoubleClick={false}
                        nodesDraggable={false}
                        nodesConnectable={false}
                      >
                        <Background />
                        <Controls showInteractive={false} />
                      </ReactFlow>
                    </div>
                  </div>
                }
              />
              <Space direction="vertical">
                <Button type="primary" onClick={() => void apply(item)}>
                  使用模板
                </Button>
                <Button icon={<EditOutlined />} onClick={() => openEdit(item)}>
                  更新
                </Button>
                <Button danger icon={<DeleteOutlined />} onClick={() => onDelete(item)}>
                  删除
                </Button>
              </Space>
            </List.Item>
          )}
        />
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[6, 8, 12, 20]}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
            showTotal={(t) => `共 ${t} 条`}
          />
        </div>
      </Card>
      <Modal
        title={editing ? `更新模板：${editing.name}` : "更新模板"}
        open={editing != null}
        onCancel={() => setEditing(null)}
        onOk={() => void onSaveEdit()}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="模板名称" />
          <Input.TextArea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="模板描述（可选）" rows={4} />
        </Space>
      </Modal>
    </div>
  );
}
