export default function InputModeToggle({ mode, onToggle }) {
  const options = [
    { id: 'voice', label: '🎤 Voice' },
    { id: 'asl', label: '🤟 ASL' },
  ]

  return (
    <div
      style={{
        width: 200,
        height: 44,
        borderRadius: 22,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        display: 'flex',
        padding: 2,
      }}
    >
      {options.map((option) => {
        const active = mode === option.id
        return (
          <button
            key={option.id}
            type="button"
            aria-label={`Switch to ${option.id} input mode`}
            onClick={() => onToggle(option.id)}
            style={{
              flex: 1,
              border: 'none',
              borderRadius: 20,
              background: active ? 'var(--primary)' : 'transparent',
              color: active ? 'white' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
