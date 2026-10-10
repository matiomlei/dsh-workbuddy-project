/** Git sources and schedules are local administration settings, never project prompt fields. */
import { isAbsolute } from 'node:path'
export function repositoryAddress(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || /[\s\x00-\x1f]/.test(value) || value.startsWith('-')) throw new Error('请输入有效的 Git 仓库地址')
  if (isAbsolute(value)) return value
  if (/^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(value)) return value
  let url
  try { url = new URL(value) } catch { throw new Error('仓库地址支持 HTTPS、SSH 或本机 Git 仓库路径') }
  if (!['https:', 'http:', 'ssh:', 'git:', 'file:'].includes(url.protocol)) throw new Error('不支持该 Git 仓库协议')
  if (url.password || (['https:', 'http:'].includes(url.protocol) && url.username)) throw new Error('请通过本机 Git 凭据或 SSH 密钥认证，不要在仓库地址中填写密码或令牌')
  if (url.protocol !== 'file:' && !url.hostname) throw new Error('仓库地址缺少主机名')
  return value
}
export function librarySchedule(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('同步设置必须是对象')
  for (const key of ['startup', 'daily']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('同步时机必须是开关')
  const time = value.time ?? '09:00'
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('每日同步时间应为 HH:mm（00:00–23:59）')
  return { startup: value.startup === true, daily: value.daily === true, time }
}
