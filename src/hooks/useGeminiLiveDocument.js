import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeStreamingText } from '../utils/liveTranscriptMerge'
import { PcmChunkPlayer } from '../utils/pcmPlayer'
import { buildLiveSystemInstruction } from '../utils/documentIndex'
import { renderFirstPageJpegBase64 } from '../utils/pdfUtils'
import { getApiBaseUrl } from '../utils/apiUrl'
import { computeStrokeMetadata } from '../utils/annotationMetadata'

function formatTimestampSeconds(ms = 0) {
  const total = Math.max(0, Math.round(Number(ms) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function buildSeedTurns({ extractedTextForSeed, numPages, weakText, jpeg, lectureMemory = [] }) {
  const parts = []
  if (weakText && jpeg) {
    parts.push(
      { inlineData: { mimeType: 'image/jpeg', data: jpeg } },
      { text: 'The PDF text layer is sparse or unreadable. Use this page image together with any extracted text.' },
    )
  }
  if (extractedTextForSeed?.trim()) {
    parts.push({
      text: `[Course document seed — ${numPages} page(s)]\n\n${extractedTextForSeed.trim()}`,
    })
  }

  if (lectureMemory.length) {
    const compact = lectureMemory.slice(0, 20).map((entry) => ({
      timestamp: formatTimestampSeconds(entry.timestamp),
      page: entry.page,
      summary: entry.summary,
      transcript: typeof entry.transcript === 'string' ? entry.transcript.slice(0, 280) : '',
    }))
    parts.push({
      text:
        '[Lecture memory seed — what the professor emphasized at each annotated moment, in order]\n\n' +
        JSON.stringify(compact, null, 2),
    })
  }

  if (!parts.length) return []

  const ack = lectureMemory.length
    ? 'Understood. I have the course document and the lecture memory. I will answer in first person as the professor, stay grounded in what I taught and what is on the document, and reference pages when helpful.'
    : 'Understood. I will answer in first person as the professor, stay grounded in the course document, and reference pages when helpful.'

  return [
    {
      role: 'user',
      parts,
    },
    {
      role: 'model',
      parts: [{ text: ack }],
    },
  ]
}

function createTranscriptEntry(role, text, sessionStartedAt) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    timestamp: Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000)),
  }
}

