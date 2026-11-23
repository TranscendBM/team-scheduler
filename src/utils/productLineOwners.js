// 產品線負責設計師 —— 純函式與常數，方便測試。
//
// 一列 = 「某個官網分類(或子分類)」由哪些設計師負責製作新品 / Class Change 的英文 Mkt Kit
// (產品圖、PS/PEP、A+ Content)。分類沿用官網(src/utils/newProducts.js 的 PRODUCT_LINES，
// key 是官網網址最後一段)，子分類是官網該分類頁底下的小分類。
// 試算表裡的內部簡稱(ESD、DP、DPB、SJC…)保留成「別名」，方便跟舊表對照。
import { PRODUCT_LINES, lineMeta, categoryMeta } from './newProducts'

// ── 官網子分類快照 ────────────────────────────────────────────────
// 來源：tw.transcend-info.com 各分類頁的導覽選單。這是「快照」，官網新增/下架分類時要更新這份清單
// (並更新日期)，介面的「與官網比對」就會自動標出差異。官網的「技術 / 應用領域 / 軟體 / 客製化服務」
// 不是產品分類，不放進來。
export const OFFICIAL_CHECKED_AT = '2026-11-23'

const sub = (key, label) => ({ key, label })
export const OFFICIAL_SUBS = {
  'embedded/enterprise-ssd-solutions': [sub('pcie-essd', 'PCIe eSSD'), sub('sata-essd', 'SATA III eSSD')],
  'embedded/ssd': [
    sub('u2', 'U.2 SSD'), sub('pcie-m2', 'PCIe M.2 SSDs'), sub('sata-m2', 'SATA III M.2 SSDs'),
    sub('sata-25', '2.5" SATA & PATA SSDs'), sub('msata', 'mSATA SSDs'), sub('half-slim', 'Half-Slim SSDs'),
  ],
  'embedded/modules': [sub('ddr5', 'DDR5'), sub('ddr4', 'DDR4'), sub('ddr3', 'DDR3'), sub('ddr2', 'DDR2')],
  'embedded/memory-cards': [
    sub('sd', 'SD記憶卡'), sub('microsd', 'microSD記憶卡'), sub('cf', 'CompactFlash記憶卡'),
    sub('cfast', 'CFast 記憶卡'), sub('cfexpress', 'CFexpress 記憶卡'), sub('mmc', 'MMC'),
  ],
  'embedded/flash': [sub('usb-drive', '隨身碟'), sub('usb-module', 'USB 快閃記憶體模組'), sub('pata-module', 'PATA 快閃記憶體模組'), sub('emmc', 'eMMC')],
  'embedded/camera-modules': [sub('mipi', 'MIPI CSI-2 介面'), sub('usb', 'USB 介面'), sub('gmsl2', 'GMSL2 介面')],
  'consumer/internal-ssd': [
    sub('pcie-m2', 'PCIe M.2固態硬碟'), sub('sata-m2', 'SATA III M.2固態硬碟'), sub('ssd-25', '2.5" 固態硬碟'),
    sub('msata', 'mSATA微型固態硬碟'), sub('accessory', '配件'),
  ],
  'consumer/portable-ssd': [sub('portable', '行動固態硬碟'), sub('mini', '迷你行動固態硬碟')],
  'consumer/external-hard-drive': [sub('portable-hdd', '可攜式外接硬碟'), sub('desktop-hdd', '桌上型外接式硬碟'), sub('accessory', '配件')],
  'consumer/dashcam': [sub('dashcam', '行車記錄器'), sub('dual', '雙鏡頭行車記錄器'), sub('moto', '機車行車記錄器'), sub('accessory', '配件')],
  'consumer/body-camera': [sub('wearable', '穿戴式攝影機'), sub('accessory', '配件')],
  'consumer/memory-card': [
    sub('sd', 'SD記憶卡'), sub('microsd', 'microSD記憶卡'), sub('cfexpress', 'CFexpress 記憶卡'),
    sub('cf', 'CompactFlash記憶卡'), sub('cfast', 'CFast 2.0記憶卡'),
  ],
  'consumer/usb': [
    sub('usb32', 'USB 3.2 Gen 1/3.1 Gen 1 (USB 5Gbps) 隨身碟'), sub('usb20', 'USB 2.0 隨身碟'), sub('android', 'Android行動儲存碟'),
  ],
  'consumer/dram-module': [sub('ddr5', 'DDR5'), sub('ddr4', 'DDR4'), sub('ddr3', 'DDR3')],
  'consumer/card-reader-accessory': [sub('reader', '讀卡機'), sub('hub', '集線器'), sub('dvd', 'DVD燒錄機與轉接卡')],
}

