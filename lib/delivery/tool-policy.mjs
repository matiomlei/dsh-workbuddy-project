/** Native rc3 tools exposed to workflow nodes; shell names remain portable. */
import { ContractError } from './template-store.mjs';
const FILE_TOOLS = [
  {name:'read',description:'DSH 原生文件读取。'},
  {name:'write',description:'DSH 原生文件写入。'},
  {name:'edit',description:'DSH 原生精确文本编辑。'},
  {name:'read_image',description:'DSH 原生图片读取。'},
  {name:'glob',description:'DSH 原生文件名搜索。'},
  {name:'grep',description:'DSH 原生文件内容搜索。'},
  {name:'skill',description:'加载节点绑定的技能和专家附带技能。'},
];
const JOB_TOOLS = ['job_output','job_list','job_kill'];
export function nativeToolCatalog(platform = process.platform) {
  const shell=platform==='win32'?'pwsh':'bash';
  return [...FILE_TOOLS,{name:shell,description:`DSH 原生命令工具（${shell==='pwsh'?'Windows PowerShell':'Bash'}），自动提供后台任务查询和停止工具。`}];
}
export const BASE_TOOLS = nativeToolCatalog();
export function isNodeToolName(name) {
  return [...FILE_TOOLS.map(item=>item.name),'bash','pwsh','shell',...JOB_TOOLS].includes(name);
}
export function resolveNodeTools(available, requested = [], mcpPrefixes = [], platform = process.platform) {
  const all=new Set(available), shell=platform==='win32'?'pwsh':'bash';
  const mcp=available.filter(name=>mcpPrefixes.some(prefix=>name.startsWith(prefix)));
  const normalize=name=>['bash','pwsh','shell'].includes(name)?shell:name;
  const names=Array.isArray(requested)?requested.map(normalize):[];
  if(!Array.isArray(requested)||names.some(name=>!all.has(name)||(!isNodeToolName(name)&&!mcp.includes(name))))
    throw new ContractError('NODE_TOOL_UNAVAILABLE','节点包含当前不可用的原生工具，请重新选择工具。命令工具随运行系统自动切换，MCP 工具由绑定的连接器提供。');
  const selected=names.length?names.filter(isNodeToolName):nativeToolCatalog(platform).map(item=>item.name).filter(name=>all.has(name));
  if(selected.includes(shell))selected.push(...JOB_TOOLS.filter(name=>all.has(name)));
  return [...new Set([...selected,...mcp])];
}
