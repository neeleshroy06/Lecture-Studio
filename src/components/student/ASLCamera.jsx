import { useEffect, useMemo, useRef, useState } from 'react'
import useASLClassifier from '../../hooks/useASLClassifier'
import { getTrainedLetters, saveSample, saveToStorage } from '../../utils/gestureModel'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default function ASLCamera({ onSpelledWord, active }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [spelledLetters, setSpelledLetters] = useState([])
  const [trainingOpen, setTrainingOpen] = useState(false)
  const [selectedLetter, setSelectedLetter] = useState('A')
  const [sampleCounts, setSampleCounts] = useState({})
  const [error, setError] = useState('')
  const idleTimerRef = useRef(null)
  const classifier = useASLClassifier({
    onLetter: (letter) => {
      setSpelledLetters((value) => [...value, letter])
    },
  })

  useEffect(() => {
    if (!active) {
      classifier.stopASL()
      return undefined
    }

    const start = async () => {
      try {
        setError('')
        await classifier.startASL(videoRef.current, canvasRef.current)
      } catch (cameraError) {
        setError(cameraError.message || 'Unable to start ASL camera.')
      }
    }

    start()
    return () => {
      classifier.stopASL()
    }
  }, [active])

  useEffect(() => {
    clearTimeout(idleTimerRef.current)
    if (!spelledLetters.length) return undefined

    idleTimerRef.current = setTimeout(() => {
      onSpelledWord?.(spelledLetters.join(''))
      setSpelledLetters([])
    }, 1500)

    return () => clearTimeout(idleTimerRef.current)
  }, [spelledLetters, onSpelledWord])

  const trainedLetters = useMemo(() => new Set(getTrainedLetters()), [trainingOpen, sampleCounts])
  const currentWordDisplay = spelledLetters.join(' · ')
  const currentCount = sampleCounts[selectedLetter] || 0

  const captureSample = () => {
    if (!classifier.landmarks) return
    saveSample(selectedLetter, classifier.landmarks)
    const nextCount = currentCount + 1
    const nextCounts = { ...sampleCounts, [selectedLetter]: nextCount }
    setSampleCounts(nextCounts)

    if (nextCount >= 5) {
      const nextIndex = LETTERS.indexOf(selectedLetter) + 1
      if (nextIndex < LETTERS.length) {
        setSelectedLetter(LETTERS[nextIndex])
      }
    }
  }

  if (!active) return null

  return (
    <div className="glass-card" style={{ position: 'relative', flex: 1, overflow: 'hidden', minHeight: 320 }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="ASL recognition camera"
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }}
      />

      <button
        type="button"
        aria-label="Open ASL training modal"
        className="btn-secondary"
        style={{ position: 'absolute', top: 12, left: 12, padding: '8px 12px' }}
        onClick={() => setTrainingOpen(true)}
      >
        ⚙ Train ASL
      </button>

      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 999,
          padding: '10px 18px',
          minWidth: 110,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 80, fontWeight: 700, lineHeight: 1, textShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
          {classifier.currentLetter || '·'}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          background: 'rgba(10,10,15,0.76)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 24, color: 'var(--primary)', minHeight: 30 }}>
          {currentWordDisplay || 'Start fingerspelling...'}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button type="button" aria-label="Clear spelled word" className="btn-secondary" onClick={() => setSpelledLetters([])}>
            Clear
          </button>
          <button
            type="button"
            aria-label="Send spelled word"
            className="btn-secondary"
            onClick={() => {
              if (!spelledLetters.length) return
              onSpelledWord?.(spelledLetters.join(''))
              setSpelledLetters([])
            }}
          >
            Send ↵
          </button>
        </div>
      </div>

      {error && (
        <div style={{ position: 'absolute', left: 12, right: 12, top: 64, color: 'var(--danger)' }}>{error}</div>
      )}

      {trainingOpen && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(8px)',
            padding: 24,
            overflow: 'auto',
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 20 }}>Train Your Sign Recognition</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 18 }}>
            Train each letter by holding the hand sign still and pressing Capture 5 times
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
            {LETTERS.map((letter) => (
              <button
                key={letter}
                type="button"
                aria-label={`Select letter ${letter} for training`}
                onClick={() => setSelectedLetter(letter)}
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.08)',
                  padding: 14,
                  background: selectedLetter === letter ? 'var(--primary)' : 'rgba(255,255,255,0.04)',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                <div>{letter}</div>
                {trainedLetters.has(letter) && <div style={{ color: 'var(--secondary)', fontSize: 12 }}>●</div>}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, alignItems: 'center', marginTop: 24 }}>
            <div style={{ fontSize: 100, fontWeight: 700, color: 'var(--primary)', textAlign: 'center' }}>{selectedLetter}</div>
            <div
              className="glass-card"
              style={{ width: 220, height: 160, overflow: 'hidden', justifySelf: 'center', position: 'relative' }}
            >
              <video
                autoPlay
                playsInline
                muted
                aria-label="Training camera preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                ref={(node) => {
                  if (node && videoRef.current?.srcObject && node.srcObject !== videoRef.current.srcObject) {
                    node.srcObject = videoRef.current.srcObject
                    node.play().catch(() => {})
                  }
                }}
              />
            </div>
          </div>

          <button
            type="button"
            aria-label="Capture ASL training sample"
            className="btn-primary"
            style={{ marginTop: 18 }}
            onClick={captureSample}
          >
            Capture Sample
          </button>

          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 6 }}>{currentCount} / 5 samples captured for this letter</div>
            <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (currentCount / 5) * 100)}%`,
                  background: 'var(--secondary)',
                  borderRadius: 999,
                }}
              />
            </div>
          </div>

          <button
            type="button"
            aria-label="Save training samples and close modal"
            className="btn-secondary"
            style={{ marginTop: 22 }}
            onClick={() => {
              saveToStorage()
              setTrainingOpen(false)
            }}
          >
            Save &amp; Close
          </button>
        </div>
      )}
    </div>
  )
}
