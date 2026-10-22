/** One tool contract for the template editor and the per-node Agent. */
import { ContractError } from "./template-store.mjs";
export const BASE_TOOLS = [
  { name: "read", description: "读取本次运行仓库中的文件。" },
  { name: "write", description: "创建或修改本次运行仓库中的文件。" },
  {
    name: "skill",
    description: "加载节点绑定的 Skill 或专家、MCP 包附带的 Skill。",
  },
  { name: "bash", description: "在本次运行工作目录执行构建、测试和其他命令。" },
];
export function resolveNodeTools(available, requested = [], mcpPrefixes = []) {
  const all = new Set(available),
    base = new Set(BASE_TOOLS.map((item) => item.name));
  const mcp = available.filter((name) =>
    mcpPrefixes.some((prefix) => name.startsWith(prefix)),
  );
  if (
    !Array.isArray(requested) ||
    requested.some(
      (name) => !all.has(name) || (!base.has(name) && !mcp.includes(name)),
    )
  ) {
    throw new ContractError(
      "NODE_TOOL_UNAVAILABLE",
      "节点包含当前不可用的工具，请在节点能力配置中重新选择基础工具。MCP 工具随绑定的连接器自动提供。",
    );
  }
  const selected = requested.length
    ? requested.filter((name) => base.has(name))
    : [...base].filter((name) => all.has(name));
  return [...new Set([...selected, ...mcp])];
}
