import { loadCalibrationTemplatesMergedWithBuiltin } from './classifyLetter'
import { averageVectors } from './landmarks'

export const SAMPLES_PER_LETTER = 5
const STORAGE_KEY = 'ed_assist_asl_training_samples_v1'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function isValidVector(vector) {
  return Array.isArray(vector) && vector.length === 63 && vector.every((value) => Number.isFinite(value))
}

function sanitizeStore(raw) {
  if (!raw || typeof raw !== 'object') return {}
  return LETTERS.reduce((accumulator, letter) => {
    const entries = raw[letter]
    if (!Array.isArray(entries)) return accumulator
    const vectors = entries.filter(isValidVector).slice(0, SAMPLES_PER_LETTER)
    if (vectors.length) accumulator[letter] = vectors.map((vector) => [...vector])
    return accumulator
  }, {})
}

export function loadTrainingSamples() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitizeStore(JSON.parse(raw))
  } catch {
    return {}
  }
}

function persistTrainingSamples(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeStore(store)))
}

export function getSampleCount(letter, store = loadTrainingSamples()) {
  return Array.isArray(store[letter]) ? store[letter].length : 0
}

/**
 * @param {string} letter A–Z
 * @param {number[]} vector63 normalized landmark vector from {@link normalizeLandmarks}
 */
export function addTrainingSample(letter, vector63) {
  if (!/^[A-Z]$/.test(letter)) {
    return { ok: false, error: 'Pick a letter A–Z.', count: 0 }
  }
  if (!isValidVector(vector63)) {
    return { ok: false, error: 'Hold a clear hand sign (21 landmarks) and try again.', count: 0 }
  }

  const store = loadTrainingSamples()
  const list = Array.isArray(store[letter]) ? [...store[letter]] : []
  if (list.length >= SAMPLES_PER_LETTER) {
    return { ok: false, error: `Already captured ${SAMPLES_PER_LETTER} samples for ${letter}.`, count: list.length }
  }

  list.push([...vector63])
  store[letter] = list
  persistTrainingSamples(store)
  return { ok: true, count: list.length }
}

export function clearTrainingLetter(letter) {
  if (!/^[A-Z]$/.test(letter)) return
  const store = loadTrainingSamples()
  delete store[letter]
  persistTrainingSamples(store)
}

export function clearAllTrainingSamples() {
  localStorage.removeItem(STORAGE_KEY)
}

/** Per-letter averaged templates from captured samples (for merging into the classifier). */
export function getAveragedTemplatesFromTrainingStorage() {
  const store = loadTrainingSamples()
  return Object.entries(store).reduce((templates, [letter, vectors]) => {
    if (!vectors?.length) return templates
    const vector = averageVectors(vectors)
    if (!vector) return templates
    templates[letter] = {
      count: vectors.length,
      vector,
    }
    return templates
  }, {})
}

/** Runtime templates: built-in procedural poses merged with optional `public/asl/*.json` (e.g. asl-calibration.json). */
export async function resolveRuntimeCalibration() {
  return loadCalibrationTemplatesMergedWithBuiltin()
}

/**
 * Export shape matches public ASL JSON: { "A": { "count": 5, "vector": number[] }, ... }
 */
export function buildExportRecordFromTrainingStorage() {
  return getAveragedTemplatesFromTrainingStorage()
}

export function downloadCalibrationJson(filename = 'asl-calibration.json') {
  const record = buildExportRecordFromTrainingStorage()
  const text = JSON.stringify(record, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Import a calibration JSON (averaged vectors). Merges into browser training storage as single centroid per letter.
 */
export function importCalibrationRecordIntoTrainingStorage(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'Invalid JSON object.' }
  }

  const store = loadTrainingSamples()
  let added = 0

  Object.entries(record).forEach(([letter, entry]) => {
    if (!/^[A-Z]$/.test(letter)) return
    const vector = Array.isArray(entry?.vector) ? entry.vector : null
    if (!isValidVector(vector)) return
    store[letter] = [[...vector]]
    added += 1
  })

  if (!added) {
    return { ok: false, error: 'No valid letter entries with a 63-number vector found.' }
  }

  persistTrainingSamples(store)
  return { ok: true, letters: added }
}
