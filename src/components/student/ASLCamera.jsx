import { useCallback, useEffect, useRef, useState } from 'react'
import useASLClassifier from '../../hooks/useASLClassifier'
import { pickPluralityLetter } from '../../lib/asl/landmarks'

/** Hold a stable letter prediction for this long before committing it. */
const LETTER_HOLD_MS = 2000
/** Minimum pause after committing a letter before the next vote window starts. */
const GAP_AFTER_LETTER_MS = 250
/** No hand in frame for this long → insert a space (after a letter). */
const IDLE_SPACE_MS = 2000
/** No hand in frame for this long → send buffer to Gemini Live. */
const IDLE_SEND_MS = 4000

function sentenceCase(value) {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export default function ASLCamera({ onSpelledWord, active }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [spelledText, setSpelledText] = useState('')

  const votesRef = useRef(new Map())
  const captureWindowStartRef = useRef(0)
  const lastCommitAtRef = useRef(0)
  const lastHandSeenAtRef = useRef(0)

  const classifier = useASLClassifier({ active, videoRef, canvasRef })

  const clearVoteWindow = useCallback(() => {
    votesRef.current = new Map()
    captureWindowStartRef.current = 0
  }, [])

  const commitWinningLetter = useCallback(
    (timestamp, force = false) => {
      if (!captureWindowStartRef.current || !votesRef.current.size) return false
      const captureAge = timestamp - captureWindowStartRef.current
      const totalVotes = Array.from(votesRef.current.values()).reduce((sum, count) => sum + count, 0)
      if (!force && captureAge < LETTER_HOLD_MS) return false
      if (force && (captureAge < LETTER_HOLD_MS * 0.55 || totalVotes < 2)) return false

      const letter = pickPluralityLetter(votesRef.current)
      clearVoteWindow()
      if (!letter) return false

      setSpelledText((value) => value + letter)
      lastCommitAtRef.current = timestamp
      return true
    },
    [clearVoteWindow],
  )

  const flushText = useCallback(() => {
    const text = sentenceCase(spelledText)
    if (!text) return
    onSpelledWord?.(text)
    setSpelledText('')
    clearVoteWindow()
  }, [clearVoteWindow, onSpelledWord, spelledText])

  useEffect(() => {
    if (!active) {
      setSpelledText('')
      clearVoteWindow()
      lastCommitAtRef.current = 0
      lastHandSeenAtRef.current = 0
    }
  }, [active, clearVoteWindow])

  useEffect(() => {
    if (!active) return undefined

    const timestamp = classifier.updatedAt || Date.now()
    const predictedLetter = classifier.classification?.passesCommitThresholds ? classifier.classification.letter : ''

    if (classifier.hasHand) {
      lastHandSeenAtRef.current = timestamp

      if (predictedLetter && timestamp - lastCommitAtRef.current >= GAP_AFTER_LETTER_MS) {
        if (!captureWindowStartRef.current) {
          captureWindowStartRef.current = timestamp
        }
        const nextVotes = new Map(votesRef.current)
        nextVotes.set(predictedLetter, (nextVotes.get(predictedLetter) || 0) + 1)
        votesRef.current = nextVotes
        commitWinningLetter(timestamp)
      }
      return undefined
    }

    commitWinningLetter(timestamp, true)

    if (!spelledText.trim()) return undefined

    const idleFor = lastHandSeenAtRef.current ? timestamp - lastHandSeenAtRef.current : 0
    if (idleFor >= IDLE_SEND_MS) {
      flushText()
      return undefined
    }

    if (idleFor >= IDLE_SPACE_MS && !spelledText.endsWith(' ')) {
      setSpelledText((value) => (value.endsWith(' ') ? value : `${value} `))
    }

    return undefined
  }, [active, classifier.classification, classifier.hasHand, classifier.updatedAt, commitWinningLetter, flushText, spelledText])

  if (!active) return null

  const cameraIssue = classifier.cameraError
  const trackingOk = classifier.landmarkCount === 21 && classifier.isCameraRunning

  return (
    <div
      className="glass-card"
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 16,
      }}
    >
      <div
        style={{
          position: 'relative',
          flex: '1 1 0',
          minHeight: 200,
          width: '100%',
          background: '#07070c',
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="ASL camera"
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', pointerEvents: 'none' }}
        />

        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.45)',
            fontSize: 11,
            color: 'rgba(255,255,255,0.88)',
            letterSpacing: '0.02em',
          }}
        >
          {cameraIssue ? 'No camera' : trackingOk ? `${classifier.rawHandedness || 'Hand'} · 21 pts` : classifier.isCameraRunning ? 'Show hand' : '…'}
        </div>

        {cameraIssue && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              top: 48,
              color: 'var(--danger)',
              fontSize: 12,
              lineHeight: 1.35,
            }}
          >
            {cameraIssue}
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '14px 16px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-raised)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1,
              color: 'var(--primary)',
              minWidth: 56,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {classifier.currentLetter || '·'}
          </div>
          <div
            style={{
              flex: 1,
              fontSize: 17,
              fontWeight: 500,
              color: 'var(--text-primary)',
              minHeight: 26,
              wordBreak: 'break-word',
            }}
          >
            {spelledText || <span style={{ color: 'var(--text-muted)' }}>Spelled text appears here</span>}
          </div>
        </div>

        <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Hold each letter ~2s · hand away ~2s for space · hand away ~4s to send
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => {
              setSpelledText('')
              clearVoteWindow()
            }}
          >
            Clear
          </button>
          <button type="button" className="btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={() => flushText()}>
            Send now
          </button>
        </div>
      </div>
    </div>
  )
}