export const officialSubsOf = (line, category) => OFFICIAL_SUBS[`${line}/${category}`] || []
export const isOfficialCategory = (line, category) => !!categoryMeta(line, category)
// sub 為空字串＝整個分類；非空時要在官網子分類清單裡才算「官網有」
export const isOfficialRow = (r) => isOfficialCategory(r.line, r.category)
  && (!r.sub || officialSubsOf(r.line, r.category).some(s => s.key === r.sub))
// 試算表有、但官網沒有的項目(例如 SJC、JetDrive)用 x- 開頭的自訂 key
export const CUSTOM_SUB_PREFIX = 'x-'

export const PHOTO_METHODS = ['合成', '拍照']
export const STATUSES = { active: '正常', to_remove: '預計刪除' }

export const rowId = (line, category, subKey) => `${line}__${category}__${subKey || '_all'}`

export function subLabelOf(r) {
  if (!r.sub) return '整個分類'
  return officialSubsOf(r.line, r.category).find(s => s.key === r.sub)?.label || r.subLabel || r.sub
}

// 歷史紀錄與提示用的完整路徑：嵌入式解決方案 › 工業用SSD解決方案 › U.2 SSD
export function rowPath(r) {
  const parts = [lineMeta(r.line)?.label || r.line, categoryMeta(r.line, r.category)?.label || r.category]
  if (r.sub) parts.push(subLabelOf(r))
  return parts.join(' › ')
}

// ── 負責人 ───────────────────────────────────────────────────────
// owners: [{ email, name }]；email 可能是空字串(試算表只有名字、系統裡找不到對應帳號時)
export const ownerNames = (owners) => (owners || []).map(o => o.name).filter(Boolean)
export const ownerKey = (o) => (o.email || o.name || '').trim().toLowerCase()

export function diffOwners(before, after) {
  const b = new Map((before || []).map(o => [ownerKey(o), o]))
  const a = new Map((after || []).map(o => [ownerKey(o), o]))
  const added = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k))
  const removed = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k))
  return { changed: added.length > 0 || removed.length > 0, added, removed }
}

// ── 版面模型：官網分類為骨架，把已存的資料列放進去，沒有資料的官網子分類補「尚無負責人」 ──
// docs: Firestore 的 productLineOwners 文件(含 id)
export function buildModel(docs) {
  const list = (docs || []).map(d => ({ ...d, officialListed: isOfficialRow(d) }))
  const used = new Set()

  const lines = PRODUCT_LINES.map(line => ({
    key: line.key,
    label: line.label,
    categories: line.categories.map(cat => {
      const mine = list.filter(d => d.line === line.key && d.category === cat.key)
      mine.forEach(d => used.add(d.id))
      const catDoc = mine.find(d => !d.sub) || null
      const subDocs = mine.filter(d => d.sub)
      const rows = []
      if (catDoc) rows.push({ kind: 'doc', id: catDoc.id, doc: catDoc })
      // 官網子分類：有資料就放資料；沒有資料且整個分類也沒人負責，才補「尚無負責人」
      for (const s of officialSubsOf(line.key, cat.key)) {
        const d = subDocs.find(x => x.sub === s.key)
        if (d) rows.push({ kind: 'doc', id: d.id, doc: d })
        else if (!catDoc) rows.push({ kind: 'missing', id: rowId(line.key, cat.key, s.key), line: line.key, category: cat.key, sub: s.key, label: s.label })
      }
      // 官網沒有的自訂項目(SJC、JetDrive…)排最後
      for (const d of subDocs.filter(x => !officialSubsOf(line.key, cat.key).some(s => s.key === x.sub))) {
        rows.push({ kind: 'doc', id: d.id, doc: d })
      }
      // 分類本身完全沒有任何子分類資料也沒有整類資料 → 官網沒有子分類的分類(目前沒有)，補一列整類
      if (rows.length === 0) rows.push({ kind: 'missing', id: rowId(line.key, cat.key, ''), line: line.key, category: cat.key, sub: '', label: '整個分類' })
      return { key: cat.key, label: cat.label, line: line.key, rows, covered: !!catDoc }
    }),
  }))

  // 分類已不在官網清單的資料(官網下架分類後留下來的)
  const orphans = list.filter(d => !used.has(d.id))
  const docsOnly = list
  const missing = lines.flatMap(l => l.categories.flatMap(c => c.rows.filter(r => r.kind === 'missing')))
  const stats = {
    total: docsOnly.length,
    unconfirmed: docsOnly.filter(d => d.confirmed !== true).length,
    toRemove: docsOnly.filter(d => d.status === 'to_remove').length,
    notOnSite: docsOnly.filter(d => !d.officialListed).length,
    missing: missing.length,
  }
  return { lines, orphans, missing, stats }
}

