/**
 * A deliberately small YAML subset: the writer emits the shapes this package
 * authors, and the reader accepts them back. It exists so the plugin imports
 * nothing outside Node's builtins — an out-of-tree profile plugin resolves its
 * dependencies from the profile's own node_modules, which a `file:`-linked
 * package cannot reach through its real path.
 *
 * Supported: block mappings, block sequences, quoted/plain scalars, `|`/`>`
 * block scalars (with `-`/`+` chomping), `#` comments and blank lines. Flow
 * collections, anchors and multi-document streams are rejected loudly rather
 * than guessed at.
 *
 * A {@link RawYaml} value passes through verbatim, which is how the compiler
 * emits the loader's `!!js` tag: `env: { TOKEN: !!js process.env.TOKEN }` must
 * reach the Loader unevaluated so the secret is resolved when the preset is
 * composed rather than written into the compiled artifact.
 *
 * @module dsh-workbuddy-project/yaml
 */

/**
 * One value the emitter writes exactly as given.
 *
 * The reader has no counterpart: a compiled preset is an output, never a
 * round-trip input, so a tag this package emits is never parsed back by it.
 */
export class RawYaml {
  /**
   * @param text - the exact YAML source for this value.
   */
  constructor(text) {
    this.text = text
  }
}

/** Render one value as a YAML document. */
export function emitYaml(value) {
  const lines = []
  emitNode(value, 0, lines)
  return lines.length === 0 ? '{}\n' : `${lines.join('\n')}\n`
}

function emitNode(value, indent, lines) {
  if (value instanceof RawYaml) {
    lines.push(`${pad(indent)}${value.text}`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad(indent)}[]`)
      return
    }
    for (const item of value) emitSequenceItem(item, indent, lines)
    return
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      lines.push(`${pad(indent)}{}`)
      return
    }
    for (const key of keys) emitMappingEntry(key, value[key], indent, lines)
    return
  }
  lines.push(`${pad(indent)}${scalar(value)}`)
}

function emitSequenceItem(item, indent, lines) {
  if (isRaw(item)) {
    lines.push(`${pad(indent)}- ${item.text}`)
    return
  }
  if (Array.isArray(item) || isPlainObject(item)) {
    const nested = []
    emitNode(item, indent + 2, nested)
    if (nested.length === 0) {
      lines.push(`${pad(indent)}- {}`)
      return
    }
    const [first, ...rest] = nested
    lines.push(`${pad(indent)}- ${first.slice(indent + 2)}`)
    lines.push(...rest)
    return
  }
  lines.push(`${pad(indent)}- ${scalar(item)}`)
}

function emitMappingEntry(key, value, indent, lines) {
  const rendered = renderKey(key)
  if (isRaw(value)) {
    lines.push(`${pad(indent)}${rendered}: ${value.text}`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad(indent)}${rendered}: []`)
      return
    }
    lines.push(`${pad(indent)}${rendered}:`)
    for (const item of value) emitSequenceItem(item, indent + 2, lines)
    return
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      lines.push(`${pad(indent)}${rendered}: {}`)
      return
    }
    lines.push(`${pad(indent)}${rendered}:`)
    for (const child of keys) emitMappingEntry(child, value[child], indent + 2, lines)
    return
  }
  if (typeof value === 'string' && value.includes('\n')) {
    lines.push(`${pad(indent)}${rendered}: |`)
    for (const line of value.replace(/\n+$/u, '').split('\n')) {
      lines.push(line === '' ? '' : `${pad(indent + 2)}${line}`)
    }
    return
  }
  lines.push(`${pad(indent)}${rendered}: ${scalar(value)}`)
}

/** Render a mapping key, quoting it when a plain key could be misread. */
function renderKey(key) {
  return isPlainSafe(key, true) ? key : doubleQuote(key)
}

/** Whether a value is passed through verbatim rather than rendered. */
function isRaw(value) {
  return value instanceof RawYaml
}

function scalar(value) {
  if (isRaw(value)) return value.text
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`yaml: cannot emit non-finite number ${value}`)
    return String(value)
  }
  if (typeof value !== 'string') throw new TypeError(`yaml: cannot emit ${typeof value}`)
  return isPlainSafe(value, false) ? value : doubleQuote(value)
}

const AMBIGUOUS = new Set(['', 'null', 'Null', 'NULL', '~', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE', 'yes', 'no', 'on', 'off', 'y', 'n'])

/** Whether one scalar may be emitted without quotes. */
function isPlainSafe(text, isKey) {
  if (AMBIGUOUS.has(text)) return false
  if (/^[\s]/u.test(text) || /[\s]$/u.test(text)) return false
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(text)) return false
  if (/[:#]\s/u.test(text) || /:$/u.test(text)) return false
  if (/[\n\r\t]/u.test(text)) return false
  if (/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/u.test(text)) return false
  if (isKey && text.includes(': ')) return false
  if (text.includes("'") && !text.includes('"')) return false
  return true
}

function doubleQuote(text) {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
  return `"${escaped}"`
}

function pad(indent) {
  return ' '.repeat(indent)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the YAML subset {@link emitYaml} writes.
 * @param text - document text.
 * @param source - label used in error messages.
 * @returns the parsed value.
 */
export function parseYaml(text, source = '<yaml>') {
  const lines = tokenize(text, source)
  const state = { lines, index: 0, source }
  if (state.lines.length === 0) return {}
  const value = parseBlock(state, state.lines[0].indent)
  if (state.index < state.lines.length) {
    fail(state.source, state.lines[state.index], 'unexpected content after the document root')
  }
  return value
}

function tokenize(text, source) {
  const out = []
  const raw = text.split(/\r?\n/u)
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i]
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    const content = stripComment(line.slice(indent))
    if (content.trim() === '') continue
    if (content.includes('\t')) fail(source, { line: i + 1 }, 'tabs are not allowed for indentation')
    out.push({ indent, text: content.trimEnd(), line: i + 1 })
  }
  return out
}

/** Strip a trailing comment that is outside any quoted region. */
function stripComment(text) {
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote === '"') {
      if (ch === '\\') i += 1
      else if (ch === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (ch === "'" && text[i + 1] === "'") i += 1
      else if (ch === "'") quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || /\s/u.test(text[i - 1]))) return text.slice(0, i)
  }
  return text
}

