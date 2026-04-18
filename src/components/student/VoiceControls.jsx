function MicIcon({ muted }) {
  return muted ? '🔇' : '🎤'
}

export default function VoiceControls({
  isMicMuted,
  onMicToggle,
  isPaused,
  onPauseToggle,
  onEndSession,
  sessionState,
  onStartSession,
}) {
  if (sessionState === 'idle') {
    return (
      <button
        type="button"
        aria-label="Start session"
        className="btn-primary"
        style={{ width: 200, height: 52 }}
        onClick={onStartSession}
      >
        ▶ Start Session
      </button>
    )
  }

  if (sessionState !== 'active') return null

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
      <button
        type="button"
        title="Mute microphone"
        aria-label="Mute microphone"
        className="icon-button"
        onClick={onMicToggle}
        style={{ background: isMicMuted ? 'var(--danger)' : 'var(--surface-raised)' }}
      >
        <span aria-hidden="true">{MicIcon({ muted: isMicMuted })}</span>
      </button>

      <button
        type="button"
        title="Pause audio"
        aria-label="Pause audio"
        className="icon-button"
        onClick={onPauseToggle}
      >
        <span aria-hidden="true">{isPaused ? '▶' : '⏸'}</span>
      </button>

      <button
        type="button"
        title="End this session"
        aria-label="End this session"
        className="btn-danger"
        style={{ width: 120 }}
        onClick={onEndSession}
      >
        End Session
      </button>
    </div>
  )
}
