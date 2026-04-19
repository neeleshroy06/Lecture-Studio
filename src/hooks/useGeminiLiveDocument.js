import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeStreamingText } from '../utils/liveTranscriptMerge'
import { PcmChunkPlayer } from '../utils/pcmPlayer'
import { buildLiveSystemInstruction } from '../utils/documentIndex'
import { renderFirstPageJpegBase64 } from '../utils/pdfUtils'
import { getApiBaseUrl } from '../utils/apiUrl'

function buildSeedTurns({ extractedTextForSeed, numPages, weakText, jpeg }) {
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

  if (!parts.length) return []

  return [
    {
      role: 'user',
      parts,
    },
    {
      role: 'model',
      parts: [
        {
          text: 'Understood. I will answer naturally, stay grounded in the course document, and reference pages when helpful.',
        },
      ],
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
 */
export default function useGeminiLiveDocument({ documentIndex, getPdfDocument }) {
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
    const systemInstruction = buildLiveSystemInstruction(documentIndex)
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
      }),
    }
  }, [documentIndex, getPdfDocument])

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

      if (sessionRef.current) {
        expectedCloseRef.current = true
        sessionRef.current.close?.()
        sessionRef.current = null
        expectedCloseRef.current = false
      }

      const connectionId = connectionIdRef.current + 1
      connectionIdRef.current = connectionId
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
        setError('Live proxy connection error.')
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
        const details = reason
          ? `Live session closed: ${reason}`
          : `Live session closed unexpectedly${event?.code ? ` (code ${event.code})` : ''}.`
        setError(details)
        setStatus('error')
        setLastEvent('error')
      }

      sessionRef.current = ws
      return true
    } catch (connectError) {
      console.error(connectError)
      setError(connectError.message || 'Could not connect to live proxy.')
      setStatus('error')
      setLastEvent('error')
      return false
    }
  }, [buildSessionPayload, clearAssistantPlayback, documentIndex, handleProxyMessage, preparePlayback, resetConversationState])

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
    hasLiveBackend: true,
  }
}
