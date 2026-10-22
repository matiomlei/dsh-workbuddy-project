/** Actual compiled presets must be importable ESM specifiers on Windows as well as POSIX. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { nodeCapabilities, preflightPresetModules } from '../../lib/delivery/node-capabilities.mjs'
import { createStarter } from '../../lib/delivery/starter-template.mjs'
import { offlineCanvasCss } from '../../lib/delivery/offline-assets.mjs'
import { readFileSync } from 'node:fs'
const root=mkdtempSync(join(tmpdir(),'wb-plugin-urls-'))
try {
  const capabilities=await nodeCapabilities({root,compilerRoot:fileURLToPath(new URL('../../',import.meta.url)),libraries:[{name:'delivery-starter',path:fileURLToPath(new URL('../../examples/software-delivery/library',import.meta.url))}]})
  const starter=createStarter(capabilities)
  for(const binding of starter.definition.nodeBindings) {
    const preset=capabilities.preparePreset(binding,{id:'url-check-'+binding.nodeId,directory:join(root,binding.nodeId),cwd:root})
    for(const row of preset.plugins.filter(row=>row.id==='delivery-node-policy'||row.id.startsWith('connector-'))) {
      assert.equal(new URL(row.name).protocol,'file:')
      assert.ok(existsSync(fileURLToPath(row.name)))
    }
  }
  // Node interprets a raw drive letter as a URL scheme before checking the file.
  await assert.rejects(preflightPresetModules([{id:'missing-node-fixture',name:pathToFileURL(join(root,'missing.mjs')).href}]),error=>error.code==='NODE_PRESET_MODULE_LOAD_FAILED'&&error.message.includes('missing-node-fixture')&&error.message.includes('ERR_MODULE_NOT_FOUND'))
  const windowsPath='C:\\Users\\封闭机\\能力库 #1\\node-policy.mjs'
  await assert.rejects(import(windowsPath),{code:'ERR_UNSUPPORTED_ESM_URL_SCHEME'})
  const url=pathToFileURL(windowsPath,{windows:true})
  assert.equal(url.protocol,'file:');assert.match(url.href,/^file:\/\/\/C:\//);assert.ok(url.href.includes('%23'))
  const original=readFileSync(new URL('../../lib/vendor/dsh-ccpg-web/web-dist/assets/index-BMohP83o.css',import.meta.url),'utf8')
  assert.ok(original.includes('fonts.googleapis.com'))
  const css=offlineCanvasCss(original)
  assert.ok(!css.includes('fonts.googleapis.com')&&!css.includes('fonts.gstatic.com'))
  assert.ok(css.includes('.flow-node'))
  console.log('PASS four actual starter presets use file URLs for local ESM modules; Windows drive-letter import failure reproduced; served canvas CSS uses local font fallbacks')
}finally{rmSync(root,{recursive:true,force:true})}
