/** Preserve actionable startup failures when the preset registry flattens error causes. */
import { Config, apply as applyBridge } from '@deepseek-ai/dsh-mcp-client'
import { connectorProblem } from './connector-diagnostics.js'
export { Config }
export const name='workbuddy-connector-client'
export const inject=['tools']
export async function apply(ctx,config) {
  try {await applyBridge(ctx,config)}
  catch(error) {throw new Error(`连接器 ${config.serverName}：${connectorProblem(error).message}`,{cause:error})}
}
