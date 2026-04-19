import { useCallback, useEffect, useRef, useState } from 'react'
import { HAND_LANDMARK_COUNT } from '../lib/mediapipe/constants'
import { drawHandLandmarksOverlay, isFullHandLandmarkSet } from '../lib/mediapipe/drawHandOverlay'
import { loadHandLandmarkerModule } from '../lib/mediapipe/createHandLandmarker'

const DEFAULT_INFERENCE_EVERY_MS = 33

function mapGetUserMediaError(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Allow camera access in the browser address bar, then try again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is in use by another app or could not be started.'
  }
  if (name === 'OverconstrainedError') {
    return 'Camera constraints could not be satisfied.'
  }
  return error?.message || 'Unable to access the camera.'
}

/**
 * MediaPipe Tasks HandLandmarker: 21 landmarks per detected hand (image-normalized x,y,z).
 * Manages getUserMedia permission, full camera teardown on stop, and overlay drawing.
 *
 * @param {object} options
 * @param {boolean} options.active When false, stops tracks and releases the camera.
 * @param {React.RefObject<HTMLVideoElement>} options.videoRef
 * @param {React.RefObject<HTMLCanvasElement>} options.canvasRef
 * @param {number} [options.inferenceEveryMs]
 * @param {(payload: { landmarks: Array<{x:number,y:number,z?:number}>|null, handedness: string }) => void} [options.onDetection] Fires after each inference (throttled by inferenceEveryMs).
 */
export function useMediaPipeHandLandmarks({
  active,
  videoRef,
  canvasRef,
  inferenceEveryMs = DEFAULT_INFERENCE_EVERY_MS,
  onDetection,
}) {
  const onDetectionRef = useRef(onDetection)
  onDetectionRef.current = onDetection
  const [permission, setPermission] = useState('unknown')
  const [error, setError] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [handedness, setHandedness] = useState('')
  const [landmarkCount, setLandmarkCount] = useState(0)

  const rafRef = useRef(0)
  const waitRafRef = useRef(0)
  const runIdRef = useRef(0)
  const streamRef = useRef(null)
  const landmarkerRef = useRef(null)
  const landmarkerCloseRef = useRef(null)
  const lastInferenceRef = useRef(0)
  const lastUiUpdateRef = useRef(0)

  const stopCamera = useCallback(() => {
    runIdRef.current += 1
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (waitRafRef.current) {
      cancelAnimationFrame(waitRafRef.current)
      waitRafRef.current = 0
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const video = videoRef.current
    if (video) {
      video.srcObject = null
    }

    landmarkerCloseRef.current?.()
    landmarkerCloseRef.current = null
    landmarkerRef.current = null

    lastInferenceRef.current = 0
    setIsRunning(false)
    setHandedness('')
    setLandmarkCount(0)

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [canvasRef, videoRef])

  useEffect(() => {
    if (!active) {
      stopCamera()
      setError('')
      return undefined
    }

    let cancelled = false
    const runId = runIdRef.current + 1
    runIdRef.current = runId

    setError('')
    setPermission('unknown')

    const runSession = async (video, canvas) => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API is not available in this browser or context (use HTTPS or localhost).')
        }

        const { landmarker, close } = await loadHandLandmarkerModule()
        if (cancelled || runIdRef.current !== runId) {
          close()
          return
        }

        landmarkerRef.current = landmarker
        landmarkerCloseRef.current = close

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        })

        if (cancelled || runIdRef.current !== runId) {
          stream.getTracks().forEach((track) => track.stop())
          close()
          return
        }

        setPermission('granted')
        streamRef.current = stream
        video.srcObject = stream
        video.playsInline = true
        video.muted = true
        await video.play()

        setIsRunning(true)

        const context = canvas.getContext('2d')
        const loop = () => {
          if (cancelled || runIdRef.current !== runId) return
          rafRef.current = requestAnimationFrame(loop)

          if (!landmarkerRef.current || video.readyState < 2 || !context) return

          const now = performance.now()
          if (now - lastInferenceRef.current < inferenceEveryMs) return
          lastInferenceRef.current = now

          canvas.width = video.videoWidth || canvas.clientWidth || 640
          canvas.height = video.videoHeight || canvas.clientHeight || 480
          context.clearRect(0, 0, canvas.width, canvas.height)

          const detection = landmarkerRef.current.detectForVideo(video, now)
          const rawLandmarks = detection?.landmarks?.[0] ?? null
          const nextHandedness = detection?.handednesses?.[0]?.[0]?.categoryName || ''

          if (rawLandmarks && isFullHandLandmarkSet(rawLandmarks)) {
            drawHandLandmarksOverlay(context, rawLandmarks)
          }

          onDetectionRef.current?.({
            landmarks: rawLandmarks && isFullHandLandmarkSet(rawLandmarks) ? rawLandmarks : null,
            handedness: nextHandedness,
          })

          const uiNow = Date.now()
          if (uiNow - lastUiUpdateRef.current > 80) {
            lastUiUpdateRef.current = uiNow
            setHandedness(nextHandedness)
            setLandmarkCount(rawLandmarks && isFullHandLandmarkSet(rawLandmarks) ? HAND_LANDMARK_COUNT : 0)
          }
        }

        loop()
      } catch (cameraError) {
        if (cancelled || runIdRef.current !== runId) return
        const message = mapGetUserMediaError(cameraError)
        setError(message)
        setPermission(cameraError?.name === 'NotAllowedError' || cameraError?.name === 'PermissionDeniedError' ? 'denied' : 'unknown')
        setIsRunning(false)
      }
    }

    const waitForRefs = () => {
      if (cancelled || runIdRef.current !== runId) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) {
        waitRafRef.current = requestAnimationFrame(waitForRefs)
        return
      }
      void runSession(video, canvas)
    }

    waitRafRef.current = requestAnimationFrame(waitForRefs)

    return () => {
      cancelled = true
      if (waitRafRef.current) {
        cancelAnimationFrame(waitRafRef.current)
        waitRafRef.current = 0
      }
      stopCamera()
    }
  }, [active, canvasRef, inferenceEveryMs, stopCamera, videoRef])

  const stop = useCallback(() => {
    stopCamera()
  }, [stopCamera])

  return {
    /** 'unknown' | 'granted' | 'denied' — best-effort from getUserMedia outcome */
    permission,
    error,
    isRunning,
    handedness,
    /** 21 when a full hand is detected, else 0 */
    landmarkCount,
    stop,
  }
}

export { HAND_LANDMARK_COUNT }
