/**
 * The preset compiler: one project becomes one agent preset.
 *
 * `agent.cordis.yml` is a pure function of the project configuration plus the
 * bundled skeleton, so `project_apply` can always reproduce it. The skeleton is
 * a snapshot of the shipped `standard` composition's model-facing rows; a DSH
 * upgrade that adds an agent-plane row does not reach an existing project until
 * this file's {@link SKELETON_VERSION} is raised with it.
 *
 * Experts have two delivery modes. The project's **first** expert is written
 * into the persona, so its perspective and method are always present. Every
 * further expert becomes an **expert card** — a generated `SKILL.md` bundle the
 * model loads on demand — because a static composition owns exactly one persona
 * section and stacking every expert into it would pay for all of them on every
 * request. Expert-team packages use the same single-entry behavior.
 *
 * @module dsh-workbuddy-project/compile
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bundleHash,
  instructionsText,
  librariesOf,
  libraryRevision,
  ruleTexts,
  skillDirs,
} from './project.js'
import { emitYaml, RawYaml } from './yaml.js'
import { readExpert, resolveExpertProject } from './expert.js'
import { snapshotProject, savePackageLock } from './package-cache.js'

/** Version of the bundled skeleton below; record it so drift is visible. */
export const SKELETON_VERSION = 3

/** Where the plugin's preset template came from, for diagnostics. */
export const SKELETON_SOURCE = 'dsh-web-app/presets/standard.patch.yml'

/** Generated on-demand expert cards live under this preset-relative directory. */
export const EXPERT_CARDS_DIR = 'expert-cards'

/** Persona bytes above which `project_apply` reports a budget warning. */
export const PERSONA_WARN_BYTES = 32768

const PLAN_MODE_SECTION = `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, abort and ask the user to switch modes manually; do not proceed with implementation.`

/**
 * Read every project input once and split the experts by delivery mode.
 * @param project - a normalized project.
 * @returns the resolved inputs.
 */
export function projectModel(project) {
  const experts = project.experts.map((reference) => readExpert(reference, project))
  const effective = resolveExpertProject(project, experts)
  const inlineCount = Math.min(1, experts.length)
  return {
    project: effective,
    instructions: instructionsText(project),
    rules: ruleTexts(project),
    experts,
    inline: experts.slice(0, inlineCount),
    onDemand: experts.slice(inlineCount),
  }
}

/** The skill name one on-demand expert card registers under. */
function cardSkillName(expert, index, taken) {
  let slug = expert.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (slug === '') slug = String(index + 1)
  let name = `expert-${slug}`
  let suffix = 2
  while (taken.has(name)) {
    name = `expert-${slug}-${suffix}`
    suffix += 1
  }
  taken.add(name)
  return name
}

/**
 * One expert card: the expert's methodology as a loadable skill bundle.
 * @param name - the skill name.
 * @param expert - the resolved expert.
 * @returns the `SKILL.md` text.
 */
function skillDocument(name, expert) {
  const frontmatter = emitYaml({
    name,
    description: `专家：${expert.name} —— 该领域的视角、判断标准与方法论。`,
    whenToUse: `当任务需要「${expert.name}」的专业视角或按该领域惯例推进时加载。`,
  }).trimEnd()
  const notice = expert.skills?.length || expert.connectors?.length ? '\n\n此卡仅加载专家方法论。要使用该专家绑定的技能/连接器，请在项目配置中将其设为主专家并新建会话。' : ''
  return `---\n${frontmatter}\n---\n\n${expert.text}${notice}\n`
}

/**
 * The persona sections, in prompt order, with per-section byte counts.
 *
 * @param project - a normalized project.
 * @param model - resolved project inputs; re-read when omitted.
 * @returns `{ sections, text, bytes }`.
 */
