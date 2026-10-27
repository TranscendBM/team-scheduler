// 新品上官網追蹤 —— 純函式與常數，方便測試。
// 只追蹤「還沒上官網」的新品：上線後標記「已上線」就退出主清單(保留紀錄，不刪除)，
// 官網完整產品清單刻意不放進系統。

// 第一層：產品線。分類(第二層)的 key 沿用官網網址最後一段，之後要產生官網連結不用再對照。
export const PRODUCT_LINES = [
  {
    key: 'embedded', label: '嵌入式解決方案', urlBase: 'https://tw.transcend-info.com/Embedded/Product/',
    categories: [
      { key: 'enterprise-ssd-solutions', label: '企業級SSD解決方案' },
      { key: 'ssd', label: '工業用SSD解決方案' },
      { key: 'modules', label: '工業用記憶體模組' },
      { key: 'memory-cards', label: '工業用記憶卡' },
      { key: 'flash', label: '工業用Flash解決方案' },
      { key: 'camera-modules', label: '嵌入式鏡頭模組' },
    ],
  },
  {
    key: 'consumer', label: '消費性產品', urlBase: 'https://tw.transcend-info.com/product/',
    categories: [
      { key: 'internal-ssd', label: '內接式固態硬碟' },
      { key: 'portable-ssd', label: '行動固態硬碟' },
      { key: 'external-hard-drive', label: '外接式硬碟' },
      { key: 'dashcam', label: '行車記錄器' },
      { key: 'body-camera', label: '密錄器' },
      { key: 'memory-card', label: '記憶卡' },
      { key: 'usb', label: '隨身碟' },
      { key: 'dram-module', label: '記憶體模組' },
      { key: 'card-reader-accessory', label: '讀卡機、DVD燒錄機與配件' },
    ],
  },
]

export const lineMeta = (key) => PRODUCT_LINES.find(l => l.key === key) || null

export function categoryMeta(lineKey, catKey) {
  return lineMeta(lineKey)?.categories.find(c => c.key === catKey) || null
}

export function categoryUrl(lineKey, catKey) {
  const line = lineMeta(lineKey)
  return line && categoryMeta(lineKey, catKey) ? line.urlBase + catKey : ''
}

// 上官網的固定流程，順序即進度。live 是最後一步，代表已上線、退出主清單。
export const STAGES = [
  { key: 'rd', label: '收到通知', hint: 'RD 開發中' },
  { key: 'prep', label: '準備中', hint: '文案初稿 / 產品圖拍攝 / ePage 設計' },
  { key: 'rd_confirm', label: 'RD 確認文案', hint: 'RD 確認文案初稿' },
  { key: 'epage_confirm', label: 'ePage 確認', hint: 'ePage 設計確認' },
  { key: 'live', label: '已上線', hint: '已上官網' },
]
export const LIVE_STAGE = 'live'

// 「準備中」階段底下的三項工作，各自勾選完成
export const PREP_TASKS = [
  { key: 'copy', label: '文案初稿' },
  { key: 'photo', label: '產品圖拍攝' },
  { key: 'epage', label: 'ePage 設計' },
]

export const stageIndex = (key) => Math.max(0, STAGES.findIndex(s => s.key === key))
export const stageMeta = (key) => STAGES[stageIndex(key)]
export const isLive = (p) => p?.stage === LIVE_STAGE

// 兩個 yyyy-mm-dd 相差天數(b - a)。用 UTC 計算避免夏令時間/時區造成差一天。
function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// 預計上線日倒數：已上線或沒填日期 → null(不提醒)。
// overdue: 已超過預計日仍沒上線；soon: 7 天內要上線；其餘 ok。
export const LAUNCH_SOON_DAYS = 7
export function launchStatus(p, todayStr) {
  if (!p || isLive(p) || !p.launchDate) return null
  const days = dayDiff(todayStr, p.launchDate)
  if (days < 0) return { tone: 'overdue', days: -days }
  if (days <= LAUNCH_SOON_DAYS) return { tone: 'soon', days }
  return { tone: 'ok', days }
}

// 主清單排序：預計上線日近到遠，沒填日期的排最後；同日期再依型號。
export function sortByLaunch(list) {
  return [...list].sort((a, b) => {
    const da = a.launchDate || '9999-12-31'
    const db = b.launchDate || '9999-12-31'
    return da.localeCompare(db) || (a.model || '').localeCompare(b.model || '')
  })
}

// 各分類在「未上線」清單裡的數量(分類 pill 上的數字)；已上線的不算
export function countByCategory(list, lineKey) {
  const counts = {}
  for (const p of list) {
    if (p.line !== lineKey || isLive(p)) continue
    counts[p.category] = (counts[p.category] || 0) + 1
  }
  return counts
}

// 「準備中」階段的三項工作完成數(例如 2/3)
export function prepProgress(p) {
  const done = PREP_TASKS.filter(t => p?.prep?.[t.key]).length
  return { done, total: PREP_TASKS.length }
}

// 新增/編輯表單送出前的驗證，回傳錯誤訊息，沒問題回 ''
export function validateProduct(form) {
  if (!lineMeta(form.line)) return '請選擇產品線'
  if (!categoryMeta(form.line, form.category)) return '請選擇分類'
  if (!form.model?.trim()) return '請輸入型號'
  return ''
}
