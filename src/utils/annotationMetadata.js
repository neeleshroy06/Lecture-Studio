function clamp01(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(1, Math.max(0, num))
}

function round(value, decimals = 3) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  const scale = 10 ** decimals
  return Math.round(num * scale) / scale
}

function normalizeBounds(bounds = {}) {
  const x = clamp01(bounds.x)
  const y = clamp01(bounds.y)
  const width = Math.min(1 - x, Math.max(0, Number(bounds.width) || 0))
  const height = Math.min(1 - y, Math.max(0, Number(bounds.height) || 0))
  return { x, y, width, height }
}

function deriveBoundsFromPoints(points = []) {
  if (!Array.isArray(points) || !points.length) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const x = clamp01(point?.x)
    const y = clamp01(point?.y)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  }
}

function pointDistance(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0)
  const dy = (a?.y || 0) - (b?.y || 0)
  return Math.hypot(dx, dy)
}

function computePathLength(points = []) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += pointDistance(points[index - 1], points[index])
  }
  return total
}

function computeTurnIntensity(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0
  let totalTurn = 0
  for (let index = 2; index < points.length; index += 1) {
    const prev = points[index - 2]
    const current = points[index - 1]
    const next = points[index]
    const ax = current.x - prev.x
    const ay = current.y - prev.y
    const bx = next.x - current.x
    const by = next.y - current.y
    const magA = Math.hypot(ax, ay)
    const magB = Math.hypot(bx, by)
    if (magA < 0.001 || magB < 0.001) continue
    const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (magA * magB)))
    totalTurn += Math.acos(cosine)
  }
  return totalTurn
}

function buildRegionDescriptor(bounds) {
  const centerX = clamp01(bounds.x + bounds.width / 2)
  const centerY = clamp01(bounds.y + bounds.height / 2)
  const rows = ['top', 'upper', 'center', 'lower', 'bottom']
  const cols = ['left', 'left-center', 'center', 'right-center', 'right']
  const rowIndex = Math.min(rows.length - 1, Math.floor(centerY * rows.length))
  const colIndex = Math.min(cols.length - 1, Math.floor(centerX * cols.length))
  const row = rows[rowIndex]
  const col = cols[colIndex]

  let regionLabel = 'center of the page'
  if (row === 'center' && col !== 'center') regionLabel = `${col} of the page`
  else if (col === 'center' && row !== 'center') regionLabel = `${row} of the page`
  else if (row !== 'center' || col !== 'center') regionLabel = `${row}-${col} of the page`

  return {
    centerX: round(centerX),
    centerY: round(centerY),
    regionKey: `r${rowIndex}c${colIndex}`,
    regionLabel,
  }
}

function inferShapeHint({ tool, bounds, points = [] }) {
  if (tool === 'highlighter') return 'highlight stroke'

  const aspectRatio = bounds.width / Math.max(bounds.height, 0.0001)
  const diagonal = Math.hypot(bounds.width, bounds.height)
  const pathLength = computePathLength(points)
  const turnIntensity = computeTurnIntensity(points)
  const closed = diagonal >= 0.03 && pointDistance(points[0], points[points.length - 1]) <= Math.max(0.02, diagonal * 0.28)
  const normalizedTravel = diagonal > 0 ? pathLength / diagonal : 0

  if (aspectRatio >= 4 && turnIntensity <= 0.8) return 'underline-like mark'
  if (aspectRatio <= 0.35 && turnIntensity <= 0.8) return 'vertical mark'
  if (closed && turnIntensity >= 2.4) return 'loop-like doodle'
  if (normalizedTravel >= 4.5 && turnIntensity >= 3.2) return 'complex doodle'
  if (pathLength <= 0.08) return 'short mark'
  return 'freeform mark'
}

function normalizeWords(values = []) {
  const combined = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
  return combined
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3)
}

