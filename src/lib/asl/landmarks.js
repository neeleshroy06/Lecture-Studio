const WRIST_INDEX = 0
const MIDDLE_MCP_INDEX = 9

export function flattenLandmarks(landmarks = []) {
  return landmarks.flatMap((landmark) => [landmark.x, landmark.y, landmark.z])
}

export function mirrorLandmarksX(landmarks = []) {
  return landmarks.map((landmark) => ({
    x: 1 - landmark.x,
    y: landmark.y,
    z: landmark.z,
  }))
}

export function getHandSpan(landmarks = []) {
  if (!landmarks.length) return 0

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  landmarks.forEach(({ x, y }) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  })

  return Math.max(maxX - minX, maxY - minY)
}

export function normalizeLandmarks(landmarks = []) {
  if (landmarks.length !== 21) return null

  const wrist = landmarks[WRIST_INDEX]
  const middleMcp = landmarks[MIDDLE_MCP_INDEX]
  const scale = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y, middleMcp.z - wrist.z)

  if (!Number.isFinite(scale) || scale < 1e-5) return null

  return flattenLandmarks(
    landmarks.map((landmark) => ({
      x: (landmark.x - wrist.x) / scale,
      y: (landmark.y - wrist.y) / scale,
      z: (landmark.z - wrist.z) / scale,
    })),
  )
}

export function l2Distance(a = [], b = []) {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index]
    sum += delta * delta
  }
  return Math.sqrt(sum)
}

export function averageVectors(vectors = []) {
  if (!vectors.length) return null
  const width = vectors[0]?.length || 0
  if (!width) return null

  const output = new Array(width).fill(0)
  vectors.forEach((vector) => {
    for (let index = 0; index < width; index += 1) {
      output[index] += vector[index] || 0
    }
  })

  return output.map((value) => value / vectors.length)
}

export function pickPluralityLetter(votes) {
  let bestLetter = ''
  let bestCount = 0

  votes.forEach((count, letter) => {
    if (count > bestCount || (count === bestCount && letter < bestLetter)) {
      bestLetter = letter
      bestCount = count
    }
  })

  return bestLetter
}
