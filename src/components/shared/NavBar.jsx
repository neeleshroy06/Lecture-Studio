export default function NavBar({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'professor', label: '👨‍🏫 Professor' },
    { id: 'student', label: '👩‍🎓 Student' },
  ]

  return (
    <nav
      className="glass-card"
      style={{
        height: 60,
        margin: 12,
        marginBottom: 0,
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        borderRadius: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--primary)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            boxShadow: '0 0 22px var(--primary-glow)',
          }}
        >
          🎓
        </div>
        <span style={{ fontWeight: 600, fontSize: 18 }}>Ed-Assist</span>
      </div>

      <div style={{ width: 40 }} />

      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-label={`Open ${tab.id} tab`}
          onClick={() => onTabChange(tab.id)}
          style={{
            height: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '0 6px',
          }}
        >
          {tab.label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <div
        style={{
          fontSize: 11,
          color: 'var(--secondary)',
          border: '1px solid rgba(0,212,170,0.55)',
          borderRadius: 999,
          padding: '6px 10px',
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        ♿ ADA Compliant
      </div>
    </nav>
  )
}
