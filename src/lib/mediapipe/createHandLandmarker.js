import { getVisionWasmRoot, HAND_LANDMARKER_TASK_URL } from './constants'

/**
 * @param {import('@mediapipe/tasks-vision').FilesetResolver} visionFiles
 * @param {typeof import('@mediapipe/tasks-vision').HandLandmarker} HandLandmarker
 */
export async function createHandLandmarker(visionFiles, HandLandmarker) {
  const baseOptions = {
    modelAssetPath: HAND_LANDMARKER_TASK_URL,
  }

  try {
    return await HandLandmarker.createFromOptions(visionFiles, {
      baseOptions: { ...baseOptions, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    })
  } catch {
    return HandLandmarker.createFromOptions(visionFiles, {
      baseOptions,
      runningMode: 'VIDEO',
      numHands: 1,
    })
  }
}

export async function loadHandLandmarkerModule() {
  const vision = await import('@mediapipe/tasks-vision')
  const visionFiles = await vision.FilesetResolver.forVisionTasks(getVisionWasmRoot())
  const landmarker = await createHandLandmarker(visionFiles, vision.HandLandmarker)
  return { vision, landmarker, close: () => landmarker.close?.() }
}
