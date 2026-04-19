import { useState } from 'react'
import axios from 'axios'

function ChecklistItem({ done, label, optional }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 36 }}>
      <span
        style={{
          width: 28,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'JetBrains Mono, monospace',
          color: done ? 'var(--secondary)' : 'var(--text-muted)',
        }}
      >
        {done ? '[x]' : '[ ]'}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {optional && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
            padding: '4px 8px',
          }}
        >
          Optional
        </span>
      )}
    </div>
  )
}

export default function SessionLauncher({
  transcript,
  pdfBase64,
  voiceId,
  handwrittenNotesText,
  typedNotes,
  pdfMimeType,
  onLaunch,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const disabled = !transcript || !voiceId

  const handleLaunch = async () => {
    try {
      setLoading(true)
      setError('')
      await axios.post('/api/set-context', {
        transcript,
        handwrittenNotesText,
        typedNotes,
        pdfBase64,
        pdfMimeType,
        voiceId,
      })
      onLaunch?.()
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to prepare session.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="glass-card" style={{ padding: 24 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 18 }}>Session Readiness</h3>

      <ChecklistItem done={transcript.length > 50} label="Lecture transcribed" />
      <ChecklistItem done={Boolean(pdfBase64)} label="Course PDF uploaded" />
      <ChecklistItem done={Boolean(voiceId)} label="Voice cloned" />
      <ChecklistItem done={Boolean(handwrittenNotesText)} label="Handwritten notes" optional />

      <button
        type="button"
        aria-label="Launch student session"
        title={disabled ? 'Complete lecture recording and voice clone to continue' : 'Launch student session'}
        className="btn-primary"
        style={{ width: '100%', height: 56, marginTop: 18 }}
        disabled={disabled || loading}
        onClick={handleLaunch}
      >
        {loading ? 'Preparing session...' : 'Launch student session'}
      </button>

      {disabled && <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>Complete lecture recording and voice clone to continue</p>}
      {error && <p style={{ marginTop: 8, color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
    </section>
  )
}
