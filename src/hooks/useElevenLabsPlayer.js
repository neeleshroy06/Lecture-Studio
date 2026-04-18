import { useCallback, useEffect, useRef, useState } from 'react'
import { base64ToFloat32 } from '../utils/audioUtils'

export default function useElevenLabsPlayer() {
  const contextRef = useRef(null)
  const queueRef = useRef([])
  const sourceRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const ensureContext = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new AudioContext({ sampleRate: 24000 })
    }
    return contextRef.current
  }, [])

  const playNext = useCallback(() => {
    if (!queueRef.current.length) {
      sourceRef.current = null
      setIsPlaying(false)
      return
    }

    const context = ensureContext()
    const buffer = queueRef.current.shift()
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      playNext()
    }
    sourceRef.current = source
    setIsPlaying(true)
    source.start()
  }, [ensureContext])

  const enqueueAudio = useCallback(
    (base64Pcm) => {
      const context = ensureContext()
      const float32 = base64ToFloat32(base64Pcm)
      const buffer = context.createBuffer(1, float32.length, 24000)
      buffer.copyToChannel(float32, 0)
      queueRef.current.push(buffer)

      if (!sourceRef.current) {
        playNext()
      }
    },
    [ensureContext, playNext],
  )

  const clearQueue = useCallback(async () => {
    queueRef.current = []
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {}
    }
    sourceRef.current = null
    setIsPlaying(false)

    if (contextRef.current && contextRef.current.state !== 'closed') {
      await contextRef.current.close()
    }
    contextRef.current = null
  }, [])

  useEffect(() => () => clearQueue(), [clearQueue])

  return { enqueueAudio, clearQueue, isPlaying }
}
