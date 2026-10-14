import { type AghStats, type CacheStats } from '../api'

export interface Insight {
  icon: string
  text: string
  sub?: string
  color?: string
}

/** Typical home block rate for comparison */
const TYPICAL_BLOCK_PCT = 15

/** Generate a set of insights from available data */
export function generateInsights(
  stats: AghStats,
  cacheStats: CacheStats,
  topClientName?: string
): Insight[] {
  const insights: Insight[] = []

  const totalQ = stats.num_dns_queries || 1
  const totalB = stats.num_blocked_filtering || 0
  const blockPct = Math.round((totalB / totalQ) * 100)

  // 1. Block rate comparison
  if (blockPct > TYPICAL_BLOCK_PCT * 2) {
    insights.push({
      icon: '🛡️',
      text: `${blockPct}% of all DNS queries are blocked — ${Math.round(blockPct / TYPICAL_BLOCK_PCT)}× the typical home network.`,
      sub: `Your filter lists are working hard.`,
    })
  } else if (blockPct > TYPICAL_BLOCK_PCT) {
    insights.push({
      icon: '🛡️',
      text: `${blockPct}% of queries blocked — above average.`,
      sub: `Typical home networks block around ${TYPICAL_BLOCK_PCT}%.`,
    })
  } else {
    insights.push({
      icon: '✅',
      text: `${blockPct}% of queries blocked — within normal range.`,
      sub: `Your network is clean and running well.`,
    })
  }

  // 2. Cache hit rate
  const cacheHitPct = Math.round(cacheStats.cache_hit_rate * 100)
  if (cacheHitPct >= 40) {
    insights.push({
      icon: '⚡',
      text: `${cacheHitPct}% cache hit rate — nearly half of queries served instantly.`,
      sub: `Cached queries have near-zero latency.`,
    })
  } else if (cacheHitPct < 20) {
    insights.push({
      icon: '💾',
      text: `${cacheHitPct}% cache hit rate — below average.`,
      sub: `Cache will warm up the longer AdGuard runs.`,
    })
  }

  // 3. Top blocked domain — persistent offender
  const topBlocked = (stats.top_blocked_domains || [])
    .flatMap(o => Object.entries(o) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0]

  if (topBlocked && topBlocked[1] > 100) {
    const [domain, count] = topBlocked
    insights.push({
      icon: '🔥',
      text: `${domain} was blocked ${count.toLocaleString()} times.`,
      sub: `It keeps trying — and failing — every few seconds.`,
    })
  }

  // 4. Top client dominance
  const topClients = (stats.top_clients || [])
    .flatMap(o => Object.entries(o) as [string, number][])
    .sort((a, b) => b[1] - a[1])

  if (topClients.length >= 2) {
    const [topIp, topCount] = topClients[0]
    const topPct = Math.round((topCount / totalQ) * 100)
    const displayName = topClientName || topIp
    if (topPct > 60) {
      insights.push({
        icon: '📱',
        text: `${displayName} generates ${topPct}% of all DNS traffic on your network.`,
        sub: `It's by far the most active device.`,
      })
    }
  }

  // 5. Avg latency
  const latencyMs = stats.avg_processing_time * 1000
  if (latencyMs < 10) {
    insights.push({
      icon: '🚀',
      text: `Average DNS latency is ${latencyMs.toFixed(1)} ms — exceptionally fast.`,
      sub: `Most queries are being served from cache.`,
    })
  } else if (latencyMs > 100) {
    insights.push({
      icon: '🐢',
      text: `Average DNS latency is ${latencyMs.toFixed(0)} ms — slower than ideal.`,
      sub: `Consider using a closer upstream DNS server.`,
    })
  } else {
    insights.push({
      icon: '✨',
      text: `${latencyMs.toFixed(1)} ms average latency — faster than most DNS setups.`,
      sub: `DoH upstreams are performing well.`,
    })
  }

  // 6. Safebrowsing
  if (stats.num_replaced_safebrowsing > 0) {
    insights.push({
      icon: '🔒',
      text: `${stats.num_replaced_safebrowsing.toLocaleString()} malware/phishing sites blocked by SafeBrowsing.`,
      sub: `Your network is actively protected from threats.`,
    })
  }

  // 7. Daily query volume estimate
  const queriesPerSec = 2.4 // approximate from observed traffic
  const dailyEstimate = Math.round(queriesPerSec * 86400)
  insights.push({
    icon: '📊',
    text: `At current rates, your network makes ~${dailyEstimate.toLocaleString()} DNS queries per day.`,
    sub: `That's ${Math.round(dailyEstimate / 1000)}K lookups, ${Math.round((dailyEstimate * blockPct) / 100000)}K blocked.`,
  })

  // 8. Upstream info
  const upstreams = Object.keys(cacheStats.upstreams || {})
  if (upstreams.length > 1) {
    const clean = upstreams
      .map(u => u.replace('https://', '').replace('/dns-query', '').split('.').slice(-2).join('.'))
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 2)
    insights.push({
      icon: '🌐',
      text: `DNS queries are split across ${upstreams.length} upstream servers: ${clean.join(' and ')}.`,
      sub: `This improves redundancy and privacy.`,
    })
  }

  return insights
}
