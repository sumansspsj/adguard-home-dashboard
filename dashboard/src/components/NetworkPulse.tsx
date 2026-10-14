import { useState } from 'react'

interface NetworkPulseProps {
  rate?: number
}

export default function NetworkPulse({ rate = 0 }: NetworkPulseProps) {
  const [prevRate, setPrevRate] = useState(rate)
  const [history, setHistory] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

  if (rate !== prevRate) {
    setPrevRate(rate)
    setHistory(h => [...h.slice(-14), rate])
  }

  const max = Math.max(...history, 1)
  const W = 180
  const H = 22

  const points = history.map((val, idx) => {
    const x = (idx / (history.length - 1)) * W
    const y = H - (val / max) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const pathD = points.length > 0 ? `M ${points.join(' L ')}` : ''
  const areaD = points.length > 0 ? `M 0,${H} L ${points.join(' L ')} L ${W},${H} Z` : ''

  // Use currentColor so SVG inherits from CSS — color set via parent text-color
  return (
    <div className="w-full py-1 text-[var(--text-tertiary)]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-5 overflow-visible"
        aria-hidden="true"
      >
        {areaD && (
          <path d={areaD} fill="currentColor" fillOpacity="0.08" />
        )}

        {/* Stroke Line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Current Value Dot */}
        {points.length > 0 && (
          <circle
            cx={W}
            cy={H - (rate / max) * (H - 4) - 2}
            r="1.75"
            fill="currentColor"
          />
        )}
      </svg>
    </div>
  )
}
