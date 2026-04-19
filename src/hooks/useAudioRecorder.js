import { useEffect, useRef, useState } from 'react'
import { float32ToBase64PCM } from '../utils/audioUtils'

export function useAudioRecorder() {
  const mediaRecorderRef = useRef(null)
  const recordedMimeRef = useRef('')
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startTimer = () => {
    clearTimer()
    timerRef.current = setInterval(() => {
      setElapsed((value) => value + 1)
    }, 1000)
  }

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    const mimeType = mimeCandidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
    recordedMimeRef.current = mimeType || ''
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
    streamRef.current = stream
    mediaRecorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.start(250)
    setElapsed(0)
    setIsPaused(false)
    setIsRecording(true)
    startTimer()
  }

  const pause = () => {
    mediaRecorderRef.current?.pause()
    setIsPaused(true)
    clearTimer()
  }

  const resume = () => {
    mediaRecorderRef.current?.resume()
    setIsPaused(false)
    startTimer()
  }

  const stop = () =>
    new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) {
        resolve(null)
        return
      }

      recorder.onstop = () => {
        clearTimer()
        setIsRecording(false)
        setIsPaused(false)
        const blobType = recordedMimeRef.current || recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: blobType })
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        resolve(blob)
      }

      recorder.stop()
    })

  useEffect(() => clearTimer, [])

  return { start, pause, resume, stop, isRecording, isPaused, elapsed, streamRef }
}

export function useMicStream({ onAudioChunk, active }) {
  const streamRef = useRef(null)
  const contextRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    const startStreaming = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        })

        if (!mounted) return

        const context = new AudioContext({ sampleRate: 16000 })
        const source = context.createMediaStreamSource(stream)
        const processor = context.createScriptProcessor(4096, 1, 1)

        processor.onaudioprocess = (event) => {
          const data = event.inputBuffer.getChannelData(0)
          const copy = new Float32Array(data.length)
          copy.set(data)
          const base64 = float32ToBase64PCM(copy)
          onAudioChunk?.(base64)
        }

        source.connect(processor)
        processor.connect(context.destination)

        streamRef.current = stream
        contextRef.current = context
        sourceRef.current = source
        processorRef.current = processor
        setError('')
      } catch (streamError) {
        setError(streamError.message || 'Microphone access failed.')
      }
    }

    const stopStreaming = async () => {
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (contextRef.current && contextRef.current.state !== 'closed') {
        await contextRef.current.close()
      }

      processorRef.current = null
      sourceRef.current = null
      streamRef.current = null
      contextRef.current = null
    }

    if (active) {
      startStreaming()
    } else {
      stopStreaming()
    }

    return () => {
      mounted = false
      stopStreaming()
    }
  }, [active, onAudioChunk])

  return { active, error }
}
