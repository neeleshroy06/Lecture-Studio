export default function StatusDot({ color = 'var(--secondary)', pulsing = true, size = 10 }) {
  return (
    <span
      className={pulsing ? 'pulse-dot' : ''}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '999px',
        display: 'inline-block',
        background: color,
        boxShadow: `0 0 14px ${color}`,
      }}
    />
  )
}