export function personaSections(project, model = projectModel(project)) {
  const sections = []

  const header = [`# 项目：${project.name}`]
  if (project.description !== undefined) header.push(`项目定位：${project.description}`)
  if (model.instructions !== undefined) {
    header.push('以下项目指令适用于本会话的每一项任务。', model.instructions)
  }
  sections.push({ title: '项目总纲', text: header.join('\n\n') })

  if (model.rules.length > 0) {
    const body = model.rules
      .map((rule, index) => `## 规范 ${index + 1}（${rule.reference}）\n\n${rule.text}`)
      .join('\n\n')
    sections.push({
      title: '项目规范',
      text: `# 项目规范\n\n以下规范是硬性约束，适用于本会话的每一项任务，不得自行放宽。\n\n${body}`,
    })
  }

  for (const expert of model.inline) {
    sections.push({ title: `专家：${expert.name}`, text: `# 专家角色：${expert.name}\n\n${expert.text}` })
  }

  const cliConnectors=(model.project.connectorPackages??[]).filter(bundle=>bundle.connectorType==='cli')
  if(cliConnectors.length) {
    const lines=cliConnectors.map(bundle=>`- ${bundle.displayName??bundle.name}：${join(bundle.path,'cli.json')}`)
    sections.push({title:'CLI 连接器',text:`# CLI 连接器\n\n以下连接器通过本机终端调用。使用前读取其 cli.json 和附带技能，确认命令与授权要求；包的选中状态不代表本机已安装或已登录。\n\n${lines.join('\n')}`})
  }

  const taken = new Set()
  const cards = model.onDemand.map((expert, index) => ({
    expert,
    skill: cardSkillName(expert, index, taken),
  }))
  if (cards.length > 0) {
    const lines = []
    if (cards.length > 0) {
      lines.push('本项目还配置了以下**可召唤专家**。它们不在你的人设里，需要其专业判断时用 `skill` 工具加载对应专家卡，加载后按该专家的方法推进：')
      for (const card of cards) lines.push(`- \`${card.skill}\` —— ${card.expert.name}`)
    }
    sections.push({ title: '按需专家', text: `# 按需专家\n\n${lines.join('\n')}` })
  }

  const withBytes = sections.map((section) => ({ ...section, bytes: Buffer.byteLength(section.text, 'utf8') }))
  const text = `${withBytes.map((section) => section.text).join('\n\n')}\n`
  return { sections: withBytes, text, bytes: Buffer.byteLength(text, 'utf8'), cards }
}

/**
 * The project's persona prefix.
 * @param project - a normalized project.
 * @param model - resolved project inputs; re-read when omitted.
 * @returns the persona prefix text.
 */
export function personaPrefix(project, model) {
  return personaSections(project, model).text
}

/**
 * Compile one project into its preset composition rows.
 * @param project - a normalized project.
 * @param options - `presetDir` locates the generated expert cards; `model`
 *   reuses already-read inputs; `cardsDir` overrides the card location.
 * @returns the row array written to `agent.cordis.yml`.
 */
export function buildComposition(project, options = {}) {
  const model = options.model ?? projectModel(project)
  const persona = personaSections(project, model)
  const needsCards = model.onDemand.length > 0
  const cardsDir = options.cardsDir ?? (options.presetDir === undefined ? undefined : join(options.presetDir, EXPERT_CARDS_DIR))
  if (needsCards && cardsDir === undefined) {
    throw new Error('compile: on-demand experts need a presetDir or cardsDir to hold their generated expert cards')
  }
  project = model.project
  const customSkillDirs = [...skillDirs(project)]
  if (needsCards) customSkillDirs.push(cardsDir)

  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: {
        prefix: persona.text,
      },
    },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    {
      id: 'skill-filesystem',
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: 'project',
        includeDefaultRoots: false,
        customSkillDirs,
      },
    },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    ...project.connectorServers.map((server) => ({
      id: `connector-${server.name}`,
      name: fileURLToPath(new URL(server.localSource ? './connector-local.js' : './connector-client.js', import.meta.url)),
      config: mcpConfig(server),
    })),
    ...skeleton(),
  ]
}

