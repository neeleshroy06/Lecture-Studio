function MicGlyph({ muted }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 14a3 3 0 003-3V7a3 3 0 10-6 0v4a3 3 0 003 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 11v1a4 4 0 008 0v-1M12 18v3M8 21h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {muted && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
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
        Start session
      </button>
    )
  }

  if (sessionState === 'connecting') {
    return (
      <button
        type="button"
        aria-label="Connecting to live session"
        className="btn-primary"
        style={{ width: 200, height: 52, opacity: 0.8, cursor: 'wait' }}
        disabled
      >
        Connecting...
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
        <span aria-hidden="true">
          <MicGlyph muted={isMicMuted} />
        </span>
      </button>

      <button
        type="button"
        title="Pause audio"
        aria-label="Pause audio"
        className="icon-button"
        onClick={onPauseToggle}
      >
        <span aria-hidden="true">{isPaused ? <PlayGlyph /> : <PauseGlyph />}</span>
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
