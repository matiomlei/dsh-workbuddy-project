import Schema from '@deepseek-ai/schemastery'
import { Config as BridgeConfig, apply as applyBridge } from './connector-client.js'
import { localMcpConfig } from './local-runtime.js'
export const name = 'workbuddy-local-connector'
export const inject = ['tools']
export const Config = Schema.object({source:Schema.string().required()})
export async function apply(ctx,config) {
  await applyBridge(ctx,BridgeConfig({...localMcpConfig(ctx,config.source),failOnStartupError:true}))
}
