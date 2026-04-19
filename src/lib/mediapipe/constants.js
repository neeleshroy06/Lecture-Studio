/** Pin to the installed @mediapipe/tasks-vision version so WASM matches the JS API. */
export const TASKS_VISION_VERSION = '0.10.34'

export const HAND_LANDMARKER_TASK_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export function getVisionWasmRoot() {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`
}

/** MediaPipe hand model: 21 landmarks per hand. */
export const HAND_LANDMARK_COUNT = 21
