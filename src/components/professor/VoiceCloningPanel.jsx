import { useRef, useState } from 'react'
import axios from 'axios'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { formatTime } from '../../utils/audioUtils'
import StatusDot from '../shared/StatusDot'

const SAMPLE_TEXT =
  "Welcome to today's lecture. I'll be covering the key concepts we discussed in class, and I want you to feel free to ask questions at any time. Learning is a journey we take together, and I'm here to help guide you through every topic, no matter how complex it may seem at first."

export default function VoiceCloningPanel({ onVoiceCloned }) {
  const recorder = useAudioRecorder()
  const inputRef = useRef(null)
  const [panelState, setPanelState] = useState('idle')
  const [voiceBlob, setVoiceBlob] = useState(null)
  const [voiceId, setVoiceId] = useState('')
  const [error, setError] = useState('')

  const handleRecordingStart = async () => {
    setError('')
    await recorder.start()
    setPanelState('recording')
  }

  const handleRecordingStop = async () => {
    const blob = await recorder.stop()
    setVoiceBlob(blob)
    setPanelState('idle')
  }

  const handleClone = async (audioFile = voiceBlob) => {
    if (!audioFile) return
    setPanelState('uploading')
    setError('')

    try {
      const formData = new FormData()
      formData.append('audio', audioFile, 'voice-sample.webm')
      const response = await axios.post('/api/clone-voice', formData)
      const nextVoiceId = response.data?.voiceId || ''
      setVoiceId(nextVoiceId)
      setPanelState('done')
      onVoiceCloned?.(nextVoiceId)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Cloning failed.')
      setPanelState('error')
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setVoiceBlob(file)
    setPanelState('idle')
    event.target.value = ''
  }

  return (
    <section className="glass-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>Clone Your Voice</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Students will hear your voice answering their questions
          </p>
        </div>
      </div>

      <div style={{ marginTop: 18, borderRadius: 12, padding: 16, background: 'var(--surface-raised)' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Read this text aloud when recording:</div>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7 }}>{SAMPLE_TEXT}</p>
      </div>

      <div style={{ marginTop: 18 }}>
        {panelState === 'recording' ? (
          <div className="glass-card" style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <StatusDot color="var(--danger)" />
              <span>Recording... {formatTime(recorder.elapsed)}</span>
            </div>
            <button
              type="button"
              aria-label="Stop recording voice sample"
              className="btn-danger"
              style={{ marginTop: 14 }}
              onClick={handleRecordingStop}
            >
              Stop Recording
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              aria-label="Record voice sample"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={handleRecordingStart}
            >
              Record voice sample
            </button>
            <button
              type="button"
              aria-label="Upload voice sample"
              onClick={() => inputRef.current?.click()}
              style={{
                marginTop: 10,
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'block',
                width: '100%',
              }}
            >
              upload a recording
            </button>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>(30+ seconds recommended for best results)</div>
          </>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          aria-label="Create professor voice clone"
          className="btn-primary"
          style={{ width: '100%' }}
          disabled={!voiceBlob || panelState === 'uploading'}
          onClick={() => handleClone()}
        >
          Create voice clone
        </button>
      </div>

      {panelState === 'uploading' && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            className="animate-spin-slow"
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: 'var(--primary)',
            }}
          />
          <span>Cloning your voice with ElevenLabs...</span>
        </div>
      )}

      {panelState === 'done' && (
        <div className="animate-fade-in" style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--secondary)' }}>Done</div>
          <div style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 16 }}>Voice cloned successfully!</div>
          <div className="transcript-mono" style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6 }}>
            Voice ID: {voiceId}
          </div>
          <button
            type="button"
            aria-label="Clone voice again"
            style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            onClick={() => {
              setPanelState('idle')
              setVoiceBlob(null)
            }}
          >
            Re-clone
          </button>
        </div>
      )}

      {panelState === 'error' && (
        <div
          style={{
            marginTop: 16,
            background: 'rgba(255,77,106,0.12)',
            border: '1px solid rgba(255,77,106,0.3)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ color: 'var(--danger)' }}>Cloning failed. Please try again with a longer recording.</div>
          <button
            type="button"
            aria-label="Retry voice cloning"
            className="btn-danger"
            style={{ marginTop: 10 }}
            onClick={() => handleClone()}
          >
            Retry
          </button>
          {error && <div style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 12 }}>{error}</div>}
        </div>
      )}

      <input ref={inputRef} hidden type="file" accept="audio/*" onChange={handleUpload} />
    </section>
  )
}
