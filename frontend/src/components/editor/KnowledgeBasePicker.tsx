import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Input, Select, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listKnowledgeBases, type KnowledgeBaseItem } from "../../api/client";

type Props = {
  /** 当前选中的知识库 UUID */
  value: string;
  onChange: (knowledgeBaseId: string) => void;
};

/**
 * 知识库选择器：从后端动态拉取列表，支持搜索；仅一个库时自动选中。
 * 高级模式可粘贴 ID，与多环境/迁移场景兼容。
 */
export function KnowledgeBasePicker({ value, onChange }: Props) {
  const [bases, setBases] = useState<KnowledgeBaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualId, setManualId] = useState(value);
  /** 每个节点实例仅自动选「唯一库」一次，避免用户清空后又被强制写回 */
  const didAutoPickRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listKnowledgeBases();
      setBases(data);
    } catch {
      setBases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 与外部 value 同步（例如撤销/加载工作流）
  useEffect(() => {
    setManualId(value);
  }, [value]);

  useEffect(() => {
    if (value.trim()) return;
    if (bases.length !== 1) return;
    if (didAutoPickRef.current) return;
    didAutoPickRef.current = true;
    onChange(bases[0].id);
  }, [bases, value, onChange]);

  const options = bases.map((b) => ({
    value: b.id,
    label: `${b.name} · ${b.chunk_count} 条文本`
  }));

  const selectedValid = value.trim() && bases.some((b) => b.id === value);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={10}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        从列表选择已创建的知识库；无数据时请先到{" "}
        <Link to="/knowledge">知识库</Link> 新建并添加文本块。
      </Typography.Text>

      {bases.length === 0 && !loading ? (
        <Alert
          type="warning"
          showIcon
          message="还没有知识库"
          description="创建知识库并添加至少一段正文后，再回到此处选择。"
        />
      ) : null}

      <Space.Compact style={{ width: "100%" }}>
        <Select
          showSearch
          allowClear
          placeholder="搜索名称并选择知识库…"
          style={{ flex: 1, minWidth: 0 }}
          value={selectedValid ? value : undefined}
          loading={loading}
          options={options}
          optionFilterProp="label"
          notFoundContent={loading ? <Spin size="small" /> : "无匹配项"}
          onChange={(v) => onChange(typeof v === "string" ? v : "")}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} title="刷新列表" />
      </Space.Compact>

      {value.trim() && !selectedValid ? (
        <Typography.Text type="warning" style={{ fontSize: 11 }}>
          当前 ID 在列表中不存在（可能已删除）；请重新选择或用手动模式修正。
        </Typography.Text>
      ) : null}

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: "manual",
            label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>高级：手动填写知识库 ID</Typography.Text>,
            children: (
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onBlur={() => {
                  if (manualId.trim() !== value.trim()) {
                    onChange(manualId.trim());
                  }
                }}
                placeholder="粘贴 UUID"
              />
            )
          }
        ]}
      />
    </Space>
  );
}