// 依設計師彙總：每位設計師負責哪些列(沒指派負責人的列歸「未指派」)
export function summarizeByDesigner(docs, designerNames = []) {
  const map = new Map()
  const bucket = (name) => { if (!map.has(name)) map.set(name, []); return map.get(name) }
  for (const n of designerNames) bucket(n)
  for (const d of docs || []) {
    const names = ownerNames(d.owners)
    if (names.length === 0) bucket('未指派').push(d)
    for (const n of names) bucket(n).push(d)
  }
  return [...map.entries()].map(([name, rows]) => ({ name, rows }))
}

export function validateRow(form) {
  if (!form.line || !lineMeta(form.line)) return '請選擇產品線'
  if (!form.category || !categoryMeta(form.line, form.category)) return '請選擇分類'
  if (form.sub && form.sub.startsWith(CUSTOM_SUB_PREFIX) && !String(form.subLabel || '').trim()) return '請輸入項目名稱'
  if (!form.owners || form.owners.length === 0) return '請至少選擇一位負責設計師'
  return ''
}

// 自訂項目(官網沒有)的 key：x- + 名稱的簡化字串；中文名稱直接保留(Firestore 文件 ID 可以是中文，但不能含 /)
export function customSubKey(label) {
  const slug = String(label || '').trim().toLowerCase().replace(/[\s/\\]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '')
  return `${CUSTOM_SUB_PREFIX}${slug}`
}

// ── 初始資料：依試算表(2026-11 版)整理，套用後全部是「待確認」 ─────────────────
// 試算表是內部簡稱，這裡是我依官網分類做的對照；不確定的在 note 寫明，請主管逐列確認。
// handover 是試算表備註裡的「A -> B」交接紀錄(原負責人 → 現負責人)，只會寫進變更歷史、不會影響負責人。
const row = (line, category, subKey, o) => ({ line, category, sub: subKey, ...o })
const E = 'embedded', C = 'consumer'