/**
 * The model-facing rows every project session gets: the `standard` skeleton
 * minus the host-plane registries, which stay in the host composition.
 * @returns the row array.
 */
function skeleton() {
  return [
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
    { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
    {
      id: 'planning',
      name: 'cordis:group',
      group: true,
      isolate: { planMode: true },
      config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_MODE_SECTION } }],
    },
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: {
            provider: 'spawn',
            toolName: 'subagent',
            modelSelectionSettings: true,
            backgroundMode: 'continuable',
          },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'continuable' },
        },
        { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
        { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
        { id: 'tool-ralph', name: '@deepseek-ai/dsh-tool-ralph', config: { subagentProvider: 'spawn', maxRounds: 64 } },
      ],
    },
    {
      id: 'compaction',
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        {
          id: 'tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
  ]
}

/**
 * One MCP client row. `${VAR}` placeholders in env/header values are resolved
 * from the harness process environment at compile time; an unresolved name
 * yields an empty string, which the bridge reports as a connection failure
 * rather than showing a literal `${VAR}` to the server.
 * @param server - a normalized MCP server entry.
 * @returns the row config.
 */
function mcpConfig(server) {
  if (server.localSource) return { source: server.localSource }
  const mapped = (values) => Object.fromEntries(Object.entries(values??{}).map(([key,value])=>[key,variableValue(value)]))
  const base = { serverName:server.name,transport:server.transport,failOnStartupError:true,
    ...(server.timeout===undefined?{}:{toolCallTimeoutMs:server.timeout}) }
  return server.transport === 'stdio'
    ? {...base,command:variableValue(server.command),args:server.args.map(variableValue),env:mapped(server.env),cwd:server.cwd}
    : {...base,url:variableValue(server.url),headers:mapped(server.headers)}
}

const TEMPLATE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu

/**
 * Turn one configured value into what the compiled preset should carry.
 *
 * A literal stays a literal. A value naming environment variables becomes a
 * `!!js` expression the Loader evaluates when the preset is composed, so a
 * secret is never written into `agent.cordis.yml` — which matters as soon as
 * the project's configuration is committed to git — and rotating a token needs
 * no recompile.
 *
 * @param text - the authored value.
 * @returns the literal, or a raw `!!js` expression.
 */
