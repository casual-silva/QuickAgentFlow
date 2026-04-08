import { create } from "zustand";
import type { McpToolEntry, NodeTypeSpec } from "../api/client";
import { listMcpTools, listNodeTypes } from "../api/client";

interface NodeTypeSpecState {
  specs: NodeTypeSpec[];
  mcpTools: McpToolEntry[];
  loaded: boolean;
  /** 拉取节点目录与 MCP 工具列表；幂等，重复调用直接返回 */
  fetch: () => Promise<void>;
  /** 按 type 获取 output_schema（静态输出字段声明） */
  getOutputSchema: (type: string) => Record<string, string>;
  /** 按 type 获取完整 spec */
  getSpec: (type: string) => NodeTypeSpec | undefined;
  /** 按工具名获取 MCP 工具元数据 */
  getMcpTool: (name: string) => McpToolEntry | undefined;
}

export const useNodeTypeSpecs = create<NodeTypeSpecState>((set, get) => ({
  specs: [],
  mcpTools: [],
  loaded: false,

  fetch: async () => {
    if (get().loaded) return;
    try {
      const [types, tools] = await Promise.all([listNodeTypes(), listMcpTools()]);
      set({ specs: types, mcpTools: tools, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  getOutputSchema: (type: string) => {
    const spec = get().specs.find((s) => s.type === type);
    return (spec?.output_schema ?? {}) as Record<string, string>;
  },

  getSpec: (type: string) => get().specs.find((s) => s.type === type),

  getMcpTool: (name: string) => get().mcpTools.find((t) => t.name === name),
}));
