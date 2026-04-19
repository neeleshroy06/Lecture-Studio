import { useId } from 'react'

/**
 * Lecture Studio mark — 60×60 design, scales via width/height.
 */
export default function AppLogo({ size = 60, className, style, title, 'aria-hidden': ariaHidden = true }) {
  const rawId = useId()
  const clipId = `app-logo-clip-${rawId.replace(/:/g, '')}`
  const decorative = !title

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden={decorative ? ariaHidden : false}
      role={decorative ? undefined : 'img'}
      aria-label={title || undefined}
    >
      {title ? <title>{title}</title> : null}
      <g clipPath={`url(#${clipId})`}>
        <rect width="60" height="60" fill="#26CEF0" />
        <line x1="16" y1="10" x2="16" y2="39" stroke="white" strokeWidth="8" />
        <line x1="14.12" y1="35.608" x2="38.12" y2="50.608" stroke="white" strokeWidth="8" />
        <line x1="25.136" y1="29.618" x2="44.136" y2="41.618" stroke="white" strokeWidth="8" />
        <line x1="41.8908" y1="40.6578" x2="48.8908" y2="29.6578" stroke="white" strokeWidth="5" />
        <line x1="49.94" y1="32.696" x2="25.94" y2="17.696" stroke="white" strokeWidth="4" />
        <line x1="24.7519" y1="19.1679" x2="30.7519" y2="10.1679" stroke="white" strokeWidth="3" />
        <line x1="28.3625" y1="10.9039" x2="48.3625" y2="23.9039" stroke="white" strokeWidth="5" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="60" height="60" rx="13" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}
