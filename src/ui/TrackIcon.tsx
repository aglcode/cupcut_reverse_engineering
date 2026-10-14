// Small line icons for the track header switches.
export function TrackIcon({ which, on }: { which: 'lock' | 'hide' | 'mute'; on: boolean }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (which === 'lock') {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="10" height="7" rx="1.5" />
        <path d={on ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1'} />
      </svg>
    )
  }
  if (which === 'hide') {
    return (
      <svg {...common}>
        <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
        <circle cx="8" cy="8" r="2" />
        {on && <path d="M2.5 13.5l11-11" />}
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" />
      {on ? <path d="M11 6l3 4M14 6l-3 4" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 4a5.5 5.5 0 0 1 0 8" />}
    </svg>
  )
}
