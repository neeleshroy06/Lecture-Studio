import { redactPhiLikeText } from './phiRedaction'

const MAP_MAX_CHARS = 8000
const SEED_TEXT_MAX = 60000

/** Lowercase, strip diacritics, collapse punctuation to spaces for fuzzy search. */
export function normalizeSearchText(value) {
  if (!value) return ''
  let s = value.normalize('NFD').replace(/\p{M}/gu, '')
  s = s.toLowerCase()
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function isLikelyHeading(line) {
  const t = line.trim()
  if (t.length < 3 || t.length > 120) return false
  const upperRatio = (t.match(/[A-Z]/g) || []).length / Math.max(t.replace(/\s/g, '').length, 1)
  if (upperRatio > 0.55 && t.length < 80) return true
  if (/^(chapter|section|part|unit|lecture|module|appendix|introduction|conclusion)\b/i.test(t)) return true
  if (/^\d+(\.\d+)*\s+[\p{L}]/u.test(t)) return true
  return false
}

/** Education-oriented domain terms: capitalized multi-word phrases. */
const DOMAIN_PHRASE_RE = /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g

export async function buildDocumentIndex(pdfDocument) {
  const numPages = pdfDocument.numPages
  const pages = []
  const termMap = new Map()
  const headingOccurrences = new Map()

  for (let pageNum = 1; pageNum <= numPages; pageNum += 1) {
    const page = await pdfDocument.getPage(pageNum)
    const textContent = await page.getTextContent()
    const items = textContent.items || []
    const rawText = items
      .map((item) => ('str' in item ? item.str : '') || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const normalizedText = normalizeSearchText(rawText)
    const lines = rawText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)

    const headings = []
    for (const line of lines) {
      if (!isLikelyHeading(line)) continue
      headings.push(line)
      const key = normalizeSearchText(line)
      if (key.length < 4) continue
      if (!headingOccurrences.has(key)) headingOccurrences.set(key, [])
      headingOccurrences.get(key).push(pageNum)
    }

    const pageSummary = `Page ${pageNum}: ${rawText.slice(0, 220)}${rawText.length > 220 ? '…' : ''}`

    pages.push({
      pageNum,
      rawText,
      normalizedText,
      pageSummary,
      headings,
    })

    const words = normalizedText.split(/\s+/).filter((w) => w.length > 3)
    const seen = new Set()
    for (const w of words) {
      if (seen.has(w)) continue
      seen.add(w)
      if (!termMap.has(w)) termMap.set(w, [])
      termMap.get(w).push(pageNum)
    }

    let m
    DOMAIN_PHRASE_RE.lastIndex = 0
    while ((m = DOMAIN_PHRASE_RE.exec(rawText)) !== null) {
      const phrase = m[0]
      const nk = normalizeSearchText(phrase)
      if (nk.length < 6) continue
      if (!termMap.has(nk)) termMap.set(nk, [])
      const list = termMap.get(nk)
      if (list[list.length - 1] !== pageNum) list.push(pageNum)
    }
  }

  const headingMap = {}
  for (const [key, pnums] of headingOccurrences) {
    if (pnums.length === 1) {
      const originalHeading = pages
        .flatMap((p) => p.headings)
        .find((h) => normalizeSearchText(h) === key)
      if (originalHeading) {
        headingMap[originalHeading] = pnums[0]
      }
    }
  }

  const pageSummariesConcat = pages.map((p) => p.pageSummary).join('\n')
  const documentMapTruncated =
    pageSummariesConcat.length > MAP_MAX_CHARS
      ? `${pageSummariesConcat.slice(0, MAP_MAX_CHARS)}\n… [document map truncated]`
      : pageSummariesConcat

  const fullRawText = pages.map((p) => p.rawText).join('\n\n')
  const redactedFull = redactPhiLikeText(fullRawText)
  const extractedTextForSeed =
    redactedFull.length > SEED_TEXT_MAX ? `${redactedFull.slice(0, SEED_TEXT_MAX)}\n… [text truncated]` : redactedFull

  const weak = isWeakTextContent(pages)

  return {
    numPages,
    pages,
    termMap,
    headingMap,
    documentMapTruncated,
    extractedTextForSeed,
    weakText: weak,
  }
}

export function isWeakTextContent(pages) {
  if (!pages?.length) return true
  const total = pages.reduce((acc, p) => acc + (p.rawText?.length || 0), 0)
  const avg = total / pages.length
  return total < 120 || avg < 40
}

export function buildLiveSystemInstruction(documentIndex) {
  const headings = Object.entries(documentIndex.headingMap || {})
    .slice(0, 40)
    .map(([h, pg]) => `- "${h}" → page ${pg}`)
    .join('\n')

  return `You are a course assistant helping a student understand ONE uploaded document.

DOCUMENT MAP (compact outline — cite using page numbers exactly as below):
${documentIndex.documentMapTruncated}

UNIQUE HEADINGS (when unambiguous):
${headings || '(none detected)'}

RULES:
- Answer ONLY using this document and the seeded full text you receive. If something is not in the document, say so briefly.
- Be conversational and concise for spoken replies (no markdown, no bullet lists in speech).
- When you refer to a location, ALWAYS say the word "page" and the number, e.g. "page 3" or "pages 4 through 6". This helps the student's viewer scroll in sync.
- Do not claim you "see" the PDF unless an image was provided for scanned pages; prefer textual evidence.
- If quoting, keep quotes short.

You may discuss study strategies only as they relate to this material.`
}
