export function normalizeLiveText(value) {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Merges streaming transcript snippets where the server may repeat or overlap text.
 */
export function mergeStreamingText(previous, next) {
  const a = normalizeLiveText(previous)
  const b = normalizeLiveText(next)
  if (!a) return b
  if (!b) return a
  if (b.startsWith(a) || a === b) return b
  if (a.startsWith(b)) return a

  const maxCheck = Math.min(a.length, b.length, 2000)
  for (let k = maxCheck; k >= 3; k -= 1) {
    if (a.slice(-k) === b.slice(0, k)) {
      return normalizeLiveText(`${a}${b.slice(k)}`)
    }
  }

  return normalizeLiveText(`${a} ${b}`)
}

export function looksLikeSameReply(previous, next) {
  const a = normalizeLiveText(previous)
  const b = normalizeLiveText(next)
  if (!a || !b) return true
  if (b.startsWith(a.slice(0, Math.min(48, a.length)))) return true
  const merged = mergeStreamingText(a, b)
  return merged.length <= a.length + b.length + 4
}
