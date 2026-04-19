import * as tf from '@tensorflow/tfjs'
import { getBuiltinTemplates } from './handBuilder'
import { averageVectors, l2Distance } from './landmarks'

const SOFTMAX_TEMPERATURE = 0.5

const BUILTIN_THRESHOLDS = {
  display: { minConfidence: 0.065, minMargin: 0.02, maxDistance: 4.2 },
  commit: { minConfidence: 0.085, minMargin: 0.04, maxDistance: 3.7 },
}

const PERSONALIZED_THRESHOLDS = {
  display: { minConfidence: 0.1, minMargin: 0.04, maxDistance: 2.7 },
  commit: { minConfidence: 0.14, minMargin: 0.06, maxDistance: 2.3 },
}

const builtinTemplates = getBuiltinTemplates()

function softmax(values = []) {
  return tf.tidy(() => tf.softmax(tf.tensor1d(values)).arraySync())
}

function getThresholds(isPersonalized) {
  return isPersonalized ? PERSONALIZED_THRESHOLDS : BUILTIN_THRESHOLDS
}

function toTemplateRecord(source = {}) {
  return Object.entries(source).reduce((templates, [letter, entry]) => {
    const vector = Array.isArray(entry?.vector) ? entry.vector : Array.isArray(entry) ? entry : null
    if (vector?.length === 63) {
      templates[letter] = {
        count: Number(entry?.count) > 0 ? Number(entry.count) : 1,
        vector,
      }
    }
    return templates
  }, {})
}

export function getBuiltinTemplateRecord() {
  return builtinTemplates
}

export async function loadCalibrationTemplates() {
  const candidateUrls = ['/asl/templates.json', '/asl/asl-calibration.json', '/asl/asl-calibration (1).json']

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) continue
      const parsed = await response.json()
      const templates = toTemplateRecord(parsed)
      if (Object.keys(templates).length >= 2) {
        return {
          source: url,
          templates,
          personalized: true,
        }
      }
    } catch {
      // Ignore optional template fetch failures.
    }
  }

  return {
    source: 'builtin',
    templates: builtinTemplates,
    personalized: false,
  }
}

/**
 * Optional JSON under public/asl/ merged on top of built-in procedural templates (per-letter override).
 */
export async function loadCalibrationTemplatesMergedWithBuiltin() {
  const candidateUrls = ['/asl/templates.json', '/asl/asl-calibration.json', '/asl/asl-calibration (1).json']
  const builtin = getBuiltinTemplateRecord()

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) continue
      const parsed = await response.json()
      const fileTemplates = toTemplateRecord(parsed)
      if (Object.keys(fileTemplates).length >= 1) {
        return {
          source: url,
          templates: mergeTemplateSources(builtin, fileTemplates),
          personalized: true,
        }
      }
    } catch {
      // Ignore optional template fetch failures.
    }
  }

  return {
    source: 'builtin',
    templates: builtin,
    personalized: false,
  }
}

export function templatesFromLocalSamples(sampleStore = {}) {
  const record = Object.entries(sampleStore).reduce((templates, [letter, vectors]) => {
    const validVectors = Array.isArray(vectors) ? vectors.filter((vector) => Array.isArray(vector) && vector.length === 63) : []
    if (!validVectors.length) return templates
    const vector = averageVectors(validVectors)
    if (!vector) return templates
    templates[letter] = {
      count: validVectors.length,
      vector,
    }
    return templates
  }, {})

  return Object.keys(record).length >= 2 ? record : null
}

export function classifyNormalizedLandmarks(normalized, templateRecord = builtinTemplates) {
  if (!Array.isArray(normalized) || normalized.length !== 63) return null

  const templates = toTemplateRecord(templateRecord)
  const entries = Object.entries(templates)
  if (!entries.length) return null

  const ranked = entries
    .map(([letter, template]) => ({
      letter,
      distance: l2Distance(normalized, template.vector),
    }))
    .sort((left, right) => left.distance - right.distance)

  const scores = softmax(ranked.map(({ distance }) => -distance / SOFTMAX_TEMPERATURE))
  const best = ranked[0]
  const runnerUp = ranked[1] || ranked[0]
  const bestConfidence = scores[0] || 0
  const margin = Math.max(0, runnerUp.distance - best.distance)
  const isPersonalized = entries.length >= 2 && entries.some(([, template]) => Number(template.count) > 1)
  const thresholds = getThresholds(isPersonalized)

  const passes = (phaseThresholds) =>
    best.distance <= phaseThresholds.maxDistance && bestConfidence >= phaseThresholds.minConfidence && margin >= phaseThresholds.minMargin

  return {
    letter: best.letter,
    confidence: bestConfidence,
    margin,
    bestDistance: best.distance,
    passesDisplayThresholds: passes(thresholds.display),
    passesCommitThresholds: passes(thresholds.commit),
    isPersonalized,
    ranked: ranked.map((entry, index) => ({
      ...entry,
      confidence: scores[index] || 0,
    })),
  }
}

export function mergeTemplateSources(...sources) {
  return sources.reduce((templates, source) => {
    const nextTemplates = toTemplateRecord(source)
    return { ...templates, ...nextTemplates }
  }, {})
}

/**
 * Nearest-neighbor over normalized 63-d landmark vectors vs procedural ideals.
 * J and Z are static approximations only (true ASL uses motion).
 */
