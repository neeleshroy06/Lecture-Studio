import { useCallback, useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

export default function useGeminiProxy(callbacks = {}) {
  const wsRef = useRef(null)
  const callbacksRef = useRef(callbacks)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'start_session' }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'gemini_connected':
          callbacksRef.current.onConnected?.()
          break
        case 'transcript_user':
          callbacksRef.current.onTranscriptUser?.(msg.text)
          break
        case 'transcript_gemini':
          callbacksRef.current.onTranscriptGemini?.(msg.text)
          break
        case 'audio_chunk':
          callbacksRef.current.onAudioChunk?.(msg.audio)
          break
        case 'speaking_start':
          callbacksRef.current.onSpeakingStart?.()
          break
        case 'speaking_end':
          callbacksRef.current.onSpeakingEnd?.()
          break
        case 'interrupted':
          callbacksRef.current.onInterrupted?.()
          break
        case 'error':
          callbacksRef.current.onError?.(msg.message)
          break
        default:
          break
      }
    }

    ws.onerror = () => {
      callbacksRef.current.onError?.('WebSocket connection error.')
    }

    ws.onclose = () => {
      setConnected(false)
      callbacksRef.current.onDisconnected?.()
    }
  }, [])

  const sendMessage = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [])

  const sendAudio = useCallback((audio) => sendMessage({ type: 'audio_chunk', audio }), [sendMessage])
  const sendVideoFrame = useCallback((frame) => sendMessage({ type: 'video_frame', frame }), [sendMessage])
  const sendText = useCallback((text) => sendMessage({ type: 'text_input', text }), [sendMessage])
  const stopSpeaking = useCallback(() => sendMessage({ type: 'stop_speaking' }), [sendMessage])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      sendMessage({ type: 'end_session' })
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
  }, [sendMessage])

  useEffect(() => () => disconnect(), [disconnect])

  return { connect, disconnect, sendAudio, sendVideoFrame, sendText, stopSpeaking, connected }
}
