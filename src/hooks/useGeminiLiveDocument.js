import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeStreamingText } from '../utils/liveTranscriptMerge'
import { PcmChunkPlayer } from '../utils/pcmPlayer'
import { buildLiveSystemInstruction } from '../utils/documentIndex'
import { renderFirstPageJpegBase64 } from '../utils/pdfUtils'
import { getApiBaseUrl } from '../utils/apiUrl'

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
    ? 'Understood. I have the course document and the professor\'s lecture memory. I will answer naturally, ground my answers in the lecture and the document, and reference pages when helpful.'
    : 'Understood. I will answer naturally, stay grounded in the course document, and reference pages when helpful.'

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
    const finalized = mergedReplyRef.current.trim()
    if (!finalized) return
    setLastReplyText(finalized)
    setLastReplyTurnId((turnId) => turnId + 1)
    appendTranscriptEntry('gemini', finalized)
    setLastEvent('assistant_turn_complete')
  }, [appendTranscriptEntry])

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
          setReplyText(mergedReplyRef.current)
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
    [clearAssistantPlayback, finalizeAssistantTurn, flushHeardText, playAssistantAudioChunk],
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

  const startLive = useCallback(async () => {
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
    (text) => {
      const trimmed = text?.trim()
      if (!trimmed || !sessionRef.current || status !== 'live' || sessionRef.current.readyState !== WebSocket.OPEN) return
      flushHeardText()
      setLastHeardText(trimmed)
      setUserInputTurnId((turnId) => turnId + 1)
      appendTranscriptEntry('user', trimmed)
      setLastEvent('user_turn_complete')
      sessionRef.current.send(JSON.stringify({ type: 'user_text', text: trimmed }))
    },
    [appendTranscriptEntry, flushHeardText, status],
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
      const memory = lectureMemory.find(
        (entry) =>
          Number(entry.page) === Number(stroke.page) &&
          Math.abs((entry.timestamp ?? 0) - (stroke.startedAtMs ?? 0)) < 8000,
      )
      const verb = stroke.tool === 'highlighter' ? 'highlighted' : 'drew on'
      const nearby = Array.isArray(stroke.nearbyText) ? stroke.nearbyText.slice(0, 6).join(' ') : ''
      const transcriptExcerpt = memory?.transcript ? memory.transcript.slice(0, 400) : ''
      const summary = memory?.summary ? ` Summary: ${memory.summary}` : ''
      const said = transcriptExcerpt ? ` Around that moment they said: "${transcriptExcerpt}".` : ''
      const region = nearby ? `"${nearby.slice(0, 160)}"` : 'a page region'
      return `[annotation:${annotationId}] On page ${stroke.page} the professor ${verb} ${region}.${said}${summary}`
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
      const question = customQuestion?.trim() || `Why did the professor ${preamble.includes('highlighted') ? 'highlight this' : 'draw this'}? Explain what they meant by it.`
      sendText(`${preamble} The student is asking: ${question}`)
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
      sendText(`${preamble} I'm about to ask you a question about this annotation by voice.`)
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
