/** Native filesystem paths: use path relationships, never separator/case-sensitive prefixes. */
import { isAbsolute, relative, sep } from 'node:path'

/** Empty string means the root itself; undefined means outside, including a different drive/share. */
export function relativeInside(root, target) {
  const value = relative(root, target)
  return value === '..' || value.startsWith('..' + sep) || isAbsolute(value) ? undefined : value
}

export function sameNativePath(left, right) { return relative(left, right) === '' }