function getOverlapRatio(boundsA, boundsB) {
  const left = Math.max(boundsA.x, boundsB.x)
  const top = Math.max(boundsA.y, boundsB.y)
  const right = Math.min(boundsA.x + boundsA.width, boundsB.x + boundsB.width)
  const bottom = Math.min(boundsA.y + boundsA.height, boundsB.y + boundsB.height)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  const overlapArea = width * height
  if (!overlapArea) return 0
  const minArea = Math.max(0.0001, Math.min(boundsA.width * boundsA.height, boundsB.width * boundsB.height))
  return overlapArea / minArea
}

function getBoundsGap(boundsA, boundsB) {
  const dx = Math.max(0, Math.max(boundsA.x - (boundsB.x + boundsB.width), boundsB.x - (boundsA.x + boundsA.width)))
  const dy = Math.max(0, Math.max(boundsA.y - (boundsB.y + boundsB.height), boundsB.y - (boundsA.y + boundsA.height)))
  return Math.hypot(dx, dy)
}

export function computeStrokeMetadata(stroke = {}) {
  const points = Array.isArray(stroke.points) ? stroke.points : []
  const bounds = normalizeBounds(stroke.bounds && stroke.bounds.width >= 0 ? stroke.bounds : deriveBoundsFromPoints(points))
  const region = buildRegionDescriptor(bounds)
  const shapeHint = inferShapeHint({
    tool: stroke.tool === 'highlighter' ? 'highlighter' : 'pen',
    bounds,
    points,
  })
  const pathLength = computePathLength(points)
  const turnIntensity = computeTurnIntensity(points)
  const aspectRatio = bounds.width / Math.max(bounds.height, 0.0001)
  const diagonal = Math.hypot(bounds.width, bounds.height)

  return {
    ...region,
    bounds,
    pointCount: points.length,
    pathLength: round(pathLength),
    turnIntensity: round(turnIntensity, 2),
    aspectRatio: round(aspectRatio, 2),
    normalizedTravel: round(diagonal > 0 ? pathLength / diagonal : 0, 2),
    isClosed: diagonal >= 0.03 && points.length >= 3 && pointDistance(points[0], points[points.length - 1]) <= Math.max(0.02, diagonal * 0.28),
    shapeHint,
  }
}

export function sharedNearbyTextCount(leftStroke = {}, rightStroke = {}) {
  const leftWords = new Set(normalizeWords([leftStroke.nearbyText, leftStroke.annotationLabel]))
  if (!leftWords.size) return 0
  let count = 0
  for (const word of normalizeWords([rightStroke.nearbyText, rightStroke.annotationLabel])) {
    if (leftWords.has(word)) count += 1
  }
  return count
}

export function shouldMergeAnnotationStrokes(previousStroke, nextStroke, options = {}) {
  if (!previousStroke || !nextStroke) return false
  if (Number(previousStroke.page) !== Number(nextStroke.page)) return false

  const maxGapMs = Math.max(500, Number(options.maxGapMs) || 3500)
  const gapMs = Math.max(0, Number(nextStroke.startedAtMs ?? 0) - Number(previousStroke.endedAtMs ?? previousStroke.startedAtMs ?? 0))
  if (gapMs > maxGapMs) return false

  const previousMeta = computeStrokeMetadata(previousStroke)
  const nextMeta = computeStrokeMetadata(nextStroke)
  const overlapRatio = getOverlapRatio(previousMeta.bounds, nextMeta.bounds)
  const boundsGap = getBoundsGap(previousMeta.bounds, nextMeta.bounds)
  const centerDistance = Math.hypot(previousMeta.centerX - nextMeta.centerX, previousMeta.centerY - nextMeta.centerY)
  const sharedText = sharedNearbyTextCount(previousStroke, nextStroke)

  if (sharedText > 0 && gapMs <= maxGapMs) return true
  if (overlapRatio >= 0.18) return true
  if (boundsGap <= 0.04 && centerDistance <= 0.08) return true
  if (previousMeta.regionKey === nextMeta.regionKey && previousStroke.tool === nextStroke.tool && gapMs <= 1200 && centerDistance <= 0.05) {
    return true
  }

  return false
}
