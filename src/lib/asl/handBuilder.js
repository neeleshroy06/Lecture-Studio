import { normalizeLandmarks } from './landmarks'

const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky']

const MCP_POINTS = {
  index: { x: -0.24, y: -0.44, z: 0.02 },
  middle: { x: 0.0, y: -0.5, z: 0.0 },
  ring: { x: 0.22, y: -0.46, z: 0.02 },
  pinky: { x: 0.42, y: -0.38, z: 0.05 },
}

const FINGER_LENGTHS = {
  index: [0.34, 0.24, 0.18],
  middle: [0.38, 0.27, 0.2],
  ring: [0.34, 0.23, 0.17],
  pinky: [0.25, 0.18, 0.14],
}

const CURL_DIRECTIONS = {
  index: 1,
  middle: 0.35,
  ring: -0.35,
  pinky: -1,
}

const BASE_HAND = {
  wrist: { x: 0, y: 0, z: 0 },
  thumbCmc: { x: -0.24, y: -0.1, z: 0.02 },
  thumbMcp: { x: -0.36, y: -0.02, z: 0.02 },
}

const DEFAULT_TEMPLATE = {
  thumb: { angle: 150, curl: 0.35, spreadY: 0.02, zTilt: -0.02 },
  index: { curl: 0.05, spread: 0.02 },
  middle: { curl: 0.05, spread: 0.0 },
  ring: { curl: 0.08, spread: -0.02 },
  pinky: { curl: 0.12, spread: -0.06 },
}

