import { ReactNode, useMemo, useState } from "react";
import { Button, Layout, Menu, Typography } from "antd";
import { AppstoreOutlined, BookOutlined, BranchesOutlined, HistoryOutlined, HomeOutlined } from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router-dom";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith("/knowledge")) return "knowledge";
    if (location.pathname.startsWith("/templates")) return "templates";
    if (location.pathname.startsWith("/history")) return "history";
    return "workflows";
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: "100vh", display: "flex" }}>
      <Layout.Sider
        className="app-shell-sider"
        width={220}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onBreakpoint={(broken) => setCollapsed(broken)}
        breakpoint="lg"
        theme="light"
        style={{ borderRight: "1px solid #f0f0f0" }}
      >
        <div className="app-shell-brand">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{
                width: 28,
                height: 28,
                borderRadius: 9,
                background: "linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)",
                position: "relative",
                boxShadow: "0 6px 14px rgba(37,99,235,0.25)"
              }}
            >
              <span
                style={{
                  position: "absolute",
                  width: 12,
                  height: 3,
                  borderRadius: 999,
                  background: "#fff",
                  top: 9,
                  left: 7,
                  transform: "rotate(24deg)"
                }}
              />
              <span
                style={{
                  position: "absolute",
                  width: 12,
                  height: 3,
                  borderRadius: 999,
                  background: "#fff",
                  top: 15,
                  left: 9,
                  transform: "rotate(-24deg)"
                }}
              />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0, lineHeight: 1.15, color: "#0f172a", fontWeight: 700 }}>
                QuickFlow
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Workflow Studio
              </Typography.Text>
            </div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(`/${key}`)}
          style={{ marginTop: 0 }}
          items={[
            { key: "workflows", icon: <BranchesOutlined />, label: "工作流" },
            { key: "knowledge", icon: <BookOutlined />, label: "知识库" },
            { key: "templates", icon: <AppstoreOutlined />, label: "模板库" },
            { key: "history", icon: <HistoryOutlined />, label: "执行历史" }
          ]}
        />
      </Layout.Sider>
      <Layout style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <Layout.Header
          className="app-shell-header"
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "nowrap",
            gap: 12,
            boxSizing: "border-box",
            height: 64,
            minHeight: 64,
            padding: "0 16px",
            lineHeight: 1.25
          }}
        >
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
            <Typography.Text style={{ color: "#0f172a", fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>
              企业级 AI 工作流编排平台
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.25 }}>
              支持可视化编排、知识检索、模板复用与稳定运行观测
            </Typography.Text>
          </div>
          <Link to="/workflows">
            <Button type="default" icon={<HomeOutlined />} style={{ borderRadius: 10, height: 34, paddingInline: 12 }}>
              返回主页
            </Button>
          </Link>
        </Layout.Header>
        <Layout.Content
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            padding: 0
          }}
        >
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
