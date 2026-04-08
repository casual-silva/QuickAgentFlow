"""节点类型元数据目录（供 GET /api/node-types）；与 MCP 工具目录分离。

config_fields 定义每个节点类型的可配置参数（widget 决定前端控件类型），
output_schema 声明节点执行后的常见输出字段（用于变量 picker 静态补全）。
"""

from typing import Any, Dict, List

from ..integrations.mcp.catalog import list_mcp_tools_public

# widget 类型约定:
#   text         — 单行输入
#   template     — 支持 {{}} 变量引用的 TemplateInput
#   number       — 数值输入 / Slider
#   select       — 下拉选择（需配合 options）
#   switch       — 开关
#   key_value    — 键值对编辑器（如 output_mapping / variables）
#   mcp_select   — MCP 工具多选（从 /api/mcp/tools 拉取）
#   mcp_params   — 根据选中工具的 parameters schema 动态渲染
#   custom       — 前端有专用组件，目录仅提供元信息
#   model_list   — 多模型列表输入（逗号分隔或标签）

BASE_NODE_TYPES: List[Dict[str, Any]] = [
    {
        "type": "global",
        "label": "Global Context",
        "category": "基础",
        "description": "定义全局变量，作为 Trigger 初始上下文",
        "config_fields": [
            {"key": "variables", "label": "全局变量", "widget": "key_value", "group": "main"},
        ],
        "output_schema": {"variables": "object"},
    },
    {
        "type": "start",
        "label": "Start",
        "category": "基础",
        "description": "流程起始节点（兼容保留）",
        "config_fields": [],
        "output_schema": {"accepted_input": "object"},
    },
    {
        "type": "trigger",
        "label": "Trigger",
        "category": "基础",
        "description": "工作流触发器（例如 chat message）",
        "config_fields": [
            {"key": "trigger_type", "label": "触发类型", "widget": "text", "default": "chat", "group": "main"},
        ],
        "output_schema": {"accepted_input": "object", "triggered": "boolean"},
    },
    {
        "type": "agent",
        "label": "AI Agent",
        "category": "AI 模型",
        "description": "支持 ReAct/单次汇总两种策略；可配置迭代上限；MCP 工具多选来自 /api/mcp/tools；上游 HTTP/工具输出默认并入上下文",
        "config_fields": [
            {"key": "agent_strategy", "label": "Agent 策略", "widget": "select", "default": "react", "group": "模型",
             "options": [{"value": "react", "label": "ReAct（推理-行动）"}, {"value": "single_pass", "label": "单次汇总"}]},
            {"key": "model", "label": "模型", "widget": "text", "default": "gpt-4o-mini", "group": "模型"},
            {"key": "system_prompt", "label": "系统提示词", "widget": "template", "default": "", "group": "提示词"},
            {"key": "query_template", "label": "任务输入模板", "widget": "template", "default": "{{input.query}}", "group": "提示词"},
            {"key": "max_iterations", "label": "最大迭代次数", "widget": "number", "default": 6, "min": 1, "max": 20, "group": "模型",
             "visible_when": {"key": "agent_strategy", "eq": "react"}},
            {"key": "use_memory", "label": "注入会话记忆", "widget": "switch", "default": False, "group": "记忆与工具"},
            {"key": "memory_key", "label": "记忆字段名", "widget": "text", "default": "history", "group": "记忆与工具",
             "visible_when": {"key": "use_memory", "eq": True}},
            {"key": "use_mcp_tools", "label": "调用 MCP 工具", "widget": "switch", "default": False, "group": "记忆与工具"},
            {"key": "mcp_tool_names", "label": "MCP 工具", "widget": "mcp_select", "default": [], "group": "记忆与工具",
             "visible_when": {"key": "use_mcp_tools", "eq": True}},
            {"key": "mcp_parameters_mapping", "label": "工具参数映射", "widget": "mcp_params", "default": {}, "group": "记忆与工具",
             "visible_when": {"key": "use_mcp_tools", "eq": True}},
        ],
        "output_schema": {"summary": "string", "strategy": "string", "iteration_count": "number", "react_steps": "array"},
    },
    {
        "type": "llm",
        "label": "LLM Model",
        "category": "AI 模型",
        "description": "调用大模型",
        "config_fields": [
            {"key": "model_name", "label": "模型名", "widget": "text", "default": "gpt-4o-mini", "group": "模型与采样"},
            {"key": "temperature", "label": "Temperature", "widget": "number", "default": 0.2,
             "min": 0, "max": 2, "step": 0.1, "group": "模型与采样"},
            {"key": "system_prompt", "label": "系统提示词", "widget": "template", "default": "", "group": "提示词模板"},
            {"key": "user_prompt", "label": "用户提示模板", "widget": "template", "default": "{{input.query}}", "group": "提示词模板"},
        ],
        "output_schema": {"message": "string", "model_name": "string"},
    },
    {
        "type": "llm_compare",
        "label": "多模型对比",
        "category": "AI 模型",
        "description": "并行调用多个模型，对同一 Prompt 输出结果对比",
        "config_fields": [
            {"key": "model_names", "label": "模型列表（逗号分隔）", "widget": "text", "default": "gpt-4o-mini,gpt-4o", "group": "模型"},
            {"key": "temperature", "label": "Temperature", "widget": "number", "default": 0.2,
             "min": 0, "max": 2, "step": 0.1, "group": "模型"},
            {"key": "system_prompt", "label": "系统提示词", "widget": "template", "default": "", "group": "提示词"},
            {"key": "user_prompt", "label": "用户提示模板", "widget": "template", "default": "{{input.query}}", "group": "提示词"},
        ],
        "output_schema": {"results": "array", "model_count": "number"},
    },
    {
        "type": "knowledge_retrieve",
        "label": "知识库检索",
        "category": "工具",
        "description": "多路召回（词法/短语/标题/顺序/可选向量 dense）+ 加权融合重排；输出含 retrieval 与各条 score_breakdown",
        "config_fields": [
            {"key": "knowledge_base_id", "label": "知识库", "widget": "custom", "default": "", "group": "main"},
            {"key": "query_template", "label": "查询模板", "widget": "template", "default": "{{input.query}}", "group": "main"},
            {"key": "top_k", "label": "返回条数", "widget": "number", "default": 5, "min": 1, "max": 50, "group": "main"},
            {"key": "recall_pool_size", "label": "召回池大小", "widget": "number", "default": 64, "min": 8, "max": 200, "group": "多路召回"},
            {"key": "rag_weights", "label": "路径权重", "widget": "custom", "default": {}, "group": "多路召回"},
            {"key": "include_score_breakdown", "label": "输出分项分数", "widget": "switch", "default": True, "group": "多路召回"},
        ],
        "output_schema": {"chunks": "array", "query": "string", "knowledge_base_id": "string", "retrieval": "object"},
    },
    {
        "type": "set_fields",
        "label": "Set 字段",
        "category": "逻辑",
        "description": "n8n 风格：将键值（支持 {{}} 模板）写入 output.fields，整形 JSON 管道",
        "config_fields": [
            {"key": "assignments", "label": "字段赋值", "widget": "key_value", "template_value": True, "default": {}, "group": "main"},
        ],
        "output_schema": {"fields": "object"},
    },
    {
        "type": "group",
        "label": "分组（容器）",
        "category": "基础",
        "description": "画布视觉分组；执行时占位透传，可连入 DAG 但不改数据",
        "config_fields": [],
        "output_schema": {"passthrough": "boolean", "note": "string"},
    },
    {
        "type": "memory",
        "label": "Memory",
        "category": "工具",
        "description": "读取会话记忆或历史上下文",
        "config_fields": [
            {"key": "memory_key", "label": "记忆字段名", "widget": "text", "default": "history", "group": "main"},
        ],
        "output_schema": {"memory": "array", "memory_key": "string"},
    },
    {
        "type": "http",
        "label": "HTTP 请求",
        "category": "工具",
        "description": "GET/POST；URL、请求头与正文支持 {{}} 模板；仅 http/https；超时与响应体截断由后端约束",
        "config_fields": [
            {"key": "method", "label": "方法", "widget": "select", "default": "GET",
             "options": [{"value": "GET", "label": "GET"}, {"value": "POST", "label": "POST"}], "group": "main"},
            {"key": "url", "label": "URL", "widget": "template", "default": "", "group": "main"},
            {"key": "headers", "label": "请求头", "widget": "key_value", "template_value": True, "default": {}, "group": "main"},
            {"key": "body", "label": "请求体（POST）", "widget": "template", "default": "", "group": "main"},
            {"key": "timeout_sec", "label": "超时（秒）", "widget": "number", "default": 30, "min": 1, "max": 120, "group": "main"},
        ],
        "output_schema": {
            "status_code": "number",
            "headers": "object",
            "text": "string",
            "json": "object",
            "url_final": "string",
        },
    },
    {
        "type": "tool",
        "label": "Tool（MCP）",
        "category": "工具",
        "description": "调用 MCP 目录中的工具（GET /api/mcp/tools）；通用 HTTP 请用「HTTP 请求」节点",
        "config_fields": [
            {"key": "tool_name", "label": "工具名", "widget": "mcp_select_single", "default": "", "group": "main"},
            {"key": "parameters_mapping", "label": "参数映射", "widget": "mcp_params", "default": {"query": "{{input.query}}", "top_k": 3}, "group": "main"},
        ],
        "output_schema": {"tool": "string", "data": "object"},
    },
    {
        "type": "if",
        "label": "If",
        "category": "逻辑",
        "description": "条件分支",
        "config_fields": [
            {"key": "condition", "label": "条件配置", "widget": "custom", "group": "main"},
        ],
        "output_schema": {"route": "string"},
    },
    {
        "type": "condition",
        "label": "Condition",
        "category": "逻辑",
        "description": "条件分支（兼容旧版）",
        "config_fields": [
            {"key": "condition", "label": "条件配置", "widget": "custom", "group": "main"},
        ],
        "output_schema": {"route": "string"},
    },
    {
        "type": "switch",
        "label": "Switch",
        "category": "逻辑",
        "description": "多路分支（与 If 同构，边上使用 label 表示 case）",
        "config_fields": [
            {"key": "condition", "label": "条件配置", "widget": "custom", "group": "main"},
        ],
        "output_schema": {"route": "string"},
    },
    {
        "type": "loop",
        "label": "Loop",
        "category": "逻辑",
        "description": "循环迭代：对指定数组逐元素处理",
        "config_fields": [
            {"key": "array_path", "label": "数组路径", "widget": "text", "default": "input.items", "group": "main"},
            {"key": "max_iterations", "label": "最大迭代次数", "widget": "number", "default": 10, "min": 1, "group": "main"},
        ],
        "output_schema": {"items": "array", "results": "array", "iteration_count": "number"},
    },
    {
        "type": "split_in_batches",
        "label": "Split in Batches",
        "category": "逻辑",
        "description": "将数组按批次大小拆分处理",
        "config_fields": [
            {"key": "array_path", "label": "数组路径", "widget": "text", "default": "input.items", "group": "main"},
            {"key": "batch_size", "label": "批次大小", "widget": "number", "default": 5, "min": 1, "group": "main"},
        ],
        "output_schema": {"batches": "array", "batch_count": "number", "total_items": "number"},
    },
    {
        "type": "parallel",
        "label": "Parallel",
        "category": "逻辑",
        "description": "并行网关占位（Send/Map 编排后续版本完善）",
        "config_fields": [],
        "output_schema": {"note": "string", "upstream_count": "number"},
    },
    {
        "type": "delay",
        "label": "等待",
        "category": "逻辑",
        "description": "阻塞等待指定毫秒（0–120000），用于节流或与外部系统时序对齐",
        "config_fields": [
            {"key": "duration_ms", "label": "等待毫秒", "widget": "number", "default": 1000, "min": 0, "max": 120000, "group": "main"},
        ],
        "output_schema": {"waited_ms": "number"},
    },
    {
        "type": "action",
        "label": "Action",
        "category": "工具",
        "description": "执行动作节点（如消息发送/HTTP回调）",
        "config_fields": [
            {"key": "action_type", "label": "动作类型", "widget": "select", "default": "send_message",
             "options": [{"value": "send_message", "label": "发送消息"}, {"value": "http_callback", "label": "HTTP 回调"}],
             "group": "main"},
            {"key": "template", "label": "内容模板", "widget": "template", "default": "", "group": "main"},
        ],
        "output_schema": {"action": "string", "content": "string"},
    },
    {
        "type": "code",
        "label": "Code",
        "category": "工具",
        "description": "代码执行节点（V0 仅占位）",
        "config_fields": [
            {"key": "source", "label": "代码", "widget": "text", "default": "", "group": "main"},
        ],
        "output_schema": {"result": "string"},
    },
    {
        "type": "end",
        "label": "End",
        "category": "基础",
        "description": "工作流输出节点",
        "config_fields": [
            {"key": "output_mapping", "label": "输出映射", "widget": "key_value", "template_value": True, "group": "main"},
        ],
        "output_schema": {"final": "object"},
    },
]

_OUTPUT_SCHEMA_BY_TYPE: Dict[str, Dict[str, str]] = {
    item["type"]: item.get("output_schema", {}) for item in BASE_NODE_TYPES
}


def get_output_schema(node_type: str) -> Dict[str, str]:
    """获取节点类型的静态输出字段声明。"""
    return dict(_OUTPUT_SCHEMA_BY_TYPE.get(node_type, {}))


def list_tools() -> List[Dict[str, Any]]:
    """兼容 GET /api/node-types/tools；等价于 GET /api/mcp/tools。"""
    return list_mcp_tools_public()


def list_node_types() -> List[Dict[str, Any]]:
    return [dict(item) for item in BASE_NODE_TYPES]


def supported_node_types() -> List[str]:
    return [item["type"] for item in BASE_NODE_TYPES]
