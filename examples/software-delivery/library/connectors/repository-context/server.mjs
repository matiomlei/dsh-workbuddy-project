/** Dependency-free, read-only MCP for the current delivery node's Git worktree. */
import { createInterface } from 'node:readline'
import { realpathSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative, sep, extname, isAbsolute } from 'node:path'
const root = realpathSync(process.env.WORKBUDDY_WORKSPACE || process.cwd())
const excluded = /^(?:\.git|node_modules|\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials?|secrets?|.*\.(?:pem|key|p12|pfx))$/i
function pathFor(input) {
  if (typeof input !== 'string' || input.split(/[\\/]/).some(part => excluded.test(part))) throw new Error('该路径不提供给仓库上下文工具')
  const path = realpathSync(resolve(root, input)), rel = relative(root, path)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('路径必须位于当前运行仓库中')
  if (rel.split(sep).some(part => excluded.test(part))) throw new Error('该路径不提供给仓库上下文工具')
  return path
}
function summary() {
  const files = [], pending = [{dir:root,depth:0}]
  while (pending.length && files.length < 500) {
    const {dir,depth} = pending.shift()
    for (const entry of readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || excluded.test(entry.name)) continue
      const path = resolve(dir,entry.name)
      if (entry.isDirectory()) { if(depth < 3) pending.push({dir:path,depth:depth+1}) }
      else if(entry.isFile()) files.push(relative(root,path).split(sep).join('/'))
      if(files.length >= 500) break
    }
  }
  return { files, truncated: files.length >= 500, access:'read-only', note:'文件位于本节点独立工作树；报告写入 .delivery/outputs，测试执行使用受 DSH 策略约束的 bash。' }
}
function readDocument(input) {
  const path = pathFor(input.path), stat = statSync(path)
  if(!stat.isFile() || stat.size > 65536) throw new Error('只读取不超过 64 KB 的文本文件')
  if(!/^(?:\.(?:md|txt|json|ya?ml|[cm]?js|tsx?|py|go|rs|java|css|html|toml|xml|sql|sh|ps1)|)$/i.test(extname(path))) throw new Error('不支持该文件类型')
  const text = readFileSync(path,'utf8')
  if(text.includes('\0')) throw new Error('不读取二进制文件')
  return {path:input.path,text}
}
const tools = [
 {name:'workspace_summary',description:'列出本节点运行仓库的文件，了解现有代码、测试及已交接报告。只读，不执行命令。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'read_document',description:'读取当前运行仓库中的小型文本或代码文件；不读取凭据及仓库外文件。',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
]
async function handle(message) {
  if(message.id === undefined) return
  let result
  switch(message.method) {
    case 'initialize': result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'delivery-repository-context',version:'1.0.0'}};break
    case 'ping': result={};break
    case 'tools/list': result={tools};break
    case 'tools/call':
      try {
        const value = message.params.name === 'workspace_summary' ? summary() : message.params.name === 'read_document' ? readDocument(message.params.arguments??{}) : (()=>{throw new Error('未知工具')})()
        result={content:[{type:'text',text:JSON.stringify(value)}]}
      } catch(error) {result={isError:true,content:[{type:'text',text:error.message}]}}
      break
    default: return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}}
  }
  return {jsonrpc:'2.0',id:message.id,result}
}
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  try {const answer=await handle(JSON.parse(line)); if(answer) process.stdout.write(JSON.stringify(answer)+'\n')}
  catch {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n')}
}
