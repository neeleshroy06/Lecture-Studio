export default function CaptionsBar({ caption }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '12px 20px',
        width: '100%',
        minHeight: 48,
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--secondary)', marginBottom: 4 }}>
        Live Captions ♿
      </div>
      <div aria-live="polite" style={{ textAlign: 'center', color: caption ? 'white' : 'var(--text-muted)', fontSize: caption ? 14 : 12 }}>
        {caption || 'Captions will appear here when the professor speaks'}
      </div>
    </div>
  )
}
