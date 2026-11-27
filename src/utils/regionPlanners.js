// 秀展「地區」分組，以及每個地區對應的 Planner。
// 分公司(office)代碼 → 地區；地區 → Planner 存在 settings/regionPlanners：
//   { "2027": { hq: [personId], tw: [personId], ... } }   每年可以不同(例如 HQ 每年都可能換 Planner)
// 某年度的某地區沒設定過時，改用下面 DEFAULT_PLANNER_NAMES 依姓名比對 people(每年固定的人)；
// 設定過(即使設成空陣列＝刻意不指定)就以設定為準。
export const REGIONS = [
  { key: 'hq', label: 'HQ', offices: ['HQ'] },
  { key: 'tw', label: 'TW', offices: ['TW'] },
  { key: 'us', label: 'US', offices: ['US'] },
  { key: 'eu', label: 'EU', offices: ['GM', 'NL', 'UK'] },
  { key: 'jpkr', label: 'JP & KR', offices: ['JP', 'KR'] },
  { key: 'cn', label: 'CN', offices: ['BJ', 'SH', 'SZ'] },
]

// 預設 Planner(姓名比對：people.name 含這個字，不分大小寫)。HQ 每年可能換人，換人時在
// 「負責人與設計師管理」改當年度的設定即可(該年度設定過就不再用預設)
export const DEFAULT_PLANNER_NAMES = {
  hq: ['Ashley'],
  tw: ['Rachel'],
  us: ['Ashley'],
  eu: ['Ecco'],
  jpkr: ['Shinpei'],
  cn: ['Rachel'],
}

export function regionKeyOfOffice(office) {
  const o = String(office || '').trim()
  return REGIONS.find(r => r.offices.includes(o))?.key || null
}

function matchByName(people, names) {
  const found = []
  for (const n of names) {
    const key = n.toLowerCase()
    const hit = (people || []).find(p => p.role === 'planner' && String(p.name || '').toLowerCase().includes(key))
      || (people || []).find(p => String(p.name || '').toLowerCase().includes(key))
    if (hit && !found.includes(hit.id)) found.push(hit.id)
  }
  return found
}

// → { hq: [personId], tw: [...], ... }(每個地區都有 key，沒有 Planner 就是空陣列)
export function resolveRegionPlanners(config, year, people) {
  const yearCfg = config?.[String(year)] || {}
  const out = {}
  for (const r of REGIONS) {
    const stored = yearCfg[r.key]
    out[r.key] = Array.isArray(stored) ? stored.filter(Boolean) : matchByName(people, DEFAULT_PLANNER_NAMES[r.key] || [])
  }
  return out
}

// 某個地區的 Planner 姓名(用在畫面標示)
export function plannerNames(map, regionKey, people) {
  const byId = new Map((people || []).map(p => [p.id, p]))
  return (map?.[regionKey] || []).map(id => byId.get(id)?.name).filter(Boolean)
}
