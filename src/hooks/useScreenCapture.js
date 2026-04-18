import { useCallback, useRef, useState } from 'react'

export default function useScreenCapture({ onFrame } = {}) {
  const streamRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const intervalRef = useRef(null)
  const [active, setActive] = useState(false)

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    videoRef.current = null
    canvasRef.current = null
    window.__latestScreenFrame = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 768, height: 768 } })
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 768

    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()

    const context = canvas.getContext('2d')
    streamRef.current = stream
    videoRef.current = video
    canvasRef.current = canvas
    setActive(true)

    intervalRef.current = setInterval(() => {
      if (video.readyState >= 2) {
        context.drawImage(video, 0, 0, 768, 768)
        const base64 = canvas.toDataURL('image/jpeg', 0.7).replace(/^data:image\/jpeg;base64,/, '')
        window.__latestScreenFrame = base64
        onFrame?.(base64)
      }
    }, 1000)

    const track = stream.getVideoTracks()[0]
    if (track) {
      track.onended = () => stop()
    }
  }, [onFrame, stop])

  return { start, stop, active, streamRef }
}
