import { Alert, Button, Collapse, List, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import { useWorkflowStore } from "../../store/workflowStore";
import { collectReadinessIssues } from "../../utils/workflowReadiness";

export function WorkflowReadinessPanel() {
  const { nodes, edges, setSelectedNode } = useWorkflowStore();
  const issues = useMemo(() => collectReadinessIssues(nodes, edges), [nodes, edges]);
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  const ok = errors.length === 0;

  return (
    <Collapse
      bordered={false}
      defaultActiveKey={[]}
      style={{ marginTop: 12, background: "#fff", borderRadius: 8 }}
      expandIconPosition="end"
      items={[
        {
          key: "readiness",
          label: (
            <Space wrap size="small">
              <Typography.Text strong>可运行性体检</Typography.Text>
              <Tag color={ok ? "green" : "red"}>{ok ? "可运行" : "存在阻断项"}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {errors.length} 个错误 · {warns.length} 个提示
              </Typography.Text>
            </Space>
          ),
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              {!ok ? (
                <Alert type="error" showIcon message="请先修复错误后再运行（保存时后端也会校验）" />
              ) : warns.length > 0 ? (
                <Alert type="warning" showIcon message="存在提示项，流程仍可尝试运行" />
              ) : (
                <Alert type="success" showIcon message="当前图配置满足基本运行条件" />
              )}
              {issues.length > 0 ? (
                <List
                  size="small"
                  dataSource={issues}
                  renderItem={(item) => (
                    <List.Item
                      actions={
                        item.nodeId
                          ? [
                              <Button type="link" size="small" key="sel" onClick={() => setSelectedNode(item.nodeId!)}>
                                选中节点
                              </Button>
                            ]
                          : []
                      }
                    >
                      <Tag color={item.severity === "error" ? "red" : "gold"}>{item.severity === "error" ? "错误" : "提示"}</Tag>
                      {item.message}
                      {item.edgeIds && item.edgeIds.length > 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                          环上边 id：{item.edgeIds.join(", ")}
                        </Typography.Text>
                      ) : null}
                    </List.Item>
                  )}
                />
              ) : (
                <Typography.Text type="secondary">暂无检查项</Typography.Text>
              )}
            </Space>
          )
        }
      ]}
    />
  );
}