const LETTER_CONFIGS = {
  A: { thumb: { angle: 142, curl: 0.18, spreadY: -0.02 }, index: { curl: 1 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 0.95 } },
  B: { thumb: { angle: 182, curl: 0.9, spreadY: 0.04 }, pinky: { curl: 0.02, spread: -0.02 } },
  C: { thumb: { angle: 132, curl: 0.42, spreadY: 0.04 }, index: { curl: 0.42, spread: 0.05 }, middle: { curl: 0.48 }, ring: { curl: 0.52 }, pinky: { curl: 0.56, spread: -0.02 } },
  D: { thumb: { angle: 166, curl: 0.72 }, index: { curl: 0.02, spread: 0.03 }, middle: { curl: 0.94 }, ring: { curl: 0.96 }, pinky: { curl: 0.96 } },
  E: { thumb: { angle: 186, curl: 0.76, spreadY: 0.06 }, index: { curl: 0.9 }, middle: { curl: 0.88 }, ring: { curl: 0.86 }, pinky: { curl: 0.84 } },
  F: { thumb: { angle: 172, curl: 0.72, spreadY: 0.03 }, index: { curl: 0.62, spread: 0.05 }, middle: { curl: 0.03 }, ring: { curl: 0.04 }, pinky: { curl: 0.06 } },
  G: { thumb: { angle: 132, curl: 0.28, spreadY: -0.05 }, index: { curl: 0.08, spread: 0.34 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 0.98 } },
  H: { thumb: { angle: 160, curl: 0.68, spreadY: 0.02 }, index: { curl: 0.04, spread: 0.26 }, middle: { curl: 0.05, spread: 0.16 }, ring: { curl: 0.96 }, pinky: { curl: 0.98 } },
  I: { thumb: { angle: 182, curl: 0.84 }, index: { curl: 0.98 }, middle: { curl: 0.98 }, ring: { curl: 0.96 }, pinky: { curl: 0.04, spread: -0.08 } },
  J: { thumb: { angle: 178, curl: 0.84 }, index: { curl: 0.98 }, middle: { curl: 0.98 }, ring: { curl: 0.96 }, pinky: { curl: 0.28, spread: -0.08 } },
  K: { thumb: { angle: 144, curl: 0.18, spreadY: -0.02 }, index: { curl: 0.04, spread: 0.1 }, middle: { curl: 0.06, spread: -0.08 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  L: { thumb: { angle: 132, curl: 0.08, spreadY: -0.04 }, index: { curl: 0.03, spread: 0.05 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  M: { thumb: { angle: 190, curl: 0.96, spreadY: 0.12 }, index: { curl: 0.92 }, middle: { curl: 0.9 }, ring: { curl: 0.88 }, pinky: { curl: 0.24 } },
  N: { thumb: { angle: 190, curl: 0.92, spreadY: 0.08 }, index: { curl: 0.9 }, middle: { curl: 0.88 }, ring: { curl: 0.34 }, pinky: { curl: 0.98 } },
  O: { thumb: { angle: 140, curl: 0.48, spreadY: 0.06 }, index: { curl: 0.58, spread: 0.04 }, middle: { curl: 0.6 }, ring: { curl: 0.64 }, pinky: { curl: 0.68 } },
  P: { thumb: { angle: 146, curl: 0.22, spreadY: -0.02 }, index: { curl: 0.14, spread: 0.12 }, middle: { curl: 0.18, spread: -0.1 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  Q: { thumb: { angle: 134, curl: 0.22, spreadY: -0.05 }, index: { curl: 0.24, spread: 0.3 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 0.96 } },
  R: { thumb: { angle: 178, curl: 0.78 }, index: { curl: 0.04, spread: 0.02 }, middle: { curl: 0.05, spread: -0.01, zLift: -0.1 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  S: { thumb: { angle: 148, curl: 0.18, spreadY: -0.04 }, index: { curl: 1 }, middle: { curl: 1 }, ring: { curl: 0.98 }, pinky: { curl: 0.96 } },
  T: { thumb: { angle: 170, curl: 0.1, spreadY: -0.04 }, index: { curl: 1 }, middle: { curl: 1 }, ring: { curl: 0.98 }, pinky: { curl: 0.96 } },
  U: { thumb: { angle: 182, curl: 0.88 }, index: { curl: 0.04, spread: 0.02 }, middle: { curl: 0.05, spread: -0.02 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  V: { thumb: { angle: 180, curl: 0.84 }, index: { curl: 0.04, spread: 0.12 }, middle: { curl: 0.04, spread: -0.12 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  W: { thumb: { angle: 184, curl: 0.88 }, index: { curl: 0.04, spread: 0.12 }, middle: { curl: 0.04, spread: 0.0 }, ring: { curl: 0.06, spread: -0.12 }, pinky: { curl: 1 } },
  X: { thumb: { angle: 182, curl: 0.86 }, index: { curl: 0.54, spread: 0.03 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 1 } },
  Y: { thumb: { angle: 126, curl: 0.06, spreadY: -0.04 }, index: { curl: 1 }, middle: { curl: 1 }, ring: { curl: 1 }, pinky: { curl: 0.04, spread: -0.1 } },
  Z: { thumb: { angle: 166, curl: 0.76 }, index: { curl: 0.16, spread: 0.03 }, middle: { curl: 0.98 }, ring: { curl: 1 }, pinky: { curl: 1 } },
}

function degToRad(value) {
  return (value * Math.PI) / 180
}

function mergeConfig(letter) {
  const specific = LETTER_CONFIGS[letter] || {}
  return {
    thumb: { ...DEFAULT_TEMPLATE.thumb, ...specific.thumb },
    index: { ...DEFAULT_TEMPLATE.index, ...specific.index },
    middle: { ...DEFAULT_TEMPLATE.middle, ...specific.middle },
    ring: { ...DEFAULT_TEMPLATE.ring, ...specific.ring },
    pinky: { ...DEFAULT_TEMPLATE.pinky, ...specific.pinky },
  }
}

function buildFingerChain({ mcp, name, config }) {
  const lengths = FINGER_LENGTHS[name]
  const curl = Math.max(0, Math.min(1, config.curl ?? 0))
  const baseAngle = degToRad(-90 + (config.spread || 0) * 90)
  const bendDirection = CURL_DIRECTIONS[name]
  const bendAngles = [40, 58, 76]

  const points = []
  let current = { ...mcp }
  let angle = baseAngle

  for (let index = 0; index < lengths.length; index += 1) {
    angle += degToRad(curl * bendAngles[index] * bendDirection)
    current = {
      x: current.x + Math.cos(angle) * lengths[index] * (1 - curl * 0.08),
      y: current.y + Math.sin(angle) * lengths[index] * (1 - curl * 0.08),
      z: current.z - curl * (0.05 + index * 0.04) + (config.zLift || 0),
    }
    points.push(current)
  }

  return points
}

function buildThumbChain(config) {
  const lengths = [0.14, 0.12]
  const curl = Math.max(0, Math.min(1, config.curl ?? 0))
  const baseAngle = degToRad(config.angle ?? 150)
  const bendAngles = [-26, -34, -48]
  const points = [{ ...BASE_HAND.thumbCmc }, { ...BASE_HAND.thumbMcp }]
  let current = { ...BASE_HAND.thumbMcp }
  let angle = baseAngle

  for (let index = 0; index < lengths.length; index += 1) {
    angle += degToRad(curl * bendAngles[index])
    current = {
      x: current.x + Math.cos(angle) * lengths[index],
      y: current.y + Math.sin(angle) * lengths[index] + (config.spreadY || 0),
      z: current.z + (config.zTilt || 0) - curl * 0.03 * index,
    }
    points.push(current)
  }

  return points
}

function applyLetterTweaks(letter, landmarks) {
  if (letter === 'R') {
    landmarks[8].x = landmarks[12].x + 0.02
    landmarks[8].z -= 0.05
  }

  if (letter === 'M') {
    landmarks[4].x = landmarks[16].x - 0.02
    landmarks[4].y = landmarks[16].y + 0.08
  }

  if (letter === 'N') {
    landmarks[4].x = landmarks[12].x + 0.02
    landmarks[4].y = landmarks[12].y + 0.08
  }

  if (letter === 'T') {
    landmarks[4].x = landmarks[8].x + 0.03
    landmarks[4].y = landmarks[8].y + 0.08
  }

  return landmarks
}

export function idealLandmarksForLetter(letter) {
  const config = mergeConfig(letter)
  const indexChain = buildFingerChain({ mcp: MCP_POINTS.index, name: 'index', config: config.index })
  const middleChain = buildFingerChain({ mcp: MCP_POINTS.middle, name: 'middle', config: config.middle })
  const ringChain = buildFingerChain({ mcp: MCP_POINTS.ring, name: 'ring', config: config.ring })
  const pinkyChain = buildFingerChain({ mcp: MCP_POINTS.pinky, name: 'pinky', config: config.pinky })
  const thumbChain = buildThumbChain(config.thumb)

  return applyLetterTweaks(letter, [
    { ...BASE_HAND.wrist },
    thumbChain[0],
    thumbChain[1],
    thumbChain[2],
    thumbChain[3],
    { ...MCP_POINTS.index },
    ...indexChain,
    { ...MCP_POINTS.middle },
    ...middleChain,
    { ...MCP_POINTS.ring },
    ...ringChain,
    { ...MCP_POINTS.pinky },
    ...pinkyChain,
  ])
}

export function getIdealNormalized(letter) {
  return normalizeLandmarks(idealLandmarksForLetter(letter))
}

export function getBuiltinTemplateLetters() {
  return Object.keys(LETTER_CONFIGS)
}

export function getBuiltinTemplates() {
  return getBuiltinTemplateLetters().reduce((templates, letter) => {
    const vector = getIdealNormalized(letter)
    if (vector) templates[letter] = { count: 1, vector }
    return templates
  }, {})
}

export { FINGER_NAMES }
