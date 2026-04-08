import type { RunItem } from "../../types/workflow";

export function RunPanel({ run }: { run: RunItem | null }) {
  return (
    <div style={{ height: 56, borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", padding: "0 12px", gap: 12 }}>
      <strong>运行状态:</strong>
      <span>{run ? run.status : "未运行"}</span>
      {run?.error ? <span style={{ color: "#dc2626" }}>错误: {run.error}</span> : null}
    </div>
  );
}