function parseBlock(state, indent) {
  const line = state.lines[state.index]
  if (line === undefined) return {}
  if (line.text === '-' || line.text.startsWith('- ')) return parseSequence(state, indent)
  return parseMapping(state, indent)
}

function parseSequence(state, indent) {
  const items = []
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.indent < indent) break
    if (line.indent > indent) fail(state.source, line, 'unexpected indentation inside a sequence')
    if (!(line.text === '-' || line.text.startsWith('- '))) break
    const rest = line.text === '-' ? '' : line.text.slice(2).trim()
    state.index += 1
    if (rest === '') {
      const next = state.lines[state.index]
      if (next !== undefined && next.indent > indent) items.push(parseBlock(state, next.indent))
      else items.push(null)
      continue
    }
    const inline = parseInlineEntry(state, rest, line, indent)
    items.push(inline)
  }
  return items
}

/**
 * Parse the remainder of a `- ` item: a nested mapping opening on the same
 * line, a nested sequence, a block scalar header, or a scalar.
 */
function parseInlineEntry(state, rest, line, indent) {
  const entry = splitKey(rest)
  if (entry !== null) {
    const object = {}
    const value = entry.value
    if (value === '') {
      const next = state.lines[state.index]
      if (next !== undefined && next.indent > indent) object[entry.key] = parseBlock(state, next.indent)
      else object[entry.key] = null
    } else {
      object[entry.key] = parseValueOrBlock(state, value, line, indent)
    }
    // Remaining keys of the same mapping are indented relative to the dash.
    while (state.index < state.lines.length) {
      const next = state.lines[state.index]
      if (next.indent <= indent) break
      if (next.text === '-' || next.text.startsWith('- ')) break
      const child = splitKey(next.text)
      if (child === null) break
      state.index += 1
      object[child.key] = child.value === '' && state.lines[state.index] !== undefined && state.lines[state.index].indent > next.indent
        ? parseBlock(state, state.lines[state.index].indent)
        : parseValueOrBlock(state, child.value, next, next.indent)
    }
    return object
  }
  return parseValueOrBlock(state, rest, line, indent)
}

function parseMapping(state, indent) {
  const object = {}
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.indent < indent) break
    if (line.indent > indent) fail(state.source, line, 'unexpected indentation inside a mapping')
    if (line.text === '-' || line.text.startsWith('- ')) break
    const entry = splitKey(line.text)
    if (entry === null) fail(state.source, line, `expected "key: value", found ${JSON.stringify(line.text)}`)
    state.index += 1
    const { key, value } = entry
    if (value === '') {
      const next = state.lines[state.index]
      object[key] = next !== undefined && next.indent > indent ? parseBlock(state, next.indent) : null
      continue
    }
    object[key] = parseValueOrBlock(state, value, line, indent)
  }
  return object
}

function parseValueOrBlock(state, rawValue, line, indent) {
  const header = rawValue.trim()
  if (/^[|>][+-]?$/u.test(header)) return parseBlockScalar(state, header, indent)
  if (header === '[]') return []
  if (header === '{}') return {}
  if (header === '' ) return null
  return parseScalar(header, state.source, line)
}

function parseBlockScalar(state, header, indent) {
  const folded = header.startsWith('>')
  const chomp = header.slice(1)
  const collected = []
  let blockIndent = null
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.indent <= indent) break
    blockIndent ??= line.indent
    collected.push(' '.repeat(line.indent - blockIndent) + line.text)
    state.index += 1
  }
  let text = collected.join('\n')
  if (folded) text = text.replace(/(?<!\n)\n(?!\n)/gu, ' ')
  if (chomp === '-') return text
  return `${text}\n`
}

/** Split `key: value` at the first colon outside quotes; null when there is none. */
function splitKey(text) {
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote === '"') {
      if (ch === '\\') i += 1
      else if (ch === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (ch === "'" && text[i + 1] === "'") i += 1
      else if (ch === "'") quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      return { key: unquote(text.slice(0, i).trim()), value: text.slice(i + 1).trim() }
    }
  }
  return null
}

function parseScalar(text, source, line) {
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch (error) {
      fail(source, line, `invalid double-quoted scalar: ${text}`)
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) fail(source, line, `invalid single-quoted scalar: ${text}`)
    return text.slice(1, -1).replaceAll("''", "'")
  }
  if (text === 'null' || text === '~') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/u.test(text)) return Number.parseInt(text, 10)
  if (/^-?\d+\.\d+$/u.test(text)) return Number.parseFloat(text)
  if (/^[[\]{}]/u.test(text)) fail(source, line, `flow collections are not supported: ${text}`)
  return text
}

function unquote(text) {
  return parseScalar(text, '<key>', { line: 0 })
}

function fail(source, line, message) {
  throw new SyntaxError(`${source}:${line.line}: ${message}`)
}
