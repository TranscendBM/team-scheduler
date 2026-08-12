// 主管儀表板「近三個月秀展清單」用的日期計算 —— 純函式，不碰 Firestore/React，
// 方便直接單元測試，避免週界線(週一/週日)算錯這種容易犯的 off-by-one 錯誤。
//
// 全部一律用 UTC 解析/運算/序列化(明確加 Z、用 getUTCDate 等 UTC 系列方法)：
// dateStr 只是單純的日曆日期字串(YYYY-MM-DD)，不帶時區語意，如果用 `new Date(dateStr+'T00:00:00')`
// (不加 Z)解析成「本機時區的當地午夜」，再用 .toISOString()(輸出 UTC)序列化回字串，
// 只要本機時區不是 UTC(例如 Asia/Taipei UTC+8)，換算回去就會少一天 —— 這是實測抓到的真實 bug，
// 不是理論疑慮(見 test/unit/tradeshowCountdown.test.js)。全程留在 UTC 就不會有這個落差。

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`)
  const to = new Date(`${toStr}T00:00:00Z`)
  return Math.round((to - from) / 86400000)
}

// 某天所在那一週(週一~週日)的起訖日期字串，用來判斷秀展是不是「本週」「下週」開展。
export function weekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay() // 0=週日...6=週六
  const start = addDays(dateStr, day === 0 ? -6 : 1 - day)
  return [start, addDays(start, 6)]
}

// 秀展倒數狀態：進行中／今天開展／還有 N 天(本週或下週開展另外加註記 weekTag)。
// today 從外面傳入而不是內部呼叫 new Date()，測試才不用 mock 時間。
export function showCountdown(p, today) {
  const ongoing = !!(p.endDate && p.startDate <= today && p.endDate >= today)
  if (ongoing) return { ongoing: true }
  const days = daysBetween(today, p.startDate)
  if (days === 0) return { ongoing: false, days, label: '今天開展' }
  const [thisStart, thisEnd] = weekRange(today)
  const [nextStart, nextEnd] = weekRange(addDays(today, 7))
  let weekTag = null
  if (p.startDate >= thisStart && p.startDate <= thisEnd) weekTag = '本週開展'
  else if (p.startDate >= nextStart && p.startDate <= nextEnd) weekTag = '下週開展'
  return { ongoing: false, days, weekTag }
}