function getLiveWsUrl() {
  const configuredBase = getApiBaseUrl()
  if (configuredBase) {
    const url = new URL(configuredBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/live'
    url.search = ''
    return url.toString()
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3001/api/live'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (window.location.port === '5173') {
    return `${protocol}//${window.location.hostname}:3001/api/live`
  }
  return `${protocol}//${window.location.host}/api/live`
}

const REASONING_SENTENCE_MARKERS = [
  /\bi(?:'m| am|'ve| have)\s+(?:correctly\s+|just\s+)?(?:interpret|interpreting|interpreted|currently|still|trying|going|planning|prioritizing|considering|puzzled|focusing|crafted|noted|prepared|framed|aimed|decided|chosen|opted)/i,
  /\bmy\s+(?:focus|primary focus|immediate instinct|attention|reasoning|approach|plan|strategy|goal|aim)\s+(?:is|was|will be)\b/i,
  /\bi need to\b/i,
  /\bi will\s+(?:now|aim|try|focus|mirror|avoid|provide)\b/i,
  /\bclarifying\b/i,
  /\bdeciphering\b/i,
  /\backnowledg(?:e|ing)\b/i,
  /\breasoning summar/i,
  /\bconversational response/i,
  /\bas per the instructions?\b/i,
  /\bavoiding (?:any )?unnecessary\b/i,
  /\bseems to be the most appropriate\b/i,
  /\bappears to be the most appropriate\b/i,
  /\bis the most appropriate (?:reply|answer|response)\b/i,
  /\bmirror(?:ing)? the brevity\b/i,
  /\bunnecessary elaboration\b/i,
  /\bfactual insertions?\b/i,
  /\bnatural flow of the\b/i,
  /\bthe user(?:'s)? input\b/i,
  /\bthe student(?:'s)? message\b/i,
]

const TITLE_HEADER_RE = /^((?:[A-Z][a-z]+\s+)*(?:the|a|an)\s+)?(?:[A-Z][a-z]+)(?:\s+(?:the|a|an|of|and|or|to|for))?\s+([A-Z][a-z]+)\b/

function stripLeadingTitleHeader(value) {
  // Strip patterns like "Interpreting the Greeting " or "Choosing a Reply "
  const sentences = value.split(/(?<=[.!?])\s+/)
  if (!sentences.length) return value
  const first = sentences[0]
  // Heuristic: a "header" has no terminal punctuation and is followed by another sentence
  // beginning with a capital — and contains 2-5 Title Case words.
  if (sentences.length > 1 && !/[.!?]$/.test(first)) {
    const titleCaseWords = first.match(/\b[A-Z][a-z]+\b/g) || []
    if (titleCaseWords.length >= 2 && titleCaseWords.length <= 6 && first.length <= 80) {
      // Remove the header chunk up to where the next sentence begins.
      // Find the boundary inside the first sentence: a TitleCase word followed by a space then a capitalized word that starts a real sentence.
      const headerMatch = first.match(/^((?:[A-Z][a-z]+(?:\s+(?:the|a|an|of|and|or|to|for))?\s+){1,5}[A-Z][a-z]+)\s+/)
      if (headerMatch) {
        return value.slice(headerMatch[0].length).trim()
      }
    }
  }
  // Also handle when the whole reply starts with a bare header followed by sentence on same chunk
  const m = value.match(/^([A-Z][a-z]+(?:\s+(?:the|a|an|of|and|or|to|for))?\s+[A-Z][a-z]+)\s+(?=[A-Z][a-z'])/)
  if (m && TITLE_HEADER_RE.test(m[1])) {
    return value.slice(m[0].length).trim()
  }
  return value
}

function sanitizeAssistantReply(text) {
  let cleaned = String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return ''

  cleaned = stripLeadingTitleHeader(cleaned)

  const sentences = cleaned.split(/(?<=[.!?])\s+/)
  const kept = sentences.filter((sentence) => !REASONING_SENTENCE_MARKERS.some((rx) => rx.test(sentence)))
  let result = kept.join(' ').trim()

  if (!result) {
    const quoted = cleaned.match(/"([^"]{1,80})"\s*(?:seems to be|is|would be|appears to be)\s+the\s+(?:most\s+)?appropriate\s+(?:reply|answer|response)/i)
    if (quoted) {
      result = quoted[1].trim()
    }
  }

  if (!result) {
    const tail = cleaned.match(/(?:^|\.\s+|!\s+|\?\s+)([A-Z][^.!?]{0,80}[.!?])\s*$/)
    if (tail) {
      result = tail[1].trim()
    }
  }

  result = result.replace(/^"([^"]+)"\s*[—-]?\s*$/, '$1').trim()

  return result || cleaned
}

function normalizeCompactText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLikelyBriefSocialTurn(text) {
  const normalized = normalizeCompactText(text)
  if (!normalized) return false

  const wordCount = normalized.split(' ').filter(Boolean).length
  if (wordCount > 4) return false

  return /^(?:h+i+|hello+|hey+|yo+|thanks+|thank you|thx+|ok(?:ay+)?|yes+|no+|bye+|good morning|good afternoon|good evening)$/.test(normalized)
}

function buildAslUserTurn(text) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''

  const normalized = normalizeCompactText(trimmed)
  const isShortTurn = normalized.length <= 32 && normalized.split(' ').filter(Boolean).length <= 4

  let guidance = 'The student used ASL fingerspelling. Interpret obvious repeated letters or small spelling mistakes naturally.'
  if (isLikelyBriefSocialTurn(trimmed)) {
    guidance += ' This is a short social message, so reply with one brief social sentence only. Do not add extra help, follow-up questions, or document guidance unless the student asked for it.'
  } else if (isShortTurn) {
    guidance += ' Keep the reply to one short sentence unless the student clearly asked for more detail.'
  }

  return `${guidance}\nStudent message: ${trimmed}`
}

function normalizeAnnotationWords(values = []) {
  const combined = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
  return combined
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
}

function scoreLectureMemoryEntry(entry, stroke) {
  if (Number(entry.page) !== Number(stroke.page)) return Number.NEGATIVE_INFINITY

  if (Array.isArray(entry.sourceAnnotationIds) && entry.sourceAnnotationIds.length) {
    return entry.sourceAnnotationIds.includes(stroke.id) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  }

  const delta = Math.abs((entry.timestamp ?? 0) - (stroke.startedAtMs ?? 0))
  if (delta > 5000) return Number.NEGATIVE_INFINITY

  const strokeMeta = computeStrokeMetadata(stroke)
  let score = Math.max(0, 40 - delta / 150)
  const strokeWords = new Set(
    normalizeAnnotationWords([
      stroke.nearbyText,
      stroke.annotationLabel,
      stroke.shapeHint,
      stroke.regionLabel,
    ]),
  )
  const entryWords = normalizeAnnotationWords([
    entry.annotation,
    entry.summary,
    entry.transcript,
    entry.shapeHints,
    entry.regionLabels,
  ])
  for (const word of entryWords) {
    if (strokeWords.has(word)) score += 4
  }
  if (Array.isArray(entry.regionLabels) && entry.regionLabels.includes(strokeMeta.regionLabel)) score += 6
  if (Array.isArray(entry.shapeHints) && entry.shapeHints.includes(strokeMeta.shapeHint)) score += 6
  return score >= 28 ? score : Number.NEGATIVE_INFINITY
}

function findClosestLectureMemoryEntry(lectureMemory = [], stroke) {
  if (!stroke || !lectureMemory.length) return null

  let best = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const entry of lectureMemory) {
    const score = scoreLectureMemoryEntry(entry, stroke)
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }

  return Number.isFinite(bestScore) && bestScore > Number.NEGATIVE_INFINITY ? best : null
}

/**
 * @param {object} options
 * @param {object | null} options.documentIndex
 * @param {() => Promise<object | null> | object | null} [options.getPdfDocument]
 * @param {Array<object>} [options.lectureMemory]    structured lecture memory built by Gemma
 * @param {Array<object>} [options.annotationEvents] raw professor strokes (with ids + bounds)
 */
export default function useGeminiLiveDocument({
  documentIndex,
  getPdfDocument,
  lectureMemory = [],
  annotationEvents = [],
  lectureGroundingVersion = 0,
  runtimeStatus = null,
}) {
  const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview'
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [heardText, setHeardText] = useState('')
  const [replyText, setReplyText] = useState('')
  const [lastHeardText, setLastHeardText] = useState('')
  const [lastReplyText, setLastReplyText] = useState('')
  const [replyTurnId, setReplyTurnId] = useState(0)
  const [userInputTurnId, setUserInputTurnId] = useState(0)
  const [lastReplyTurnId, setLastReplyTurnId] = useState(0)
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false)
  const [transcriptEntries, setTranscriptEntries] = useState([])
  const [lastEvent, setLastEvent] = useState('idle')

  const sessionRef = useRef(null)
  const playerRef = useRef(null)
  const mergedReplyRef = useRef('')
  const heardMergeRef = useRef('')
  const pendingAssistantTurnRef = useRef(true)
  const expectedCloseRef = useRef(false)
  const connectionIdRef = useRef(0)
  const sessionStartedAtRef = useRef(Date.now())
  const audioPlaybackEnabledRef = useRef(true)
  const activeGroundingVersionRef = useRef(0)
  const isRefreshingSessionRef = useRef(false)
  const reconnectReasonRef = useRef('')
  const activeModelRef = useRef(DEFAULT_LIVE_MODEL)
  const pendingOutgoingTurnsRef = useRef([])

  useEffect(() => {
    playerRef.current = new PcmChunkPlayer(24000)
    return () => {
      sessionRef.current?.close?.()
      playerRef.current?.close?.()
    }
  }, [])

  const clearAssistantPlayback = useCallback(() => {
    playerRef.current?.clear()
  }, [])

  const preparePlayback = useCallback(async () => {
    if (!playerRef.current) playerRef.current = new PcmChunkPlayer(24000)
    await playerRef.current.resumeIfSuspended()
  }, [])

  const playAssistantAudioChunk = useCallback((base64Pcm) => {
    if (!audioPlaybackEnabledRef.current) return
    playerRef.current?.enqueueBase64Pcm(base64Pcm)
  }, [])

  const appendTranscriptEntry = useCallback((role, text) => {
    const trimmed = text?.trim()
    if (!trimmed) return
    setTranscriptEntries((entries) => [...entries, createTranscriptEntry(role, trimmed, sessionStartedAtRef.current)])
  }, [])

  const resetConversationState = useCallback(() => {
    mergedReplyRef.current = ''
    heardMergeRef.current = ''
    pendingOutgoingTurnsRef.current = []
    pendingAssistantTurnRef.current = true
    audioPlaybackEnabledRef.current = true
    setHeardText('')
    setReplyText('')
    setLastHeardText('')
    setLastReplyText('')
    setReplyTurnId(0)
    setUserInputTurnId(0)
    setLastReplyTurnId(0)
    setIsAssistantSpeaking(false)
    setTranscriptEntries([])
    setLastEvent('idle')
  }, [])

  const flushHeardText = useCallback(() => {
    const finalized = heardMergeRef.current.trim()
    if (!finalized) return
    setLastHeardText(finalized)
    setUserInputTurnId((turnId) => turnId + 1)
    appendTranscriptEntry('user', finalized)
    heardMergeRef.current = ''
    setHeardText('')
    setLastEvent('user_turn_complete')
  }, [appendTranscriptEntry])

  const flushReplyText = useCallback(() => {
    const finalized = sanitizeAssistantReply(mergedReplyRef.current)
    if (!finalized) return
    setLastReplyText(finalized)
    setLastReplyTurnId((turnId) => turnId + 1)
    appendTranscriptEntry('gemini', finalized)
    setLastEvent('assistant_turn_complete')
  }, [appendTranscriptEntry])

  const sendTextTurnNow = useCallback(
    (turn) => {
      if (!turn?.originalText || !turn?.modelText) return false
      if (!sessionRef.current || sessionRef.current.readyState !== WebSocket.OPEN) return false
      flushHeardText()
      const transcriptText = typeof turn.displayText === 'string' ? turn.displayText.trim() : turn.originalText
      setLastHeardText(transcriptText || turn.originalText)
      setUserInputTurnId((turnId) => turnId + 1)
      if (!turn.hideFromTranscript && transcriptText) {
        appendTranscriptEntry(turn.inputSource, transcriptText)
      }
      setLastEvent('user_turn_complete')
      sessionRef.current.send(JSON.stringify({ type: 'user_text', text: turn.modelText }))
      return true
    },
    [appendTranscriptEntry, flushHeardText],
  )

  const flushPendingOutgoingTurns = useCallback(() => {
    if (!sessionRef.current || sessionRef.current.readyState !== WebSocket.OPEN) return
    if (!pendingOutgoingTurnsRef.current.length) return

    const queuedTurns = pendingOutgoingTurnsRef.current
    pendingOutgoingTurnsRef.current = []
    for (const turn of queuedTurns) {
      if (!sendTextTurnNow(turn)) {
        pendingOutgoingTurnsRef.current.unshift(turn)
        break
      }
    }
  }, [sendTextTurnNow])

  const finalizeAssistantTurn = useCallback(() => {
    flushHeardText()
    flushReplyText()
    mergedReplyRef.current = ''
    pendingAssistantTurnRef.current = true
    setIsAssistantSpeaking(false)
    setReplyText('')
  }, [flushHeardText, flushReplyText])

  const handleProxyMessage = useCallback(
    (message) => {
      switch (message?.type) {
        case 'gemini_connected':
          setStatus('live')
          setLastEvent('ready')
          flushPendingOutgoingTurns()
          return
        case 'transcript_user':
          if (message.text) {
            heardMergeRef.current = mergeStreamingText(heardMergeRef.current, message.text)
            setHeardText(heardMergeRef.current)
            setLastEvent('user_speaking')
          }
          if (message.isFinal !== false) {
            flushHeardText()
          }
          return
        case 'transcript_gemini':
          if (!message.text) return
          flushHeardText()
          if (pendingAssistantTurnRef.current) {
            setReplyTurnId((turnId) => turnId + 1)
            mergedReplyRef.current = ''
            pendingAssistantTurnRef.current = false
          }
          mergedReplyRef.current = mergeStreamingText(mergedReplyRef.current, message.text)
          setReplyText(sanitizeAssistantReply(mergedReplyRef.current))
          setIsAssistantSpeaking(true)
          setLastEvent('assistant_speaking')
          return
        case 'audio_chunk':
          if (message.audio) {
            playAssistantAudioChunk(message.audio)
          }
          return
        case 'speaking_start':
          setIsAssistantSpeaking(true)
          return
        case 'speaking_end':
          finalizeAssistantTurn()
          return
        case 'assistant_turn_complete':
          finalizeAssistantTurn()
          return
        case 'interrupted':
          clearAssistantPlayback()
          mergedReplyRef.current = ''
          pendingAssistantTurnRef.current = true
          setReplyText('')
          setIsAssistantSpeaking(false)
          setLastEvent('interrupted')
          return
        case 'session_ended':
          expectedCloseRef.current = true
          sessionRef.current?.close?.()
          return
        case 'error':
          setError(message.message || 'Live proxy connection error.')
          setStatus('error')
          setLastEvent('error')
          return
        default:
      }
    },
    [clearAssistantPlayback, finalizeAssistantTurn, flushHeardText, flushPendingOutgoingTurns, playAssistantAudioChunk],
  )

  const buildSessionPayload = useCallback(async () => {
    const systemInstruction = buildLiveSystemInstruction(documentIndex, {
      lectureMemory,
      annotationEvents,
    })
    let jpeg = ''

    if (documentIndex?.weakText && getPdfDocument) {
      const pdf = await getPdfDocument()
      if (pdf) {
        jpeg = await renderFirstPageJpegBase64(pdf)
      }
    }

    return {
      systemInstruction,
      seedTurns: buildSeedTurns({
        extractedTextForSeed: documentIndex?.extractedTextForSeed,
        numPages: documentIndex?.numPages,
        weakText: documentIndex?.weakText,
        jpeg,
        lectureMemory,
      }),
    }
  }, [annotationEvents, documentIndex, getPdfDocument, lectureMemory])

  const startLive = useCallback(async (options = {}) => {
    if (!documentIndex) {
      setError('Wait for the document index to finish building.')
      setStatus('error')
      return false
    }

    setError('')
    setStatus('connecting')
    expectedCloseRef.current = false
    sessionStartedAtRef.current = Date.now()
    resetConversationState()

    await preparePlayback()

    try {
      const sessionPayload = await buildSessionPayload()
      const requestedModel = typeof options.liveModel === 'string' && options.liveModel.trim() ? options.liveModel.trim() : activeModelRef.current
      activeModelRef.current = requestedModel

      const connectionId = connectionIdRef.current + 1
      connectionIdRef.current = connectionId
      const previousSession = sessionRef.current
      if (previousSession) {
        try {
          previousSession.close(1000, 'Refreshing session')
        } catch {
          // best effort
        }
      }
      const ws = new WebSocket(getLiveWsUrl())

      ws.onopen = () => {
        if (connectionId !== connectionIdRef.current) return
        ws.send(
          JSON.stringify({
            type: 'start_session',
            liveModel: requestedModel,
            ...sessionPayload,
          }),
        )
        setLastEvent('open')
      }

      ws.onmessage = (event) => {
        if (connectionId !== connectionIdRef.current) return
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        handleProxyMessage(message)
      }

      ws.onerror = () => {
        if (connectionId !== connectionIdRef.current) return
        setError(reconnectReasonRef.current || 'Live proxy connection error.')
        setStatus('error')
        setLastEvent('error')
      }

      ws.onclose = (event) => {
        if (connectionId !== connectionIdRef.current) return
        sessionRef.current = null
        clearAssistantPlayback()
        setIsAssistantSpeaking(false)
        if (expectedCloseRef.current) {
          expectedCloseRef.current = false
          setStatus('idle')
          setLastEvent('closed')
          return
        }
        const reason = event?.reason?.trim()
        const details =
          reconnectReasonRef.current ||
          (reason
            ? `Live session closed: ${reason}`
            : `Live session closed unexpectedly${event?.code ? ` (code ${event.code})` : ''}.`)
        setError(details)
        setStatus('error')
        setLastEvent('error')
      }

      sessionRef.current = ws
      activeGroundingVersionRef.current = lectureGroundingVersion
      reconnectReasonRef.current = ''
      return true
    } catch (connectError) {
      console.error(connectError)
      setError(connectError.message || 'Could not connect to live proxy.')
      setStatus('error')
      setLastEvent('error')
      return false
    }
  }, [buildSessionPayload, clearAssistantPlayback, documentIndex, handleProxyMessage, lectureGroundingVersion, preparePlayback, resetConversationState])

  const sendAudioStreamEnd = useCallback(() => {
    if (!sessionRef.current || status !== 'live' || sessionRef.current.readyState !== WebSocket.OPEN) return
    sessionRef.current.send(JSON.stringify({ type: 'audio_stream_end' }))
  }, [status])

  const stopLive = useCallback(() => {
    const session = sessionRef.current
    const hasOpenSession = session && session.readyState === WebSocket.OPEN

    clearAssistantPlayback()
    setIsAssistantSpeaking(false)
    setHeardText('')
    setReplyText('')
    setLastEvent('closing')

    if (!session) {
      setStatus('idle')
      return
    }

    expectedCloseRef.current = true
    setStatus('closing')

    if (hasOpenSession) {
      session.send(JSON.stringify({ type: 'end_session' }))
      return
    }

    session.close()
    sessionRef.current = null
  }, [clearAssistantPlayback])

  const sendText = useCallback(
    (text, options = {}) => {
      const trimmed = text?.trim()
      if (!trimmed) return
      const inputSource = options.inputSource === 'asl' ? 'asl' : 'user'
      const modelText = inputSource === 'asl' ? buildAslUserTurn(trimmed) : trimmed
      const turn = {
        originalText: trimmed,
        inputSource,
        modelText,
        displayText: typeof options.displayText === 'string' ? options.displayText : trimmed,
        hideFromTranscript: Boolean(options.hideFromTranscript),
      }

      if (status === 'live' && sessionRef.current?.readyState === WebSocket.OPEN) {
        sendTextTurnNow(turn)
        return
      }

      if (status === 'connecting' || sessionRef.current?.readyState === WebSocket.CONNECTING) {
        pendingOutgoingTurnsRef.current.push(turn)
      }
    },
    [sendTextTurnNow, status],
  )

  const sendMicPcm = useCallback(
    (base64) => {
      if (!sessionRef.current || status !== 'live' || sessionRef.current.readyState !== WebSocket.OPEN) return
      sessionRef.current.send(JSON.stringify({ type: 'audio_chunk', audio: base64 }))
    },
    [status],
  )

  const pauseAssistantAudio = useCallback(() => {
    audioPlaybackEnabledRef.current = false
    clearAssistantPlayback()
  }, [clearAssistantPlayback])

  const resumeAssistantAudio = useCallback(async () => {
    audioPlaybackEnabledRef.current = true
    await preparePlayback()
  }, [preparePlayback])

  const buildAnnotationPreamble = useCallback(
    (annotationId) => {
      const stroke = annotationEvents.find((event) => event.id === annotationId)
      if (!stroke) return ''
      const strokeMeta = computeStrokeMetadata(stroke)
      const memory = findClosestLectureMemoryEntry(lectureMemory, stroke)
      const nearby = Array.isArray(stroke.nearbyText) ? stroke.nearbyText.slice(0, 6).join(' ') : ''
      const transcriptExcerpt = memory?.transcript ? memory.transcript.slice(0, 280) : ''
      const summary = memory?.summary ? memory.summary.trim() : ''
      const label = stroke.annotationLabel ? stroke.annotationLabel.slice(0, 160) : ''
      const action = stroke.tool === 'highlighter' ? 'highlighted' : 'drew'

      return [
        `[annotation:${annotationId}]`,
        'SELECTED ANNOTATION ONLY:',
        'LATEST SELECTED ANNOTATION: This selected annotation replaces any previously selected annotation context in the conversation.',
        `- annotation_id: ${annotationId}`,
        `- page: ${stroke.page}`,
        `- action: the professor ${action} this exact mark`,
        `- shape_hint: ${stroke.shapeHint || strokeMeta.shapeHint}`,
        `- location: ${stroke.regionLabel || strokeMeta.regionLabel}`,
        `- center_pct: x=${Math.round((stroke.centerX ?? strokeMeta.centerX) * 100)}, y=${Math.round((stroke.centerY ?? strokeMeta.centerY) * 100)}`,
        `- size_pct: width=${Math.round((stroke.bounds?.width ?? strokeMeta.bounds.width) * 100)}, height=${Math.round((stroke.bounds?.height ?? strokeMeta.bounds.height) * 100)}`,
        label ? `- label: ${label}` : '',
        nearby ? `- nearby_text: ${nearby.slice(0, 220)}` : '',
        summary ? `- lecture_summary: ${summary}` : '',
        transcriptExcerpt ? `- transcript_excerpt: ${transcriptExcerpt}` : '',
        Array.isArray(memory?.sourceAnnotationIds) && memory.sourceAnnotationIds.length
          ? `- lecture_memory_annotation_ids: ${memory.sourceAnnotationIds.join(', ')}`
          : '',
        'STRICT RULE: Answer only about this selected annotation. Ignore every other annotation, drawing, and highlight unless the student explicitly asks to compare them.',
        'STRICT RULE: If another annotation has different nearby text, shape, or location, it is not the one the student selected.',
      ]
        .filter(Boolean)
        .join('\n')
    },
    [annotationEvents, lectureMemory],
  )

  /**
   * Click an annotation → ground the next turn in that stroke and ask Gemini Live
   * about it as a typed user turn (works whether or not the mic is open).
   */
  const askAboutAnnotation = useCallback(
    (annotationId, customQuestion = '') => {
      const preamble = buildAnnotationPreamble(annotationId)
      if (!preamble) return
      const question =
        customQuestion?.trim() ||
        `What did you mean here, and why did you ${preamble.includes('highlighted') ? 'highlight this' : 'draw this'}?`
      sendText(`${preamble}\nSTUDENT QUESTION: ${question}\nFINAL RULE: Answer from the selected annotation block only. Do not mention any other annotation unless the student explicitly asks for a comparison.`, {
        displayText: question,
      })
    },
    [buildAnnotationPreamble, sendText],
  )

  /**
   * Click an annotation → silently seed the grounding context so the student can
   * then speak naturally about it. Sends a short user turn that primes the model
   * to expect a follow-up question about this stroke.
   */
  const askAboutAnnotationWithVoice = useCallback(
    (annotationId) => {
      const preamble = buildAnnotationPreamble(annotationId)
      if (!preamble) return
      sendText(`${preamble} The student is about to ask a voice follow-up about only this selected annotation.`, {
        hideFromTranscript: true,
      })
    },
    [buildAnnotationPreamble, sendText],
  )

  useEffect(() => {
    if (status !== 'live') return
    if (!lectureGroundingVersion || lectureGroundingVersion === activeGroundingVersionRef.current) return
    if (isRefreshingSessionRef.current) return
    if (runtimeStatus?.lectureMemoryMode === 'pending') return

    isRefreshingSessionRef.current = true
    setLastEvent('context_refresh')
    setError('')
    reconnectReasonRef.current = 'Refreshing live session with the latest lecture context...'

    void startLive().finally(() => {
      isRefreshingSessionRef.current = false
    })
  }, [lectureGroundingVersion, runtimeStatus?.lectureMemoryMode, startLive, status])

  return {
    status,
    error,
    heardText,
    replyText,
    lastHeardText,
    lastReplyText,
    replyTurnId,
    userInputTurnId,
    lastReplyTurnId,
    isAssistantSpeaking,
    transcriptEntries,
    lastEvent,
    startLive,
    stopLive,
    sendText,
    sendMicPcm,
    sendAudioStreamEnd,
    preparePlayback,
    clearPlayback: clearAssistantPlayback,
    pauseAssistantAudio,
    resumeAssistantAudio,
    askAboutAnnotation,
    askAboutAnnotationWithVoice,
    runtimeStatus,
    hasLiveBackend: runtimeStatus ? Boolean(runtimeStatus.geminiConfigured && runtimeStatus.elevenLabsConfigured) : true,
  }
}
