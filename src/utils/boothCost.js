// 各分公司(office)「平均單一攤位租金」：每場展覽先算 攤位租金 ÷ 攤位數量，
// 再把同一分公司各場的結果取平均。只計入「租金與攤位數量都有填(> 0)」的場次。
// 租金用 rentUSD(各場已換算成美金，才能跨分公司比較)；攤位數量是展覽資料的 boothSize。
export function perBoothRentByOffice(shows) {
  const groups = new Map()
  const skipped = { noRent: 0, noBooths: 0, both: 0 }
  for (const p of shows || []) {
    const rent = Number(p.rentUSD) > 0 ? Number(p.rentUSD) : 0
    const booths = Number(p.boothSize) > 0 ? Number(p.boothSize) : 0
    if (!rent || !booths) {
      if (!rent && !booths) skipped.both++
      else if (!rent) skipped.noRent++
      else skipped.noBooths++
      continue
    }
    const office = (p.office || '').trim() || '未指定'
    if (!groups.has(office)) groups.set(office, [])
    groups.get(office).push({ name: p.name || '', perBooth: rent / booths, rent, booths })
  }
  const rows = [...groups.entries()].map(([office, list]) => {
    const per = list.map(x => x.perBooth)
    return {
      office,
      shows: list.length,
      avg: per.reduce((a, b) => a + b, 0) / per.length,
      min: Math.min(...per),
      max: Math.max(...per),
    }
  }).sort((a, b) => b.avg - a.avg)
  const counted = rows.reduce((n, r) => n + r.shows, 0)
  return { rows, counted, skipped, skippedTotal: skipped.noRent + skipped.noBooths + skipped.both }
}
