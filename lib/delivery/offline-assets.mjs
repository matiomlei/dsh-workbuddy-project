/** Keep pinned canvas bytes intact on disk, remove external fonts from served CSS. */
export function offlineCanvasCss(source) {
  return source
    .replace(/@import\s*(?:url\(\s*)?["']https:\/\/fonts\.googleapis\.com\/[^"']*["']\s*\)?\s*;/gi, '')
    .replace(/["']Plus Jakarta Sans["']\s*,\s*/g, '')
}