function variableValue(text) {
  const matches = [...text.matchAll(TEMPLATE)]
  if (!matches.length) return text
  const parts = []
  let cursor = 0
  for (const match of matches) {
    if (match.index > cursor) parts.push(JSON.stringify(text.slice(cursor, match.index)))
    parts.push(`(process.env.${match[1]} ?? "")`)
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push(JSON.stringify(text.slice(cursor)))
  // Literal fragments are JS strings, never executable template interpolation.
  return new RawYaml(`!!js '${parts.join(' + ').replaceAll("'", "''")}'`)
}

/**
 * The content id of every element this preset was compiled from.
 *
 * A shared element is keyed by its library and library-relative path, a
 * project-local one by its path under the working directory. The ids are git
 * blob ids (a skill bundle's is one digest over its sorted files), so they match
 * what `git hash-object` reports and differ the moment a checkout is edited
 * locally — which is the honest per-element version, without inventing numbers.
 *
 * @param project - a normalized project.
 * @param model - the resolved project inputs.
 * @returns `{ '<library|local>:<path>': '<content id>' }`.
 */
export function elementHashes(project, model) {
  const out = {}
  for (const expert of model.experts) out[expert.reference] = bundleHash(expert.path).hash
  for (const rule of model.rules) out[rule.reference] = bundleHash(rule.path).hash
  for (const reference of project.skills) out[reference] = bundleHash(skillDirs({...project,skills:[reference],attachedSkillDirs:[]})[0]).hash
  for (const connector of model.project.connectorPackages) if (!connector.native) out[connector.reference] = bundleHash(connector.path).hash
  return out
}

/**
 * The preset display metadata for one project.
 *
 * `libraryCommits` is provenance: it records which revision of each shared
 * resource library this preset was compiled from, so "the session used the old
 * team rules" stops being a guess. Reading it needs no git binary.
 * `sourcePreset` records the same fact for a preset compiled from a team
 * definition, naming the library and the definition file it came from.
 *
 * @param project - a normalized project.
 * @returns the `preset.yml` document.
 */
export function buildPresetMetadata(project) {
  const parts = []
  if (project.description !== undefined) parts.push(project.description)
  const capabilities = []
  if (project.experts.length > 0) capabilities.push(`${project.experts.length} 专家`)
  if (project.rules.length > 0) capabilities.push(`${project.rules.length} 规范`)
  capabilities.push(`${project.skills.length} 技能`)
  if (project.connectors.length > 0) capabilities.push(`${project.connectors.length} 连接器`)
  parts.push(`DSH WorkBuddy Project 项目 · ${capabilities.join(' · ')}`)

  const libraryCommits = {}
  for (const entry of librariesOf(project)) {
    if (!entry.exists) continue
    const revision = libraryRevision(entry.path)
    if (revision !== undefined) libraryCommits[entry.name] = revision
  }
  const model = projectModel(project)
  const elements = elementHashes(model.project, model)
  return {
    name: project.name,
    description: parts.join(' — '),
    ...(Object.keys(libraryCommits).length === 0 ? {} : { libraryCommits }),
    ...(Object.keys(elements).length === 0 ? {} : { elements }),
  }
}

/**
 * Write one project's compiled preset into the harness projects root.
 *
 * Regenerating the expert cards from scratch is deliberate: an expert removed
 * from `project.json` must not survive as a stale loadable skill.
 *
 * @param project - a normalized project.
 * @param projectsRoot - absolute harness projects root.
 * @param options - `write: false` compiles without touching disk (preview).
 * @returns the compiled artifact paths, metrics, and (for a preview) the text.
 */
export function compileProject(project, projectsRoot, options = {}) {
  const write = options.write !== false
  const snapshot = snapshotProject(project,{write,refresh:options.refresh===true})
  project = snapshot.project
  const dir = join(projectsRoot, project.id)
  const model = projectModel(project)
  const persona = personaSections(project, model)
  const cardsDir = join(dir, EXPERT_CARDS_DIR)
  const compositionPath = join(dir, 'agent.cordis.yml')
  const metadataPath = join(dir, 'preset.yml')
  const composition = emitYaml(buildComposition(project, { model, presetDir: dir }))
  const metadata = emitYaml(buildPresetMetadata(project))

  const metrics = {
    personaBytes: persona.bytes,
    personaOverBudget: persona.bytes > PERSONA_WARN_BYTES,
    sections: persona.sections.map((section) => ({ title: section.title, bytes: section.bytes })),
    expertsInline: model.inline.map((expert) => expert.name),
    expertsOnDemand: persona.cards.map((card) => ({ expert: card.expert.name, skill: card.skill })),
    rules: model.rules.map((rule) => rule.reference),
    effectiveSkills: [...model.project.skills],
    effectiveConnectors: model.project.connectorServers.map((server) => ({ name: server.name, transport:server.transport })),
  }

  if (!write) {
    return { dir, compositionPath, metadataPath, composition, metrics, preview: true }
  }

  mkdirSync(dir, { recursive: true })
  rmSync(cardsDir, { recursive: true, force: true })
  for (const card of persona.cards) {
    const cardDir = join(cardsDir, card.skill)
    mkdirSync(cardDir, { recursive: true })
    writeFileSync(join(cardDir, 'SKILL.md'), skillDocument(card.skill, card.expert), { encoding: 'utf8', mode: 0o600 })
  }
  writeAtomic(compositionPath, composition)
  writeAtomic(metadataPath, metadata)
  savePackageLock(project,snapshot.locked)
  return { dir, compositionPath, metadataPath, composition, metrics, preview: false }
}

/** Write a file through a temporary sibling so a reader never sees a partial preset. */
function writeAtomic(path, text) {
  const temporary = join(dirname(path), `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}
