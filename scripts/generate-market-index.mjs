import { readFileSync, writeFileSync } from 'node:fs'

// Run from the standalone plugin repository after committing the release.
const [repository, commit, output = 'index.json'] = process.argv.slice(2)
if (!repository || !/^[0-9a-f]{40}$/.test(commit ?? '')) {
  throw new Error('Usage: node scripts/generate-market-index.mjs https://git.example.com/team/plugin.git <40-character-commit> [output.json]')
}
const url = new URL(repository)
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/(?:[^/]+\/)+[^/]+$/.test(url.pathname)) {
  throw new Error('Repository must be an HTTPS Git URL without credentials, query or fragment')
}
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!manifest.dsh?.bundle?.patch || !manifest.engines?.dsh) throw new Error('Package must declare dsh.bundle.patch and engines.dsh')
const timestamp = process.env.SOURCE_DATE_EPOCH === undefined ? Math.floor(Date.now() / 1000) : Number(process.env.SOURCE_DATE_EPOCH)
if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('SOURCE_DATE_EPOCH must be Unix seconds')
const index = {
  format: 1,
  title: { en: 'Internal DSH Plugins', zh: '内网 DSH 插件市场' },
  plugins: [{
    name: manifest.name,
    title: { en: 'DSH WorkBuddy Project', zh: '项目与能力库' },
    description: { en: manifest.description, zh: '管理项目、专家、技能、规范和连接器，支持共享能力库。' },
    repository: { url: repository.replace(/\.git$/, '') },
    metadata: { keywords: manifest.keywords ?? [] },
    versions: [{
      version: manifest.version,
      publishTimestamp: timestamp,
      source: { type: 'git', url: repository, commit },
      engines: { dsh: manifest.engines.dsh },
    }],
  }],
}
writeFileSync(output, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' })
console.log(`Created ${output}; publish it at an HTTP(S) URL that returns JSON directly.`)
