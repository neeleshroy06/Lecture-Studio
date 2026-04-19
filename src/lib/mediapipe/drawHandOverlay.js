import { HAND_LANDMARK_COUNT } from './constants'

/** Standard MediaPipe hand topology (same as legacy Hands HAND_CONNECTIONS). */
export const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
]

/**
 * Draw normalized image-space landmarks (x,y in ~0..1) on a 2D canvas.
 * @param {CanvasRenderingContext2D} context
 * @param {Array<{x:number,y:number,z?:number}>} landmarks
 */
export function drawHandLandmarksOverlay(context, landmarks) {
  if (!context || !landmarks?.length) return

  const width = context.canvas.width
  const height = context.canvas.height

  context.lineWidth = 3
  context.strokeStyle = '#55d8ff'
  HAND_CONNECTIONS.forEach(([from, to]) => {
    const start = landmarks[from]
    const end = landmarks[to]
    if (!start || !end) return
    context.beginPath()
    context.moveTo(start.x * width, start.y * height)
    context.lineTo(end.x * width, end.y * height)
    context.stroke()
  })

  context.fillStyle = '#00d4aa'
  landmarks.forEach((landmark) => {
    context.beginPath()
    context.arc(landmark.x * width, landmark.y * height, 4, 0, Math.PI * 2)
    context.fill()
  })
}

export function isFullHandLandmarkSet(landmarks) {
  return Array.isArray(landmarks) && landmarks.length === HAND_LANDMARK_COUNT
}
