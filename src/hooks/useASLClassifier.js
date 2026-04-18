import { useCallback, useEffect, useRef, useState } from 'react'
import { classify, loadFromStorage } from '../utils/gestureModel'

export default function useASLClassifier({ onLetter } = {}) {
  const handsRef = useRef(null)
  const cameraRef = useRef(null)
  const streamRef = useRef(null)
  const [currentLetter, setCurrentLetter] = useState('')
  const [landmarks, setLandmarks] = useState(null)
  const lastLetterRef = useRef('')
  const lastLetterTimeRef = useRef(0)

  useEffect(() => {
    loadFromStorage()
  }, [])

  const stopASL = useCallback(() => {
    cameraRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    cameraRef.current = null
    streamRef.current = null
    handsRef.current = null
    setCurrentLetter('')
    setLandmarks(null)
  }, [])

  const startASL = useCallback(
    async (videoElement, canvasElement) => {
      if (!window.Hands || !window.Camera) {
        throw new Error('MediaPipe Hands is not available.')
      }

      const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      })

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      })

      hands.onResults((results) => {
        const context = canvasElement?.getContext('2d')
        if (canvasElement && context) {
          canvasElement.width = videoElement.videoWidth || canvasElement.clientWidth || 640
          canvasElement.height = videoElement.videoHeight || canvasElement.clientHeight || 480
          context.clearRect(0, 0, canvasElement.width, canvasElement.height)

          if (results.multiHandLandmarks?.length) {
            window.drawConnectors(context, results.multiHandLandmarks[0], window.HAND_CONNECTIONS, {
              color: '#6C63FF',
              lineWidth: 3,
            })
            window.drawLandmarks(context, results.multiHandLandmarks[0], {
              color: '#00D4AA',
              lineWidth: 2,
              radius: 3,
            })
          }
        }

        const nextLandmarks = results.multiHandLandmarks?.[0] || null
        setLandmarks(nextLandmarks)

        if (!nextLandmarks) {
          setCurrentLetter('')
          lastLetterRef.current = ''
          return
        }

        const letter = classify(nextLandmarks)
        setCurrentLetter(letter || '')

        const now = Date.now()
        if (letter && letter === lastLetterRef.current && now - lastLetterTimeRef.current >= 600) {
          onLetter?.(letter)
          lastLetterTimeRef.current = Date.now() + 800
        } else if (letter !== lastLetterRef.current) {
          lastLetterRef.current = letter
          lastLetterTimeRef.current = now
        }
      })

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      videoElement.srcObject = stream
      await videoElement.play()

      const camera = new window.Camera(videoElement, {
        onFrame: async () => {
          await hands.send({ image: videoElement })
        },
        width: 640,
        height: 480,
      })

      handsRef.current = hands
      cameraRef.current = camera
      camera.start()
    },
    [onLetter],
  )

  return { startASL, stopASL, currentLetter, landmarks }
}
