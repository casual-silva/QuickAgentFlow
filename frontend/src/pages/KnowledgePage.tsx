import { useEffect, useMemo, useState } from "react";
import { BookOutlined, CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Input,
  List,
  Modal,
  Select,
  Slider,
  Space,
  Spin,
  Steps,
  Switch,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { Link } from "react-router-dom";
import {
  createKnowledgeBase,
  createKnowledgeChunk,
  deleteKnowledgeBase,
  deleteKnowledgeChunk,
  ingestKnowledgeFile,
  ingestKnowledgeText,
  listKnowledgeBases,
  listKnowledgeChunks,
  previewKnowledgeRetrieval,
  previewKnowledgeRetrievalAll,
  updateKnowledgeBase,
  updateKnowledgeChunk,
  type KnowledgeBaseItem,
  type KnowledgeChunkItem,
  type KnowledgeIngestResult,
  type KnowledgeRetrievalPreviewResponse
} from "../api/client";

export function KnowledgePage() {
  const [bases, setBases] = useState<KnowledgeBaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunkItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newChunkTitle, setNewChunkTitle] = useState("");
  const [newChunkBody, setNewChunkBody] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [testQuery, setTestQuery] = useState("");
  const [testTopK, setTestTopK] = useState(8);
  const [testPool, setTestPool] = useState(64);
  const [testRw, setTestRw] = useState({ keyword: 0.38, phrase: 0.37, title: 0.2, order: 0.05, dense: 0 });
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<KnowledgeRetrievalPreviewResponse | null>(null);
  const [kbEditing, setKbEditing] = useState<KnowledgeBaseItem | null>(null);
  const [kbEditName, setKbEditName] = useState("");
  const [kbEditDesc, setKbEditDesc] = useState("");
  const [chunkEditOpen, setChunkEditOpen] = useState(false);
  const [editingChunk, setEditingChunk] = useState<KnowledgeChunkItem | null>(null);
  const [chunkEditTitle, setChunkEditTitle] = useState("");
  const [chunkEditBody, setChunkEditBody] = useState("");
  const [chunkEditRefreshEmb, setChunkEditRefreshEmb] = useState(false);
  const [ingestText, setIngestText] = useState("");
  const [ingestTitlePrefix, setIngestTitlePrefix] = useState("");
  const [ingestChunkSize, setIngestChunkSize] = useState(480);
  const [ingestOverlap, setIngestOverlap] = useState(72);
  const [ingestMinChars, setIngestMinChars] = useState(20);
  const [ingestDedupe, setIngestDedupe] = useState(true);
  const [ingestEmbed, setIngestEmbed] = useState(true);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [lastIngest, setLastIngest] = useState<KnowledgeIngestResult | null>(null);
  const [drawerAddOpen, setDrawerAddOpen] = useState(false);
  const [drawerIngestOpen, setDrawerIngestOpen] = useState(false);
  const [drawerTestOpen, setDrawerTestOpen] = useState(false);
  const [chunkFilter, setChunkFilter] = useState("");
  const [retrievalScope, setRetrievalScope] = useState<"single" | "all">("single");
  const [resultFilter, setResultFilter] = useState("");

  async function loadBases() {
    setLoading(true);
    try {
      setBases(await listKnowledgeBases());
    } catch {
      message.error("加载知识库失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadChunks(kbId: string) {
    setChunksLoading(true);
    try {
      setChunks(await listKnowledgeChunks(kbId));
    } catch {
      message.error("加载文本块失败");
    } finally {
      setChunksLoading(false);
    }
  }

  useEffect(() => {
    void loadBases();
  }, []);

  useEffect(() => {
    if (selectedId) void loadChunks(selectedId);
    else setChunks([]);
  }, [selectedId]);

  useEffect(() => {
    setTestResult(null);
  }, [selectedId]);

  useEffect(() => {
    setChunkFilter("");
  }, [selectedId]);

  const filteredChunks = useMemo(() => {
    const q = chunkFilter.trim().toLowerCase();
    if (!q) return chunks;
    return chunks.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        (c.title || "").toLowerCase().includes(q) ||
        String(c.id).includes(q)
    );
  }, [chunks, chunkFilter]);

  const filteredBases = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return bases;
    return bases.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        (b.description || "").toLowerCase().includes(q)
    );
  }, [bases, listQuery]);

  async function onCreateKb() {
    const name = newKbName.trim();
    if (!name) {
      message.warning("请填写名称");
      return;
    }
    try {
      const kb = await createKnowledgeBase({ name, description: "" });
      message.success("已创建。打开任意工作流，在「知识库检索」节点属性里从下拉列表选择该库即可。");
      setNewKbName("");
      setBases((prev) => [kb, ...prev]);
      setSelectedId(kb.id);
    } catch {
      message.error("创建失败");
    }
  }

  async function onAddChunk() {
    if (!selectedId) return;
    const content = newChunkBody.trim();
    if (!content) {
      message.warning("请填写正文");
      return;
    }
    try {
      await createKnowledgeChunk(selectedId, { title: newChunkTitle.trim(), content: content });
      setNewChunkTitle("");
      setNewChunkBody("");
      message.success("已添加文本块");
      setDrawerAddOpen(false);
      await loadChunks(selectedId);
      await loadBases();
    } catch {
      message.error("添加失败");
    }
  }

  async function onDeleteChunk(id: number) {
    Modal.confirm({
      title: "删除该文本块？",
      onOk: async () => {
        try {
          await deleteKnowledgeChunk(id);
          message.success("已删除");
          if (selectedId) {
            await loadChunks(selectedId);
            await loadBases();
          }
        } catch {
          message.error("删除失败");
        }
      }
    });
  }

  function openKbEdit(e: React.MouseEvent, item: KnowledgeBaseItem) {
    e.stopPropagation();
    setKbEditing(item);
    setKbEditName(item.name);
    setKbEditDesc(item.description || "");
  }

  async function onSaveKbEdit() {
    if (!kbEditing) return;
    const name = kbEditName.trim();
    if (!name) {
      message.warning("名称不能为空");
      return;
    }
    try {
      const updated = await updateKnowledgeBase(kbEditing.id, { name, description: kbEditDesc });
      message.success("已更新知识库");
      setKbEditing(null);
      setBases((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
    } catch {
      message.error("更新失败");
    }
  }

  function onDeleteKb(e: React.MouseEvent, item: KnowledgeBaseItem) {
    e.stopPropagation();
    Modal.confirm({
      title: `删除知识库「${item.name}」？`,
      content: "将同时删除其下全部文本块，且无法恢复。",
      okType: "danger",
      onOk: async () => {
        try {
          await deleteKnowledgeBase(item.id);
          message.success("已删除");
          if (selectedId === item.id) setSelectedId(null);
          setKbEditing((k) => (k?.id === item.id ? null : k));
          await loadBases();
        } catch {
          message.error("删除失败");
        }
      }
    });
  }

  function openChunkEdit(c: KnowledgeChunkItem) {
    setEditingChunk(c);
    setChunkEditTitle(c.title || "");
    setChunkEditBody(c.content);
    setChunkEditRefreshEmb(false);
    setChunkEditOpen(true);
  }

  async function onSaveChunkEdit() {
    if (!editingChunk || !selectedId) return;
    const body = chunkEditBody.trim();
    if (!body) {
      message.warning("正文不能为空");
      return;
    }
    try {
      await updateKnowledgeChunk(editingChunk.id, {
        title: chunkEditTitle.trim(),
        content: body,
        refresh_embedding: chunkEditRefreshEmb
      });
      message.success("已保存");
      setChunkEditOpen(false);
      setEditingChunk(null);
      await loadChunks(selectedId);
      await loadBases();
    } catch {
      message.error("保存失败");
    }
  }

  async function runBatchIngest() {
    if (!selectedId) return;
    const t = ingestText.trim();
    if (!t) {
      message.warning("请粘贴长文本后再入库");
      return;
    }
    setIngestLoading(true);
    setLastIngest(null);
    try {
      const res = await ingestKnowledgeText(selectedId, {
        text: t,
        title_prefix: ingestTitlePrefix.trim(),
        chunk_size: ingestChunkSize,
        chunk_overlap: ingestOverlap,
        min_chunk_chars: ingestMinChars,
        dedupe: ingestDedupe,
        embed: ingestEmbed
      });
      setLastIngest(res);
      if (res.warnings?.length) {
        message.warning(res.warnings.join("；"));
      } else {
        message.success(
          `已写入 ${res.created_chunks} 条（过短跳过 ${res.skipped_short}，去重 ${res.skipped_duplicate}，向量成功 ${res.embedding_ok}）`
        );
      }
      setIngestText("");
      setDrawerIngestOpen(false);
      await loadChunks(selectedId);
      await loadBases();
    } catch {
      message.error("批量入库失败");
    } finally {
      setIngestLoading(false);
    }
  }

  function copyId(id: string) {
    void navigator.clipboard.writeText(id);
    message.success("已复制 ID（高级场景或 API 用）");
  }

  async function runRetrievalPreview() {
    const q = testQuery.trim();
    if (!q) {
      message.warning("请输入要测试的查询");
      return;
    }
    if (retrievalScope === "single" && !selectedId) {
      message.warning("请先选择一个知识库，或切换到全库检索");
      return;
    }
    setTestLoading(true);
    try {
      const req = {
        query: q,
        top_k: testTopK,
        recall_pool_size: testPool,
        rag_weights: testRw,
        include_score_breakdown: true,
        include_query_explain: true
      };
      const res =
        retrievalScope === "all"
          ? await previewKnowledgeRetrievalAll(req)
          : await previewKnowledgeRetrieval(String(selectedId), req);
      setTestResult(res);
      if (res.chunks.length === 0) {
        message.info("无命中（可检查分词是否与正文重叠，或调大召回池/权重）");
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      message.error(typeof detail === "string" ? detail : "检索预览失败");
      setTestResult(null);
    } finally {
      setTestLoading(false);
    }
  }

  const selectedBase = bases.find((b) => b.id === selectedId);

  return (
    <div style={{ padding: 20, overflow: "auto", height: "100%" }}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          <BookOutlined style={{ marginRight: 8 }} />
          知识库
        </Typography.Title>
        <Collapse
          size="small"
          ghost
          style={{ marginBottom: 12 }}
          items={[
            {
              key: "guide",
              label: <Typography.Text type="secondary">使用说明与快速指引（点击展开）</Typography.Text>,
              children: (
                <>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    这里用于维护面向用户可见的知识内容。建议按业务主题建库（如产品、FAQ、活动），并在工作流中按场景选择单库或全库检索。
                  </Typography.Paragraph>
                  <Steps
                    size="small"
                    style={{ maxWidth: 720 }}
                    items={[
                      { title: "创建知识库" },
                      { title: "添加文本块（右侧抽屉）" },
                      { title: <span>在 <Link to="/workflows">工作流</Link> 里拖「知识库检索」</span> }
                    ]}
                  />
                </>
              )
            }
          ]}
        />
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            style={{ width: 220 }}
            placeholder="新知识库名称"
            value={newKbName}
            onChange={(e) => setNewKbName(e.target.value)}
            onPressEnter={() => void onCreateKb()}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void onCreateKb()}>
            创建知识库
          </Button>
          <Button onClick={() => void loadBases()} loading={loading}>
            刷新列表
          </Button>
          <Button
            icon={<SearchOutlined />}
            onClick={() => {
              setRetrievalScope("all");
              setDrawerTestOpen(true);
            }}
          >
            全局检索测试
          </Button>
        </Space>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(360px, 1.15fr)", gap: 16 }}>
          <Card
            size="small"
            title="知识库列表"
            extra={<Tag color="blue">{bases.length} 个</Tag>}
          >
            <Input.Search
              allowClear
              placeholder="按名称或 ID 筛选"
              style={{ marginBottom: 12 }}
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
            />
            <List
              loading={loading}
              dataSource={filteredBases}
              locale={{ emptyText: listQuery.trim() ? "无匹配项" : "暂无知识库，请先创建" }}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: "pointer",
                    background: selectedId === item.id ? "#e6f4ff" : undefined,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: selectedId === item.id ? "1px solid #91caff" : "1px solid transparent"
                  }}
                  onClick={() => setSelectedId(item.id)}
                  actions={[
                    <Button
                      key="edit"
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => openKbEdit(e, item)}
                    >
                      编辑
                    </Button>,
                    <Button
                      key="del"
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => onDeleteKb(e, item)}
                    >
                      删除
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap size={4}>
                        <span>{item.name}</span>
                        <Tag>{item.chunk_count ?? 0} 条</Tag>
                        <Button
                          type="link"
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            copyId(item.id);
                          }}
                        >
                          复制 ID
                        </Button>
                      </Space>
                    }
                    description={
                      <Typography.Text type="secondary" style={{ fontSize: 11, wordBreak: "break-all" }}>
                        {item.id}
                      </Typography.Text>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
          <Card
            size="small"
            title={selectedBase ? `文本块 · ${selectedBase.name}` : "文本块"}
            extra={
              selectedBase != null ? (
                <Space wrap size={4} align="center">
                  <Tag color={chunks.length > 0 ? "success" : "default"}>{chunks.length} 条</Tag>
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setDrawerAddOpen(true)}>
                    添加单条
                  </Button>
                  <Button size="small" icon={<UploadOutlined />} onClick={() => setDrawerIngestOpen(true)}>
                    批量 / 文件
                  </Button>
                  <Button size="small" icon={<SearchOutlined />} onClick={() => setDrawerTestOpen(true)}>
                    检索测试
                  </Button>
                </Space>
              ) : null
            }
          >
            {!selectedId ? (
              <Typography.Text type="secondary">请从左侧选择一个知识库，再浏览或管理文本块。</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size={10}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  使用顶部按钮打开录入抽屉；下方为可滚动列表，支持本地筛选。
                </Typography.Text>
                <Input.Search
                  allowClear
                  placeholder="在当前库内按标题、正文或 id 筛选"
                  value={chunkFilter}
                  onChange={(e) => setChunkFilter(e.target.value)}
                />
                <div
                  style={{
                    maxHeight: "min(60vh, 520px)",
                    overflowY: "auto",
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    padding: "4px 0"
                  }}
                >
                  <List
                    loading={chunksLoading}
                    dataSource={filteredChunks}
                    locale={{
                      emptyText: chunkFilter.trim() ? "无匹配文本块" : "暂无文本块，点击「添加单条」或「批量 / 文件」"
                    }}
                    renderItem={(c) => (
                      <List.Item
                        style={{ alignItems: "flex-start", paddingLeft: 12, paddingRight: 12 }}
                        actions={[
                          <Button
                            key="edit"
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openChunkEdit(c)}
                          >
                            编辑
                          </Button>,
                          <Button
                            key="del"
                            type="link"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => void onDeleteChunk(c.id)}
                          >
                            删除
                          </Button>
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space wrap size={4}>
                              <span>{c.title || `块 #${c.id}`}</span>
                              {c.has_embedding ? <Tag color="green">向量</Tag> : null}
                            </Space>
                          }
                          description={
                            <Typography.Paragraph ellipsis={{ rows: 4 }} style={{ marginBottom: 0, fontSize: 12 }}>
                              {c.content}
                            </Typography.Paragraph>
                          }
                        />
                      </List.Item>
                    )}
                  />
                </div>
              </Space>
            )}
          </Card>
        </div>

        <Drawer
          title="添加单条文本块"
          width={440}
          open={drawerAddOpen && !!selectedId}
          onClose={() => setDrawerAddOpen(false)}
          destroyOnClose
          footer={
            <div style={{ textAlign: "right" }}>
              <Space>
                <Button onClick={() => setDrawerAddOpen(false)}>取消</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => void onAddChunk()}>
                  添加
                </Button>
              </Space>
            </div>
          }
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            标题可选；正文参与检索。适合单段补充，长文请用「批量 / 文件」抽屉。
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Input
              placeholder="标题（可选）"
              value={newChunkTitle}
              onChange={(e) => setNewChunkTitle(e.target.value)}
            />
            <Input.TextArea
              placeholder="正文（必填）"
              value={newChunkBody}
              onChange={(e) => setNewChunkBody(e.target.value)}
              rows={8}
            />
          </Space>
        </Drawer>

        <Drawer
          title="自动分块与文件入库"
          width={520}
          open={drawerIngestOpen && !!selectedId}
          onClose={() => setDrawerIngestOpen(false)}
          destroyOnClose
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            适合将长文自动切块后入库。开启向量化后可提升语义检索能力（耗时会增加）。
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap align="center">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                chunk_size
              </Typography.Text>
              <Input
                type="number"
                style={{ width: 72 }}
                min={80}
                max={8000}
                value={ingestChunkSize}
                onChange={(e) => setIngestChunkSize(Math.min(8000, Math.max(80, Number(e.target.value) || 480)))}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                overlap
              </Typography.Text>
              <Input
                type="number"
                style={{ width: 64 }}
                min={0}
                max={2000}
                value={ingestOverlap}
                onChange={(e) => setIngestOverlap(Math.min(2000, Math.max(0, Number(e.target.value) || 72)))}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                最短字数
              </Typography.Text>
              <Input
                type="number"
                style={{ width: 56 }}
                min={1}
                max={500}
                value={ingestMinChars}
                onChange={(e) => setIngestMinChars(Math.min(500, Math.max(1, Number(e.target.value) || 20)))}
              />
            </Space>
            <Space wrap>
              <Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  去重
                </Typography.Text>
                <Switch checked={ingestDedupe} onChange={setIngestDedupe} />
              </Space>
              <Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  向量化
                </Typography.Text>
                <Switch checked={ingestEmbed} onChange={setIngestEmbed} />
              </Space>
            </Space>
            <Input
              placeholder="块标题前缀（可选）"
              value={ingestTitlePrefix}
              onChange={(e) => setIngestTitlePrefix(e.target.value)}
            />
            <Input.TextArea
              placeholder="粘贴长文后点击「自动分块入库」"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              rows={8}
            />
            <Space wrap>
              <Button type="primary" loading={ingestLoading} onClick={() => void runBatchIngest()}>
                自动分块入库
              </Button>
              <Upload
                accept=".txt,.md,.markdown,.pdf"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  if (!selectedId) {
                    message.warning("请先选择知识库");
                    return Upload.LIST_IGNORE;
                  }
                  void (async () => {
                    setIngestLoading(true);
                    setLastIngest(null);
                    try {
                      const res = await ingestKnowledgeFile(selectedId, file, {
                        chunk_size: ingestChunkSize,
                        chunk_overlap: ingestOverlap,
                        min_chunk_chars: ingestMinChars,
                        dedupe: ingestDedupe,
                        embed: ingestEmbed,
                        title_prefix: ingestTitlePrefix.trim()
                      });
                      setLastIngest(res);
                      message.success(`文件已解析并入库 ${res.created_chunks} 条`);
                      if (res.warnings?.length) message.info(res.warnings.join("；"));
                      setDrawerIngestOpen(false);
                      await loadChunks(selectedId);
                      await loadBases();
                    } catch {
                      message.error("文件入库失败（检查格式是否为 txt/md/pdf）");
                    } finally {
                      setIngestLoading(false);
                    }
                  })();
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={ingestLoading}>
                  上传 txt / md / pdf
                </Button>
              </Upload>
            </Space>
            {lastIngest ? (
              <Typography.Paragraph type="secondary" style={{ fontSize: 11 }}>
                上次入库：新增 {lastIngest.created_chunks} 条，向量成功 {lastIngest.embedding_ok} / 失败{" "}
                {lastIngest.embedding_failed}
              </Typography.Paragraph>
            ) : null}
          </Space>
        </Drawer>

        <Drawer
          title={
            <Space>
              <SearchOutlined />
              <span>检索测试</span>
              <Tag color="processing">preview-retrieval</Tag>
            </Space>
          }
          width={Math.min(720, typeof window !== "undefined" ? window.innerWidth - 48 : 720)}
          open={drawerTestOpen}
          onClose={() => setDrawerTestOpen(false)}
          styles={{ body: { paddingBottom: 24 } }}
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
            与画布「知识库检索」节点同一套逻辑；<code>score_breakdown</code> 可追踪各路分数。
          </Typography.Paragraph>
          <div style={{ maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <Input.Search
                placeholder="输入测试查询，回车或点击检索"
                allowClear
                enterButton={<><SearchOutlined /> 检索</>}
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                onSearch={() => void runRetrievalPreview()}
                disabled={testLoading}
              />
              <Space wrap align="center">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  检索范围
                </Typography.Text>
                <Select
                  value={retrievalScope}
                  style={{ width: 180 }}
                  onChange={(v: "single" | "all") => setRetrievalScope(v)}
                  options={[
                    { label: "当前选中知识库", value: "single" },
                    { label: "全部知识库", value: "all" }
                  ]}
                />
              </Space>
              <Space wrap align="center">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  top_k
                </Typography.Text>
                <Input
                  type="number"
                  style={{ width: 72 }}
                  min={1}
                  max={50}
                  value={testTopK}
                  onChange={(e) => setTestTopK(Math.min(50, Math.max(1, Number(e.target.value) || 8)))}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  召回池
                </Typography.Text>
                <Input
                  type="number"
                  style={{ width: 72 }}
                  min={8}
                  max={200}
                  value={testPool}
                  onChange={(e) => setTestPool(Math.min(200, Math.max(8, Number(e.target.value) || 64)))}
                />
              </Space>
              <Collapse
                size="small"
                items={[
                  {
                    key: "w",
                    label: "路径权重（服务端会再归一化）",
                    children: (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        {(["keyword", "phrase", "title", "order", "dense"] as const).map((k) => {
                          const labels: Record<string, string> = {
                            keyword: "词法 keyword",
                            phrase: "短语 phrase",
                            title: "标题 title",
                            order: "顺序 order",
                            dense: "向量 dense"
                          };
                          return (
                            <div key={k}>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                {labels[k]}：{testRw[k].toFixed(2)}
                              </Typography.Text>
                              <Slider
                                min={0}
                                max={1}
                                step={0.01}
                                value={testRw[k]}
                                onChange={(v) => setTestRw((prev) => ({ ...prev, [k]: v }))}
                              />
                            </div>
                          );
                        })}
                      </Space>
                    )
                  }
                ]}
              />
              {testLoading ? (
                <div style={{ textAlign: "center", padding: 16 }}>
                  <Spin />
                </div>
              ) : null}
              {testResult ? (
                <>
                  <Divider orientation="left" plain style={{ margin: "8px 0" }}>
                    查询解析
                  </Divider>
                  {testResult.query_explain ? (
                    <Descriptions size="small" bordered column={1} style={{ marginBottom: 8 }}>
                      <Descriptions.Item label="token 列表">
                        <Space size={[4, 4]} wrap>
                          {(testResult.query_explain.tokens as string[] | undefined)?.map((t) => (
                            <Tag key={t}>{t}</Tag>
                          ))}
                        </Space>
                      </Descriptions.Item>
                      <Descriptions.Item label="最长中文子串（短语路）">
                        {String(testResult.query_explain.longest_cjk_substring ?? "—")}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : null}
                  <Divider orientation="left" plain style={{ margin: "8px 0" }}>
                    融合说明与元数据
                  </Divider>
                  <Typography.Paragraph style={{ fontSize: 12, marginBottom: 8 }}>
                    {testResult.fusion_summary}
                  </Typography.Paragraph>
                  <Descriptions size="small" bordered column={2}>
                    <Descriptions.Item label="库内总块数">
                      {String(testResult.retrieval?.total_chunks ?? "—")}
                    </Descriptions.Item>
                    <Descriptions.Item label="召回池条数">
                      {String(testResult.retrieval?.pool_ids_count ?? testResult.retrieval?.hit_count ?? "—")}
                    </Descriptions.Item>
                    <Descriptions.Item label="生效权重" span={2}>
                      <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(testResult.retrieval?.weights ?? {}, null, 2)}
                      </pre>
                    </Descriptions.Item>
                    {testResult.retrieval?.reason ? (
                      <Descriptions.Item label="未命中原因" span={2}>
                        {String(testResult.retrieval.reason)}
                      </Descriptions.Item>
                    ) : null}
                  </Descriptions>
                  <Divider orientation="left" plain style={{ margin: "12px 0 8px" }}>
                    命中列表（含 score_breakdown）
                  </Divider>
                  <Input.Search
                    allowClear
                    value={resultFilter}
                    onChange={(e) => setResultFilter(e.target.value)}
                    placeholder="按知识库、标题或内容筛选检索结果"
                  />
                  <List
                    size="small"
                    bordered
                    dataSource={testResult.chunks.filter((row) => {
                      const q = resultFilter.trim().toLowerCase();
                      if (!q) return true;
                      const kbName = String((row as Record<string, unknown>).knowledge_base_name || "").toLowerCase();
                      return (
                        String(row.title || "").toLowerCase().includes(q) ||
                        String(row.content || "").toLowerCase().includes(q) ||
                        kbName.includes(q)
                      );
                    })}
                    locale={{ emptyText: "无命中条目" }}
                    renderItem={(row, index) => (
                      <List.Item style={{ alignItems: "flex-start", flexDirection: "column" }}>
                        <Space wrap>
                          <Tag color="blue">#{index + 1}</Tag>
                          {(row as Record<string, unknown>).knowledge_base_name ? (
                            <Tag color="purple">{String((row as Record<string, unknown>).knowledge_base_name)}</Tag>
                          ) : null}
                          <Typography.Text strong>id {row.id}</Typography.Text>
                          <Typography.Text type="secondary">{row.title || "（无标题）"}</Typography.Text>
                          <Tag>融合分 {row.score}</Tag>
                        </Space>
                        <Typography.Paragraph
                          ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                          style={{ fontSize: 12, margin: "8px 0 0", width: "100%" }}
                        >
                          {row.content}
                        </Typography.Paragraph>
                        {row.score_breakdown ? (
                          <Collapse
                            size="small"
                            ghost
                            style={{ width: "100%", marginTop: 8 }}
                            items={[
                              {
                                key: "bd",
                                label: (
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    score_breakdown（原始分 / 归一化 / final）
                                  </Typography.Text>
                                ),
                                children: (
                                  <pre
                                    style={{
                                      fontSize: 11,
                                      margin: 0,
                                      padding: 8,
                                      background: "#fafafa",
                                      borderRadius: 6,
                                      overflow: "auto",
                                      maxHeight: 220
                                    }}
                                  >
                                    {JSON.stringify(row.score_breakdown, null, 2)}
                                  </pre>
                                )
                              }
                            ]}
                          />
                        ) : null}
                      </List.Item>
                    )}
                  />
                </>
              ) : null}
            </Space>
          </div>
        </Drawer>
        <Modal
          title="编辑知识库"
          open={kbEditing != null}
          onOk={() => void onSaveKbEdit()}
          onCancel={() => setKbEditing(null)}
          destroyOnClose
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              名称
            </Typography.Text>
            <Input value={kbEditName} onChange={(e) => setKbEditName(e.target.value)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              描述（可选）
            </Typography.Text>
            <Input.TextArea value={kbEditDesc} onChange={(e) => setKbEditDesc(e.target.value)} rows={3} />
          </Space>
        </Modal>
        <Modal
          title={editingChunk ? `编辑文本块 #${editingChunk.id}` : "编辑文本块"}
          open={chunkEditOpen}
          onOk={() => void onSaveChunkEdit()}
          onCancel={() => {
            setChunkEditOpen(false);
            setEditingChunk(null);
          }}
          width={720}
          destroyOnClose
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Input
              placeholder="标题（可选）"
              value={chunkEditTitle}
              onChange={(e) => setChunkEditTitle(e.target.value)}
            />
            <Input.TextArea
              placeholder="正文"
              value={chunkEditBody}
              onChange={(e) => setChunkEditBody(e.target.value)}
              rows={10}
            />
            <Space align="center">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                保存时重新生成向量（需 OPENAI_API_KEY）
              </Typography.Text>
              <Switch checked={chunkEditRefreshEmb} onChange={setChunkEditRefreshEmb} />
            </Space>
          </Space>
        </Modal>
      </Card>
    </div>
  );
}