export const SEED_ROWS = [
  // 消費性：內接式固態硬碟(試算表「SSD」)
  row(C, 'internal-ssd', 'ssd-25', { aliases: ['SSD · 2.5" SSD'], photoMethod: '合成', owners: ['Sherry'], handover: { from: ['Yuna'], to: ['Sherry'] } }),
  row(C, 'internal-ssd', 'pcie-m2', { aliases: ['SSD · PCIe M.2'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(C, 'internal-ssd', 'sata-m2', { aliases: ['SSD · SATA III M.2'], photoMethod: '拍照', owners: ['Tingwei'] }),
  row(C, 'internal-ssd', 'x-jetdrive', { subLabel: 'JetDrive', aliases: ['JetDrive'], photoMethod: '拍照', owners: ['Sherry', 'Yuna'], status: 'to_remove', note: '試算表：Sherry 負責 4/5/7 月、Yuna 8 月起；備註標示「刪除」。官網分類頁沒有這個項目。' }),
  row(C, 'internal-ssd', 'msata', { aliases: ['SSD · mSATA'], photoMethod: '拍照', owners: ['Tingwei'] }),
  // 消費性：行動固態硬碟(試算表「ESD」)
  row(C, 'portable-ssd', '', { aliases: ['ESD'], photoMethod: '拍照', owners: ['Tingwei'], handover: { from: ['Yuna'], to: ['Tingwei'] } }),
  // 消費性：外接式硬碟(試算表「HDD」「SJC」)
  row(C, 'external-hard-drive', 'portable-hdd', { aliases: ['HDD · Portable HDD'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(C, 'external-hard-drive', 'desktop-hdd', { aliases: ['HDD · Desktop Storage'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(C, 'external-hard-drive', 'accessory', { aliases: ['HDD · 配件'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(C, 'external-hard-drive', 'x-sjc', { subLabel: 'SJC', aliases: ['SJC'], photoMethod: '拍照', owners: ['Yuna'], status: 'to_remove', note: '試算表備註標示「刪除」。官網分類頁沒有這個項目。' }),
  // 消費性：行車記錄器(DP)、密錄器(DPB)
  row(C, 'dashcam', '', { aliases: ['DP'], photoMethod: '拍照', owners: ['Yuna'], note: '試算表為整個 DP 產品線，涵蓋行車記錄器各子分類。' }),
  row(C, 'body-camera', '', { aliases: ['DPB'], photoMethod: '拍照', owners: ['Yuna'], note: '試算表為整個 DPB 產品線。' }),
  row(C, 'body-camera', 'x-dbn1', { subLabel: 'DBN1', aliases: ['DBN1'], photoMethod: '拍照', owners: ['Yuna'], status: 'to_remove', note: '試算表備註標示「刪除」。官網分類頁沒有這個項目。' }),
  // 消費性：記憶卡
  row(C, 'memory-card', 'sd', { aliases: ['記憶卡 · SD'], photoMethod: '合成', owners: ['Sherry'], handover: { from: ['Tingwei'], to: ['Sherry'] } }),
  row(C, 'memory-card', 'microsd', { aliases: ['記憶卡 · microSD'], photoMethod: '合成', owners: ['Sherry'], handover: { from: ['Tingwei'], to: ['Sherry'] } }),
  row(C, 'memory-card', 'cf', { aliases: ['CF/CFast'], photoMethod: '合成', owners: ['Tingwei'], note: '試算表為「CF/CFast」同一列，這裡拆成 CompactFlash 與 CFast 兩列。' }),
  row(C, 'memory-card', 'cfast', { aliases: ['CF/CFast'], photoMethod: '合成', owners: ['Tingwei'], note: '試算表為「CF/CFast」同一列，這裡拆成 CompactFlash 與 CFast 兩列。' }),
  row(C, 'memory-card', 'cfexpress', { aliases: ['CFExpress'], photoMethod: '合成', owners: ['Tingwei'] }),
  row(C, 'memory-card', 'x-jdl', { subLabel: 'JDL', aliases: ['JDL'], photoMethod: '合成', owners: ['Sherry'], note: '試算表列在記憶卡底下；官網分類頁沒有這個項目，請確認是否仍需要。' }),
  // 消費性：隨身碟(試算表「USB」)
  row(C, 'usb', 'android', { aliases: ['USB · OTG / JDG'], photoMethod: '拍照', owners: ['Yuna'], note: '試算表為「OTG / JDG」，這裡對應官網的 Android 行動儲存碟，請確認。' }),
  row(C, 'usb', 'usb32', { aliases: ['USB · USB3.1'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(C, 'usb', 'usb20', { aliases: ['USB · USB2.0'], photoMethod: '拍照', owners: ['Yuna'] }),
  // 記憶體模組：試算表「DRAM (含工控)」同時涵蓋消費性與工業用，兩邊各一列
  row(C, 'dram-module', '', { aliases: ['DRAM (含工控)'], photoMethod: '拍照', owners: ['Tingwei'] }),
  row(E, 'modules', '', { aliases: ['DRAM (含工控)'], photoMethod: '拍照', owners: ['Tingwei'], note: '試算表「DRAM (含工控)」同一列，工業用記憶體模組在此。' }),
  // 消費性：讀卡機、DVD燒錄機與配件
  row(C, 'card-reader-accessory', 'reader', { aliases: ['讀卡機與配件 · OTG', '讀卡機與配件 · USB3.1', '讀卡機與配件 · USB2.0'], photoMethod: '拍照', owners: ['Tingwei'], note: '試算表的 OTG、USB3.1、USB2.0 三列合併為官網的「讀卡機」。' }),
  row(C, 'card-reader-accessory', 'dvd', { aliases: ['讀卡機與配件 · DVD'], photoMethod: '拍照', owners: ['Tingwei'] }),
  row(C, 'card-reader-accessory', 'hub', { aliases: ['讀卡機與配件 · 配件'], photoMethod: '拍照', owners: ['Tingwei'], note: '試算表為「配件」，這裡對應官網的「集線器」，請確認。' }),
  // 嵌入式：工控 SSD
  row(E, 'ssd', 'sata-25', { aliases: ['工控SSD · 2.5" SSD'], photoMethod: '合成', owners: ['Sherry'] }),
  row(E, 'ssd', 'u2', { aliases: ['工控SSD · U.2 SSD'], photoMethod: '合成', owners: ['Sherry'] }),
  row(E, 'ssd', 'pcie-m2', { aliases: ['工控SSD · PCIe M.2'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(E, 'ssd', 'sata-m2', { aliases: ['工控SSD · SATA III M.2'], photoMethod: '拍照', owners: ['Yuna'], handover: { from: ['Tingwei'], to: ['Yuna'] } }),
  row(E, 'ssd', 'msata', { aliases: ['工控SSD · mSATA'], photoMethod: '拍照', owners: ['Yuna'] }),
  row(E, 'ssd', 'half-slim', { aliases: ['工控SSD · Half-slim'], photoMethod: '拍照', owners: ['Yuna'] }),
  // 嵌入式：工控卡片、Flash、鏡頭模組
  row(E, 'memory-cards', '', { aliases: ['工控卡片'], photoMethod: '合成', owners: ['Sherry'] }),
  row(E, 'flash', '', { aliases: ['工控Flash'], photoMethod: '拍照', owners: ['Sherry'] }),
  row(E, 'camera-modules', '', { aliases: ['Camera Mudules'], photoMethod: '拍照', owners: ['Yuna'], note: '試算表備註標示「NEW」。' }),
]

// 把初始資料轉成要寫入的文件與歷史。resolveOwner(name) → { email, name }(找不到帳號時 email 為空字串)。
// existingIds 已存在的列一律跳過，所以重複套用不會覆蓋主管已經改過的資料。
export function buildSeedPlan(existingIds, resolveOwner) {
  const have = new Set(existingIds || [])
  const docs = []
  const history = []
  let skipped = 0
  for (const s of SEED_ROWS) {
    const id = rowId(s.line, s.category, s.sub)
    if (have.has(id)) { skipped++; continue }
    const owners = s.owners.map(resolveOwner)
    docs.push({
      id,
      data: {
        line: s.line, category: s.category, sub: s.sub, subLabel: s.subLabel || '',
        aliases: s.aliases || [], photoMethod: s.photoMethod || '', owners,
        status: s.status || 'active', note: s.note || '',
        confirmed: false, confirmedBy: '', confirmedAt: '',
      },
    })
    if (s.handover) {
      history.push({
        rowId: id, rowLabel: rowPath(s), kind: 'handover',
        fromNames: s.handover.from, toNames: s.handover.to,
        note: '來自試算表備註(交接日期不明)',
      })
    }
  }
  return { docs, history, skipped, unresolved: [...new Set(docs.flatMap(d => d.data.owners).filter(o => !o.email).map(o => o.name))] }
}
