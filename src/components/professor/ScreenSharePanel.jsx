import { useEffect, useRef, useState } from 'react'
import useScreenCapture from '../../hooks/useScreenCapture'
import StatusDot from '../shared/StatusDot'

export default function ScreenSharePanel() {
  const previewRef = useRef(null)
  const [error, setError] = useState('')
  const capture = useScreenCapture()

  useEffect(() => {
    if (previewRef.current && capture.streamRef.current) {
      previewRef.current.srcObject = capture.streamRef.current
    }
  }, [capture.active, capture.streamRef])

  const handleStart = async () => {
    try {
      setError('')
      await capture.start()
    } catch (captureError) {
      setError(captureError.message || 'Screen sharing failed.')
    }
  }

  return (
    <section className="glass-card" style={{ padding: 24 }}>
      {!capture.active ? (
        <div>
          <div style={{ fontSize: 40, color: 'var(--secondary)' }}>🖥️</div>
          <h3 style={{ fontSize: 18, margin: '12px 0 8px' }}>Live Screen Share</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
            Share your screen so Gemini can see your slides, annotations, and anything you draw in real time
          </p>
          <button type="button" aria-label="Share your screen" className="btn-secondary" onClick={handleStart}>
            Share Screen
          </button>
          {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}
        </div>
      ) : (
        <div className="animate-fade-in">
          <div
            style={{
              overflow: 'hidden',
              borderRadius: 16,
              aspectRatio: '16 / 9',
              background: 'rgba(255,255,255,0.03)',
              maxHeight: 160,
            }}
          >
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              aria-label="Live screen share preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <StatusDot color="var(--secondary)" />
            <span style={{ fontSize: 14 }}>Gemini can see your screen</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
            1 frame/second is captured and analyzed
          </p>

          <button
            type="button"
            aria-label="Stop sharing screen"
            className="btn-danger"
            style={{ marginTop: 18 }}
            onClick={capture.stop}
          >
            Stop Sharing
          </button>
        </div>
      )}
    </section>
  )
}
