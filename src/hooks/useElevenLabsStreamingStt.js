import { useCallback, useEffect, useRef, useState } from 'react'
import { float32ToBase64PCM } from '../utils/audioUtils'
import { getApiBaseUrl } from '../utils/apiUrl'

const TARGET_SAMPLE_RATE = 16000
const SEND_INTERVAL_MS = 250

function getSttWsUrl() {
  const configuredBase = getApiBaseUrl()
  if (configuredBase) {
    const url = new URL(configuredBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/stt-stream'
    url.search = ''
    return url.toString()
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3001/api/stt-stream'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (window.location.port === '5173') {
    return `${protocol}//${window.location.hostname}:3001/api/stt-stream`
  }
  return `${protocol}//${window.location.host}/api/stt-stream`
}

/**
 * Linear-resample a Float32 buffer captured at `inputRate` down to `outputRate`.
 * Good enough for live captions; we don't need broadcast-quality resampling.
 */
function downsampleFloat32(buffer, inputRate, outputRate) {
  if (outputRate === inputRate) return buffer
  const ratio = inputRate / outputRate
  const newLength = Math.floor(buffer.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let count = 0
    for (let j = start; j < end; j += 1) {
      sum += buffer[j]
      count += 1
    }
    result[i] = count > 0 ? sum / count : 0
  }
  return result
}

/**
 * Tap the same MediaStream the recorder is using and stream live captions
 * via the server-side ElevenLabs Scribe proxy. The hook is purely additive:
 * the authoritative final transcript still comes from the batch upload that
 * runs when the professor stops the lecture.
 *
 * @param {object} options
 * @param {boolean} options.active                 turn the live captions on/off
 * @param {MediaStream | null} options.mediaStream the active mic stream from useAudioRecorder
 * @param {boolean} [options.paused]               pause caption updates without tearing down
 */
export default function useElevenLabsStreamingStt({ active, mediaStream, paused = false }) {
  const [partialText, setPartialText] = useState('')
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')

  const wsRef = useRef(null)
  const audioContextRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const bufferQueueRef = useRef([])
  const sendTimerRef = useRef(null)
  const pausedRef = useRef(paused)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const reset = useCallback(() => {
    setPartialText('')
    setHistory([])
    setError('')
  }, [])

  useEffect(() => {
    if (!active || !mediaStream) {
      const ws = wsRef.current
      const ctx = audioContextRef.current
      const processor = processorRef.current
      const source = sourceRef.current
      const sendTimer = sendTimerRef.current

      if (sendTimer) {
        clearInterval(sendTimer)
        sendTimerRef.current = null
      }
      processor?.disconnect()
      source?.disconnect()
      processorRef.current = null
      sourceRef.current = null
      bufferQueueRef.current = []
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {})
      }
      audioContextRef.current = null
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'inactive')
      }
      wsRef.current = null
      return undefined
    }

    let cancelled = false

    const connect = async () => {
      try {
        const ws = new WebSocket(getSttWsUrl())
        ws.onopen = () => {
          if (cancelled) {
            ws.close()
            return
          }
          setError('')
        }
        ws.onmessage = (event) => {
          let payload
          try {
            payload = JSON.parse(event.data)
          } catch {
            return
          }
          if (payload.type === 'partial_transcript' && payload.text) {
            const text = String(payload.text).trim()
            if (!text) return
            setPartialText(text)
            setHistory((prev) => {
              if (prev[prev.length - 1] === text) return prev
              const next = [...prev, text]
              return next.length > 30 ? next.slice(next.length - 30) : next
            })
          } else if (payload.type === 'error') {
            setError(payload.message || 'Live captions error.')
          }
        }
        ws.onerror = () => {
          if (cancelled) return
          setError('Live captions connection error.')
        }
        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null
        }
        wsRef.current = ws

        const audioContext = new AudioContext()
        const source = audioContext.createMediaStreamSource(mediaStream)
        const processor = audioContext.createScriptProcessor(4096, 1, 1)

        processor.onaudioprocess = (event) => {
          if (pausedRef.current) return
          const channel = event.inputBuffer.getChannelData(0)
          const copy = new Float32Array(channel.length)
          copy.set(channel)
          bufferQueueRef.current.push({ samples: copy, sampleRate: audioContext.sampleRate })
        }

        source.connect(processor)
        processor.connect(audioContext.destination)
        audioContextRef.current = audioContext
        sourceRef.current = source
        processorRef.current = processor

        sendTimerRef.current = setInterval(() => {
          const ws = wsRef.current
          if (!ws || ws.readyState !== WebSocket.OPEN) return
          const queue = bufferQueueRef.current
          if (!queue.length) return
          bufferQueueRef.current = []

          const inputRate = queue[0]?.sampleRate || audioContext.sampleRate
          const totalLength = queue.reduce((acc, item) => acc + item.samples.length, 0)
          const merged = new Float32Array(totalLength)
          let offset = 0
          for (const item of queue) {
            merged.set(item.samples, offset)
            offset += item.samples.length
          }

          const downsampled = downsampleFloat32(merged, inputRate, TARGET_SAMPLE_RATE)
          const base64 = float32ToBase64PCM(downsampled)
          ws.send(JSON.stringify({ type: 'audio_chunk', audio: base64 }))
        }, SEND_INTERVAL_MS)
      } catch (connectError) {
        if (!cancelled) setError(connectError.message || 'Could not start live captions.')
      }
    }

    connect()

    return () => {
      cancelled = true
      const ws = wsRef.current
      const ctx = audioContextRef.current
      const processor = processorRef.current
      const source = sourceRef.current
      const sendTimer = sendTimerRef.current

      if (sendTimer) {
        clearInterval(sendTimer)
        sendTimerRef.current = null
      }
      processor?.disconnect()
      source?.disconnect()
      processorRef.current = null
      sourceRef.current = null
      bufferQueueRef.current = []
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {})
      }
      audioContextRef.current = null
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'cleanup')
      }
      wsRef.current = null
    }
  }, [active, mediaStream])

  return { partialText, history, error, reset }
}
