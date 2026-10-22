/** Display metadata shared by catalog, local configuration and project templates. */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { relativeInside } from './native-path.js'
import { readPackage } from './bundles.js'

export const ICON_MAX_BYTES = 256 * 1024
// Existing expert avatars may exceed the editor upload limit.
export const ICON_ASSET_MAX_BYTES = 2 * 1024 * 1024
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/

/** Read a top-level string without rewriting other frontmatter (including flow YAML). */
export function metadataField(document, key) {
  const value = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(document)?.[1]?.trim()
  if (!value || /^[|>]/.test(value)) return undefined
  if (value.startsWith('"')) {
    const quoted = /^"(?:[^"\\]|\\.)*"/.exec(value)?.[0]
    if (!quoted || !/^(?:\s*|\s+#.*)$/.test(value.slice(quoted.length))) return undefined
    try { return JSON.parse(quoted) } catch { return undefined }
  }
  if (value.startsWith("'")) return /^'(?:[^']|'')*'(?:\s+#.*)?$/.test(value) ? value.replace(/^'|'(?:\s+#.*)?$/g, '').replace(/''/g, "'") : undefined
  return value.replace(/\s+#.*$/, '').trim()
}

/** Icons are text, HTTP images, embedded raster images, or relative image assets. */
export function validateIcon(value) {
  if (typeof value !== 'string') throw new Error('图标必须是文本')
  const icon = value.trim()
  if (!icon) return ''
  const image = IMAGE.exec(icon)
  if (image) {
    const bytes = Buffer.from(image[2], 'base64')
    if (bytes.length > ICON_MAX_BYTES) throw new Error('图标图片不能超过 256 KB')
    if (bytes.length === 0) throw new Error('图标图片为空')
    return icon
  }
  if (icon.length > 2048 || /[\r\n\x00-\x1f]/.test(icon)) throw new Error('图标格式无效')
  if (/^https?:\/\//i.test(icon)) {
    const url = new URL(icon)
    if (url.username || url.password) throw new Error('图片链接不能包含账号或密码')
    return icon
  }
  if (icon.includes(':') || icon.startsWith('/') || icon.startsWith('\\')) throw new Error('图标仅支持 Emoji、HTTP 图片链接或相对图片路径')
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(icon)) {
    if (icon.split(/[\\/]/).includes('..')) throw new Error('图片路径不能越出能力目录')
    return icon
  }
  if (Array.from(icon).length > 12 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(icon)) throw new Error('请输入 Emoji、图片链接或相对图片路径')
  return icon
}

/** Relative assets remain confined even when symlinks are involved. Never fetch remote URLs. */
function displayIcon(icon, base) {
  try {
    const value = validateIcon(icon)
    if (!value || /^https?:\/\//i.test(value) || IMAGE.test(value) || !/\.(png|jpe?g|gif|webp|svg)$/i.test(value)) return value
    const root = realpathSync(base)
    const path = realpathSync(resolve(base, value))
    if (!relativeInside(root, path) || !statSync(path).isFile() || statSync(path).size > ICON_ASSET_MAX_BYTES) return undefined
    const extension = /\.(png|jpe?g|gif|webp|svg)$/i.exec(value)[1].toLowerCase()
    const mime = extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension
    if (extension === 'svg' && /<script|<foreignObject|\son\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:|data:)/i.test(readFileSync(path,'utf8'))) return undefined
    return `data:image/${mime};base64,${readFileSync(path).toString('base64')}`
  } catch { return undefined }
}

export function describeOption(entry, kind) {
  if (entry.native || entry.error) return { ...entry,kind }
  try {
    const bundle = entry.metadata ? entry : readPackage(entry.path,kind,entry.name)
    const iconUrl = bundle.icon ? displayIcon(bundle.icon,bundle.path) : undefined
    return { ...entry,...bundle,kind,description:bundle.description.slice(0,260),iconUrl }
  } catch (error) { return { ...entry,kind,error:error.message } }
}

/** Patch only the icon block, preserving the body and all unrelated YAML literally. */
function replaceIcon(document, icon, newline) {
  const stripped = document.replace(/^(?:icon|avatar):[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*(?:\r?\n|$)/gm, '')
  return icon ? `icon: ${JSON.stringify(icon)}${newline}${stripped}` : stripped
}

export function withCapabilityIcon(content, kind, value) {
  if (typeof content !== 'string') throw new Error('能力内容必须是文本')
  const icon = validateIcon(value)
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  if (kind === 'connector' || kind === 'expert') {
    const document = JSON.parse(content)
    if (icon) document.icon = icon; else delete document.icon
    return JSON.stringify(document,null,2)+'\n'
  }
  const front = FRONT.exec(content)
  if (!front) return icon ? `---${newline}icon: ${JSON.stringify(icon)}${newline}---${newline}${content}` : content
  const metadata = replaceIcon(front[1] + newline, icon, newline)
  const body = content.slice(front[0].length)
  return metadata.trim() ? `---${newline}${metadata}---${newline}${body}` : body
}

/** Display-only image data must not enter model instructions. Preserve other fields. */
export function stripDisplayIcon(content) {
  const front = FRONT.exec(content)
  if (!front) return content
  const metadata = replaceIcon(front[1] + '\n', '', '\n')
  const body = content.slice(front[0].length)
  return metadata.trim() ? `---\n${metadata}---\n${body}` : body
}
