import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import { resolveRuntimeCalibration } from '../lib/asl/aslCalibrationStorage'
import { classifyNormalizedLandmarks, getBuiltinTemplateRecord } from '../lib/asl/classifyLetter'
import { getHandSpan, mirrorLandmarksX, normalizeLandmarks } from '../lib/asl/landmarks'
import { useMediaPipeHandLandmarks } from './useMediaPipeHandLandmarks'

const MIN_HAND_SPAN = 0.18
const RECOGNITION_UI_THROTTLE_MS = 50

function emptyRecognition(source = 'builtin') {
  return {
    hasHand: false,
    currentLetter: '',
    landmarks: null,
    normalized: null,
    handedness: '',
    classification: null,
    templateSource: source,
    usingPersonalizedTemplates: false,
    updatedAt: 0,
  }
}

/**
 * Fingerspelling classifier on top of {@link useMediaPipeHandLandmarks}.
 * Templates: built-in + optional `public/asl/*.json` (see resolveRuntimeCalibration).
 */
export default function useASLClassifier({ active, videoRef, canvasRef }) {
  const templatesRef = useRef({
    templates: getBuiltinTemplateRecord(),
    source: 'builtin',
    personalized: false,
  })
  const lastUiRef = useRef(0)
  const [recognition, setRecognition] = useState(() => emptyRecognition())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await tf.ready()
      const bundle = await resolveRuntimeCalibration()
      if (cancelled) return
      templatesRef.current = {
        templates: bundle.templates,
        source: bundle.source,
        personalized: bundle.personalized,
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onDetection = useCallback(({ landmarks, handedness }) => {
    const now = Date.now()
    if (now - lastUiRef.current < RECOGNITION_UI_THROTTLE_MS) return
    lastUiRef.current = now

    const bundle = templatesRef.current
    const templateSource = bundle.source || 'builtin'
    const templateRecord = bundle.templates

    if (!landmarks || !templateRecord) {
      setRecognition(emptyRecognition(templateSource))
      return
    }

    const canonicalLandmarks = handedness?.toLowerCase() === 'left' ? mirrorLandmarksX(landmarks) : landmarks
    const handSpan = getHandSpan(canonicalLandmarks)
    const normalized = handSpan >= MIN_HAND_SPAN ? normalizeLandmarks(canonicalLandmarks) : null
    const classification = normalized ? classifyNormalizedLandmarks(normalized, templateRecord) : null
    const displayLetter = classification?.passesDisplayThresholds ? classification.letter : ''

    setRecognition({
      hasHand: Boolean(normalized),
      currentLetter: displayLetter,
      landmarks: canonicalLandmarks,
      normalized,
      handedness: handedness || '',
      classification,
      templateSource,
      usingPersonalizedTemplates: Boolean(classification?.isPersonalized),
      updatedAt: Date.now(),
    })
  }, [])

  const hand = useMediaPipeHandLandmarks({
    active,
    videoRef,
    canvasRef,
    onDetection,
  })

  useEffect(() => {
    if (!active) {
      setRecognition(emptyRecognition(templatesRef.current.source || 'builtin'))
    }
  }, [active])

  return useMemo(
    () => ({
      ...recognition,
      cameraPermission: hand.permission,
      cameraError: hand.error,
      isCameraRunning: hand.isRunning,
      landmarkCount: hand.landmarkCount,
      rawHandedness: hand.handedness,
      stopASL: hand.stop,
      startASL: async () => {},
    }),
    [hand.error, hand.handedness, hand.isRunning, hand.landmarkCount, hand.permission, hand.stop, recognition],
  )
}
