import { normalizeSearchText } from './documentIndex'

export const PAGE_NUMBER_PATTERN =
  /\b(?:page|pages|pg\.?|pp\.?|p\.)\s*(?:number\s*)?(\d+)(?:\s*[-–—]\s*(?:page\s*)?(\d+))?/gi

const WORD_ORDINALS = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
}

const QUOTE_RE = /"([^"]{2,200})"|'([^']{2,200})'/g
const DRUG_LIKE_RE = /\b(?:[A-Z][a-z]+(?:cillin|mycin|zepam|prazole|statin|sartan))\b/g

/**
 * @param {string} transcript
 * @param {number} maxPages
 * @returns {number[]}
 */
export function extractReferencedPages(transcript, maxPages) {
  if (!transcript || !maxPages) return []
  const text = transcript
  const found = new Set()

  let match
  const re = new RegExp(PAGE_NUMBER_PATTERN.source, 'gi')
  while ((match = re.exec(text)) !== null) {
    const a = Number.parseInt(match[1], 10)
    const b = match[2] ? Number.parseInt(match[2], 10) : a
    if (Number.isFinite(a) && a >= 1 && a <= maxPages) found.add(a)
    if (Number.isFinite(b) && b >= 1 && b <= maxPages) {
      found.add(b)
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      for (let p = lo; p <= hi; p += 1) {
        if (p >= 1 && p <= maxPages) found.add(p)
      }
    }
  }

  const ordinalRe =
    /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s+page\b/gi
  while ((match = ordinalRe.exec(text)) !== null) {
    const n = WORD_ORDINALS[match[1].toLowerCase()]
    if (n && n <= maxPages) found.add(n)
  }

  const throughRe = /\bpages?\s+(\d+)\s+(?:through|to|until)\s+(\d+)\b/gi
  while ((match = throughRe.exec(text)) !== null) {
    const lo = Math.min(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10))
    const hi = Math.max(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10))
    for (let p = lo; p <= hi; p += 1) {
      if (p >= 1 && p <= maxPages) found.add(p)
    }
  }

  const digitOrdinalRe = /\b(\d{1,2})(?:st|nd|rd|th)\s+page\b/gi
  while ((match = digitOrdinalRe.exec(text)) !== null) {
    const n = Number.parseInt(match[1], 10)
    if (n >= 1 && n <= maxPages) found.add(n)
  }

  return [...found].sort((x, y) => x - y)
}

function findPagesForTerm(term, documentIndex) {
  const key = normalizeSearchText(term)
  if (!key) return []
  const direct = documentIndex.termMap?.get(key)
  if (direct?.length) return direct

  for (const [k, pages] of documentIndex.termMap || []) {
    if (k.includes(key) || key.includes(k)) {
      return pages
    }
  }

  for (const p of documentIndex.pages || []) {
    if (p.normalizedText.includes(key)) return [p.pageNum]
  }

  return []
}

/**
 * @typedef {{ type: 'scroll_to_page', page: number }} ScrollAction
 * @typedef {{ type: 'highlight_text', text: string, pages?: number[] }} HighlightAction
 * @typedef {ScrollAction | HighlightAction} DocumentAction
 */

export class TranscriptParser {
  /**
   * @param {object} documentIndex — result of buildDocumentIndex
   * @param {(actions: DocumentAction[]) => void} enqueueActions
   */
  constructor(documentIndex, enqueueActions) {
    this.documentIndex = documentIndex
    this.enqueueActions = enqueueActions
    this.debounceMs = 120
    this._timer = null
    this._lastText = ''
    this.firedActions = new Set()
  }

  beginNewAssistantTurn() {
    this.firedActions.clear()
    this._lastText = ''
  }

  updateTranscript(text) {
    this._lastText = text || ''
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => {
      this._timer = null
      this.parse()
    }, this.debounceMs)
  }

  reset() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    this._lastText = ''
    this.firedActions.clear()
  }

  parse() {
    const transcript = this._lastText
    if (!transcript?.trim() || !this.documentIndex) return

    const maxPages = this.documentIndex.numPages || 0
    const actions = []

    const pages = extractReferencedPages(transcript, maxPages)
    for (const page of pages) {
      const key = `scroll-${page}`
      if (!this.firedActions.has(key)) {
        this.firedActions.add(key)
        actions.push({ type: 'scroll_to_page', page })
      }
    }

    let m
    const quoteRe = new RegExp(QUOTE_RE.source, 'g')
    while ((m = quoteRe.exec(transcript)) !== null) {
      const phrase = (m[1] || m[2] || '').trim()
      if (phrase.length < 3) continue
      const key = `hi-${normalizeSearchText(phrase)}`
      if (this.firedActions.has(key)) continue
      const pg = findPagesForTerm(phrase, this.documentIndex)
      if (pg.length) {
        this.firedActions.add(key)
        actions.push({ type: 'highlight_text', text: phrase, pages: pg })
      }
    }

    const drugRe = new RegExp(DRUG_LIKE_RE.source, 'g')
    while ((m = drugRe.exec(transcript)) !== null) {
      const phrase = m[0]
      const key = `dr-${phrase.toLowerCase()}`
      if (this.firedActions.has(key)) continue
      const pg = findPagesForTerm(phrase, this.documentIndex)
      if (pg.length) {
        this.firedActions.add(key)
        actions.push({ type: 'highlight_text', text: phrase, pages: pg })
      }
    }

    for (const [heading, page] of Object.entries(this.documentIndex.headingMap || {})) {
      if (transcript.includes(heading)) {
        const key = `hd-${normalizeSearchText(heading)}`
        if (this.firedActions.has(key)) continue
        this.firedActions.add(key)
        actions.push({ type: 'scroll_to_page', page })
        actions.push({ type: 'highlight_text', text: heading, pages: [page] })
      }
    }

    if (actions.length) {
      this.enqueueActions(actions)
    }
  }
}
