interface SparklineProps {
  data: number[]
  color?: string
  height?: number
  width?: number
  filled?: boolean
}

export default function Sparkline({ data, color = 'currentColor', height = 32, width = 80, filled = true }: SparklineProps) {
  if (!data.length || data.every(v => v === 0)) {
    return <svg width={width} height={height} aria-hidden="true" />
  }

  const max = Math.max(...data, 1)
  const pad = 2

  const pts = data.map((v, i) => ({
    x: pad + (i / Math.max(data.length - 1, 1)) * (width - pad * 2),
    y: pad + (1 - v / max) * (height - pad * 2),
  }))

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const fillPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${height} L ${pts[0].x.toFixed(1)} ${height} Z`
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      {filled && <path d={fillPath} fill={color} fillOpacity="0.08" />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle
        cx={pts[pts.length - 1].x}
        cy={pts[pts.length - 1].y}
        r={2}
        fill={color}
      />
    </svg>
  )
}
