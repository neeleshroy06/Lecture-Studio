const STORAGE_KEY = 'ed_assist_asl_model'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

let model = LETTERS.reduce((accumulator, letter) => {
  accumulator[letter] = []
  return accumulator
}, {})

function flattenLandmarks(landmarks = []) {
  return landmarks.flatMap((landmark) => [landmark.x, landmark.y, landmark.z])
}

export function saveSample(letter, landmarks) {
  if (!letter || !landmarks?.length) return
  const vector = flattenLandmarks(landmarks)
  if (vector.length !== 63) return
  if (!model[letter]) model[letter] = []
  model[letter].push(vector)
}

export function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return model
    const parsed = JSON.parse(raw)
    model = LETTERS.reduce((accumulator, letter) => {
      accumulator[letter] = Array.isArray(parsed?.[letter]) ? parsed[letter] : []
      return accumulator
    }, {})
  } catch {
    model = LETTERS.reduce((accumulator, letter) => {
      accumulator[letter] = []
      return accumulator
    }, {})
  }

  return model
}

export function getTrainedLetters() {
  return Object.entries(model)
    .filter(([, samples]) => samples.length >= 3)
    .map(([letter]) => letter)
}

export function euclidean(a = [], b = []) {
  let sum = 0
  const maxLength = Math.min(a.length, b.length)
  for (let index = 0; index < maxLength; index += 1) {
    sum += (a[index] - b[index]) ** 2
  }
  return Math.sqrt(sum)
}

export function classify(landmarks) {
  const vector = flattenLandmarks(landmarks)
  if (vector.length !== 63) return null

  let bestLetter = null
  let minDistance = Infinity

  Object.entries(model).forEach(([letter, samples]) => {
    samples.forEach((sample) => {
      const distance = euclidean(vector, sample)
      if (distance < minDistance) {
        minDistance = distance
        bestLetter = letter
      }
    })
  })

  return minDistance > 0.5 ? null : bestLetter
}
