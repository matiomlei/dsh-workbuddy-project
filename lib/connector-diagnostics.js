/** Read-only handshake checks. Never return credentials or upstream response bodies. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

export function connectorProblem(error) {
  const errors=[],seen=new Set()
  const visit=value=>{if(!value||typeof value!=='object'||seen.has(value)||seen.size>20)return;seen.add(value);errors.push(value);visit(value.cause);for(const child of value.errors??[])visit(child)}
  visit(error)
  const has=predicate=>errors.some(predicate)
  if(has(e=>e.name==='UnauthorizedError'||e.status===401))return {code:'authorization-required',message:'服务要求账号授权（401）。请配置有效的 Bearer 凭据或已授权的 DSH 本地连接器；当前桥接器不自动发起 OAuth 登录。'}
  if(has(e=>e.status===403||e.name==='InsufficientScopeError'))return {code:'authorization-denied',message:'服务拒绝访问（403），请检查账号权限或令牌授权范围。'}
  const reset=errors.find(e=>['ECONNRESET','UND_ERR_SOCKET'].includes(e.code))
  if(reset)return {code:'connection-reset',message:`连接被中断（${reset.code}），请检查本机网络、代理或服务可用性。`}
  if(has(e=>['ENOTFOUND','EAI_AGAIN'].includes(e.code)))return {code:'dns-failed',message:'无法解析服务域名，请检查 DNS 与网络连接。'}
  if(has(e=>e.code==='ECONNREFUSED'))return {code:'connection-refused',message:'服务拒绝连接，请检查服务地址和端口。'}
  if(has(e=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','REQUEST_TIMEOUT'].includes(e.code)||['TimeoutError','AbortError'].includes(e.name)))return {code:'connection-timeout',message:'连接或工具发现超时，请检查网络、代理和服务响应。'}
  if(has(e=>['CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(e.code)))return {code:'tls-failed',message:'服务 TLS 证书校验失败，请检查证书及本机代理。'}
  const http=errors.find(e=>Number.isInteger(e.status)&&e.status>=400&&e.status<=599)
  if(http)return {code:`http-${http.status}`,message:`服务返回 HTTP ${http.status}，请检查连接器地址及服务状态。`}
  if(has(e=>e.code==='INVALID_TOOL_SCHEMA'||e.name==='JsonSchemaError'))return {code:'unsupported-tools',message:'服务已连接，但返回的工具定义不符合 DSH 支持的格式。'}
  return {code:'connection-failed',message:'连接或工具同步失败，请检查服务协议并查看宿主日志。'}
}

function resolveValue(value,missing) {
  return typeof value==='string'?value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(_match,name)=>{if(!process.env[name])missing.add(name);return process.env[name]??''}):value
}

export async function checkConnector(server,{timeoutMs=12000}={}) {
  const base={name:server.name,reference:server.connector,transport:server.transport},missing=new Set()
  const map=values=>Object.fromEntries(Object.entries(values??{}).map(([key,value])=>[key,resolveValue(value,missing)]))
  const config={...server,url:resolveValue(server.url,missing),command:resolveValue(server.command,missing),args:(server.args??[]).map(value=>resolveValue(value,missing)),headers:map(server.headers),env:map(server.env)}
  if(missing.size)return {...base,status:'error',code:'missing-environment',message:`宿主缺少环境变量：${[...missing].join('、')}。配置后重新加载宿主再检查。`}
  const signal=AbortSignal.timeout(timeoutMs),client=new Client({name:'dsh-connector-check',version:'1'},{capabilities:{}})
  const transport=config.transport==='stdio'
    ?new StdioClientTransport({command:config.command,args:config.args,env:{...scrubbedParentEnv(),...config.env},cwd:config.cwd})
    :new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers},fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([signal,init?.signal].filter(Boolean))})})
  try {
    await client.connect(transport,{signal,timeout:timeoutMs})
    const result=await client.listTools(undefined,{signal,timeout:timeoutMs,cacheMode:'refresh'})
    const names=new Set()
    for(const tool of result.tools) {
      if(names.has(tool.name))throw Object.assign(new Error('Duplicate tool'),{code:'INVALID_TOOL_SCHEMA'})
      names.add(tool.name)
      try {assertSupportedJsonSchema(tool.inputSchema)}catch {throw Object.assign(new Error('Invalid tool schema'),{code:'INVALID_TOOL_SCHEMA'})}
    }
    return {...base,status:'connected',tools:result.tools.length,message:`已完成握手与工具发现（${result.tools.length} 个工具）`}
  } catch(error) {return {...base,status:'error',...connectorProblem(signal.aborted?signal.reason:error)}}
  finally {await client.close().catch(()=>{});await transport.close().catch(()=>{})}
}
