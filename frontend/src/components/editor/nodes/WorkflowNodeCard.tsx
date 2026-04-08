import { useEffect, useState, type ReactNode } from "react";
import {
  ApiOutlined,
  ApartmentOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  CompressOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  RetweetOutlined,
  RobotOutlined,
  SplitCellsOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { Handle, Position, type NodeProps } from "reactflow";

type AgentRuntimeStatus = "idle" | "thinking" | "executing_tool";

type ExecutionChrome = "success" | "failed" | "running";

const BRAND_BLUE = "#0066FF";

function BaseCard({
  icon,
  title,
  selected,
  pulse,
  tone,
  executionChrome,
  compactCapsule,
  children
}: {
  icon?: ReactNode;
  title: string;
  selected?: boolean;
  pulse?: boolean;
  tone?: "default" | "agent";
  executionChrome?: ExecutionChrome;
  /** Agent 等节点使用更扁的胶囊轮廓 */
  compactCapsule?: boolean;
  children?: ReactNode;
}) {
  const borderColor = tone === "agent" ? "rgba(123, 97, 255, 0.45)" : "rgba(0, 0, 0, 0.08)";
  const chromeBorder =
    executionChrome === "failed"
      ? `1.5px solid #ff4d4f`
      : executionChrome === "success"
        ? `1.5px solid #52c41a`
        : executionChrome === "running"
          ? `1.5px solid ${BRAND_BLUE}`
          : undefined;
  const radius = compactCapsule ? 20 : 8;
  return (
    <div
      className={`workflow-node-card${tone === "agent" ? " workflow-node-card--agent" : ""}`}
      style={{
        minWidth: compactCapsule ? 132 : 148,
        borderRadius: radius,
        border: selected ? `1.5px solid ${BRAND_BLUE}` : chromeBorder || `1px solid ${borderColor}`,
        background: tone === "agent" ? "linear-gradient(180deg, #faf9ff 0%, #ffffff 100%)" : "linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)",
        boxShadow: pulse
          ? `0 0 0 4px rgba(0,102,255,.18), 0 6px 16px rgba(0,102,255,.12)`
          : selected
            ? "0 1px 3px rgba(0,102,255,.12), 0 4px 12px rgba(0,0,0,.06)"
            : "0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04)",
        padding: compactCapsule ? "6px 12px" : "6px 10px",
        transition: "box-shadow .2s, border-color .2s"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22 }}>
        {icon ? (
          <span style={{ color: tone === "agent" ? "#6b5ce6" : "#64748b", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
            {icon}
          </span>
        ) : null}
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            lineHeight: 1.25,
            color: "#1e293b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function getNodeIcon(type?: string) {
  switch (type) {
    case "global":
      return <ApartmentOutlined />;
    case "trigger":
    case "start":
    case "end":
      return <PlayCircleOutlined />;
    case "llm":
      return <RobotOutlined />;
    case "llm_compare":
      return <ExperimentOutlined />;
    case "tool":
      return <ApiOutlined />;
    case "http":
      return <LinkOutlined />;
    case "memory":
      return <DatabaseOutlined />;
    case "if":
    case "condition":
    case "switch":
      return <BranchesOutlined />;
    case "loop":
      return <RetweetOutlined />;
    case "split_in_batches":
      return <SplitCellsOutlined />;
    case "parallel":
      return <CompressOutlined />;
    case "delay":
      return <ClockCircleOutlined />;
    case "agent":
      return <ThunderboltOutlined />;
    default:
      return <ApartmentOutlined />;
  }
}

export function GenericFlowNode(props: NodeProps<{ label?: string; subtitle?: string }>) {
  const pulseToken = Number((props.data as { __runtimePulseToken?: number } | undefined)?.__runtimePulseToken || 0);
  const executionChrome = (props.data as { __executionChrome?: ExecutionChrome } | undefined)?.__executionChrome;
  const lineageDuration = (props.data as { __lineageDuration?: number } | undefined)?.__lineageDuration;
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!pulseToken) return;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 800);
    return () => window.clearTimeout(timer);
  }, [pulseToken]);

  return (
    <div style={{ position: "relative" }}>
      <BaseCard
        icon={getNodeIcon(props.type)}
        title={props.data?.label || props.type || "Node"}
        selected={props.selected}
        pulse={pulse}
        executionChrome={executionChrome}
      >
        <Handle type="target" position={Position.Left} className="workflow-node-handle workflow-node-handle--left" />
        <Handle type="source" position={Position.Right} className="workflow-node-handle workflow-node-handle--right" />
      </BaseCard>
      {executionChrome && lineageDuration !== undefined ? (
        <div className={`node-lineage-badge${executionChrome === "success" ? " has-data" : ""}`}>{lineageDuration}ms</div>
      ) : null}
    </div>
  );
}

export function AgentFlowNode(props: NodeProps<{ label?: string; subtitle?: string }>) {
  const executionChrome = (props.data as { __executionChrome?: ExecutionChrome } | undefined)?.__executionChrome;
  const runtimeStatus = String(
    (props.data as { __agentRuntimeStatus?: AgentRuntimeStatus } | undefined)?.__agentRuntimeStatus || "idle"
  ) as AgentRuntimeStatus;
  const statusShort =
    runtimeStatus === "executing_tool" ? "工具" : runtimeStatus === "thinking" ? "思考" : null;

  return (
    <BaseCard
      icon={getNodeIcon("agent")}
      title={props.data?.label || "Agent"}
      selected={props.selected}
      tone="agent"
      executionChrome={executionChrome}
      compactCapsule
    >
      {statusShort ? (
        <span
          className="agent-node-status-pill"
          style={{
            display: "inline-block",
            marginTop: 4,
            fontSize: 10,
            fontWeight: 500,
            color: "#6b5ce6",
            background: "rgba(107, 92, 230, 0.1)",
            borderRadius: 6,
            padding: "1px 6px",
            lineHeight: 1.4
          }}
        >
          {statusShort}
        </span>
      ) : null}
      <Handle type="target" position={Position.Left} className="workflow-node-handle workflow-node-handle--left" />
      <Handle type="source" position={Position.Right} className="workflow-node-handle workflow-node-handle--right" />
    </BaseCard>
  );
}
