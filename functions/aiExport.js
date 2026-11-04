// AI 專案管理資料表：把 Firestore 的 requests / projects 轉成「去識別化、欄位白名單、已彙總」的
// 二維表格(給 Google Sheets 用)。
//
// 這個檔案是「純函式」——不 import firebase、不連網路、不讀環境變數；時間、密鑰、是否匿名都由呼叫端傳入，
// 所以可以直接餵假資料做單元測試。functions/ 是獨立部署單元，不能 import 專案根目錄 src/，
// 因此跟前端共用的口徑(逾期狀態清單)在這裡各自維護一份，並由測試對照 src/utils/requestActions.js 與
// functions/index.js 的 findOverdueRequests，確保三處一致。
//
// 隱私原則(白名單，不是黑名單)：輸出的每個欄位都是在這裡明確列出的；來源文件上其他欄位
// (email、附件、shareToken、description、comment、reviewNote、rejectReason、預算…)
// 即使存在也不會被複製。最後還有一道 PII 守門(assertNoPii)，發現 email 或網址就整份快照作廢。
import { createHmac, createHash, randomBytes } from 'node:crypto'

export const SCHEMA_VERSION = '1.0.0'
export const RETENTION_DAYS = 90

// 資料量上限：超過就「失敗並通知」，不靜默截斷(截斷會讓彙總數字悄悄變錯)
export const LIMITS = {
  maxSourceReads: 6000,   // 單次同步最多讀這麼多 Firestore 文件
  maxRequestRows: 3000,
  maxProjectRows: 1000,
}

export const TAB = {
  README: 'AI_README',
  STATUS: 'AI_Sync_Status',
  SUMMARY: 'AI_Daily_Summary',
  REQUESTS: 'AI_Requests',
  PROJECTS: 'AI_Projects',
}
// 資料分頁(同步時會被清除再重寫)；STATUS 分頁另外用 commit-marker 流程寫入
export const DATA_TABS = [TAB.README, TAB.SUMMARY, TAB.REQUESTS, TAB.PROJECTS]

// 狀態分組(見 AI_README 口徑)。
export const OPEN_STATUSES = ['pending', 'assigned', 'in_progress', 'reviewing']
export const ACTIVE_STATUSES = ['assigned', 'in_progress']       // 「進行中」：已發稿 + 設計中
// ⚠️ 必須跟 src/utils/requestActions.js 的 OVERDUE_WATCH_STATUSES、
//    functions/index.js 的 OVERDUE_WATCH_STATUSES 一致(測試會對照)
export const OVERDUE_WATCH_STATUSES = ['assigned', 'in_progress']

// ───────────────────────── 日期工具(台灣時間 yyyy-mm-dd) ─────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function taipeiDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date)
}

// Firestore Timestamp / Date / ISO 字串 / 毫秒 → Date；無法解析回 null
export function toDate(v) {
  if (v == null || v === '') return null
  if (typeof v.toDate === 'function') { const d = v.toDate(); return Number.isNaN(d?.getTime()) ? null : d }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d }
  if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d }
  return null
}

// 時間戳 → 台灣時間的日期字串(只留到「日」，降低可識別性)；沒有或解析失敗回 ''
export function dateStrOf(v) {
  if (typeof v === 'string' && DATE_RE.test(v)) return v
  const d = toDate(v)
  return d ? taipeiDateStr(d) : ''
}

export function addDays(dateStr, n) {
  const t = Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}
export function diffDays(laterStr, earlierStr) {
  return Math.round((Date.parse(`${laterStr}T00:00:00Z`) - Date.parse(`${earlierStr}T00:00:00Z`)) / 86400000)
}
// 週一到週日；週日算該週的最後一天
export function weekRange(todayStr) {
  const dow = new Date(`${todayStr}T00:00:00Z`).getUTCDay() // 0=Sun
  const sinceMonday = (dow + 6) % 7
  const start = addDays(todayStr, -sinceMonday)
  return { start, end: addDays(start, 6) }
}

// ───────────────────────── 代號(HMAC，無對照表) ─────────────────────────
function assertKey(key) {
  if (typeof key !== 'string' || key.length < 16) throw new Error('HMAC 密鑰缺少或太短(至少 16 字元)')
}
function hmacHex(key, msg) {
  return createHmac('sha256', key).update(msg).digest('hex')
}
const normEmail = (e) => String(e || '').trim().toLowerCase()

const ROLE_PREFIX = { designer: 'D', planner: 'P', manager: 'M' }
// 同一個 email 永遠算出同一個代號(密鑰不變的前提下)；不寫入任何地方、不輸出對照表。
// 前綴只表示角色(D 設計師 / P Planner / M 主管 / U 未知)，本體 6 碼取自 HMAC。
export function personCode(email, key, role) {
  assertKey(key)
  const e = normEmail(email)
  if (!e) return ''
  return `${ROLE_PREFIX[role] || 'U'}-${hmacHex(key, `person:${e}`).slice(0, 6)}`
}
export function itemCode(kind, id, key) {
  assertKey(key)
  return `${kind}-${hmacHex(key, `${kind}:${id}`).slice(0, 10)}`
}

// ───────────────────────── 文字清理 ─────────────────────────
const EMAIL_RE = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+/g
const URL_RE = /https?:\/\/\S+|www\.\S+/gi

// 自由文字欄位(只有「非匿名模式」才會輸出專案名稱)：拿掉換行/控制字元、email、網址，並限制長度
export function cleanText(s, max = 80) {
  const t = String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(EMAIL_RE, '[email]')
    .replace(URL_RE, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
// 類別型欄位(region/type/status/docTypes 項目)：這些本來是下拉/勾選的值，一樣清理並限制長度
const token = (s, max = 30) => cleanText(s, max)

// ───────────────────────── 建立快照 ─────────────────────────
function resolveAssigneeRole(email, userByLogin) {
  return userByLogin.get(normEmail(email))?.role
}

/**
 * @param {object} input
 * @param {Array} input.requests  [{id, projectName, title, docTypes, region, urgent, status, dueDate, createdAt, reviewedAt, startedAt, reviewingAt, completedAt, assignedDesigners, selfCreated}]
 * @param {Array} input.projects  [{id, name, type, status, startDate, endDate, year, assignments:[{personId, role}]}]
 * @param {Array} input.users     [{email(doc id), role, notifyEmail, active}]
 * @param {Array} input.people    [{id, role, email(公司信箱)}]
 * @param {Date}  input.now
 * @param {string} input.hmacKey
 * @param {boolean} input.anonymize  true = 專案/需求名稱以代碼取代(第一階段預設)
 * @param {string} [input.snapshotId]
 */
export function buildSnapshot({ requests, projects, users, people, now, hmacKey, anonymize = true, snapshotId }) {
  assertKey(hmacKey)
  const todayStr = taipeiDateStr(now)
  const week = weekRange(todayStr)
  const retentionCutoff = addDays(todayStr, -RETENTION_DAYS)
  const snapId = snapshotId || makeSnapshotId(now)
  const generatedAt = now.toISOString()

  const userByLogin = new Map((users || []).map((u) => [normEmail(u.email), u]))
  // 公司信箱(people.email / users.notifyEmail) → 登入 email：專案的負責人是 people，需求的是登入 email，
  // 兩邊要對到「同一個人」才會是同一個代號。對不到的 people 退回用公司信箱算代號(前綴 U)。
  const loginByCompanyEmail = new Map()
  for (const u of users || []) {
    const ne = normEmail(u.notifyEmail)
    if (ne) loginByCompanyEmail.set(ne, normEmail(u.email))
  }
  const personById = new Map((people || []).map((p) => [p.id, p]))

  const seenPersonCodes = new Map() // code → email，偵測 HMAC 截斷碰撞
  const codeForLogin = (email) => {
    const e = normEmail(email)
    if (!e) return ''
    const c = personCode(e, hmacKey, resolveAssigneeRole(e, userByLogin))
    const prev = seenPersonCodes.get(c.slice(2))
    if (prev && prev !== e) throw new Error('負責人代號碰撞，請更換 HMAC 密鑰或加長代號')
    seenPersonCodes.set(c.slice(2), e)
    return c
  }

  // ── 需求 ──
  const reqRows = []
  const seenReq = new Set()
  let invalidDueDate = 0
  for (const r of requests || []) {
    if (!r || !r.status) continue
    const status = String(r.status)
    const dueRaw = typeof r.dueDate === 'string' ? r.dueDate.trim() : ''
    const dueDate = DATE_RE.test(dueRaw) ? dueRaw : ''
    if (dueRaw && !dueDate) invalidDueDate++

    const completedDate = dateStrOf(r.completedAt)
    const reviewedDate = dateStrOf(r.reviewedAt)
    // 資料保留範圍：開放中的需求全部保留；已結案/已駁回只留最近 90 天
    if (status === 'completed' && (!completedDate || completedDate < retentionCutoff)) continue
    if (status === 'rejected' && (!reviewedDate || reviewedDate < retentionCutoff)) continue
    if (!OPEN_STATUSES.includes(status) && status !== 'completed' && status !== 'rejected') continue

    const code = itemCode('R', r.id, hmacKey)
    if (seenReq.has(code)) throw new Error('需求代碼碰撞')
    seenReq.add(code)

    const assigneeCodes = [...new Set((r.assignedDesigners || []).map(codeForLogin).filter(Boolean))].sort()
    const isOpen = OPEN_STATUSES.includes(status)
    const watched = OVERDUE_WATCH_STATUSES.includes(status)
    let overdueDays = 0
    if (watched && dueDate) overdueDays = Math.max(0, diffDays(todayStr, dueDate)) // 交期當天不算逾期
    const isOverdue = overdueDays > 0

    let dueBucket = ''
    if (isOpen) {
      if (!dueDate) dueBucket = 'NO_DUE'
      else if (isOverdue) dueBucket = 'OVERDUE'
      else if (dueDate < todayStr) dueBucket = 'PAST_DUE_NOT_WATCHED' // 待審核/設計確認中已過交期：不算逾期(跟現有系統一致)，但單獨標出
      else if (dueDate <= week.end) dueBucket = 'THIS_WEEK'
      else dueBucket = 'LATER'
    }

    reqRows.push({
      id: code,
      name: anonymize ? `需求 ${code}` : cleanText(r.projectName || r.title || '', 80),
      category: (Array.isArray(r.docTypes) ? r.docTypes : []).map((t) => token(t)).filter(Boolean).join(';'),
      region: token(r.region, 20),
      urgent: r.urgent === true,
      status,
      dueDate,
      createdDate: dateStrOf(r.createdAt),
      reviewedDate,
      startedDate: dateStrOf(r.startedAt),
      reviewingDate: dateStrOf(r.reviewingAt),
      completedDate,
      assigneeCodes,
      isOpen, watched, isOverdue, overdueDays, dueBucket,
      selfCreated: r.selfCreated === true,
    })
  }
  reqRows.sort((a, b) => a.id.localeCompare(b.id))

  // ── 專案 ──
  const projRows = []
  const seenProj = new Set()
  for (const p of projects || []) {
    if (!p) continue
    const startDate = dateStrOf(p.startDate)
    const endDate = dateStrOf(p.endDate)
    // 保留：還沒結束、或結束不到 90 天、或完全沒填日期(無法判斷就保留，交給使用者看)
    if (endDate && endDate < retentionCutoff) continue
    const code = itemCode('J', p.id, hmacKey)
    if (seenProj.has(code)) throw new Error('專案代碼碰撞')
    seenProj.add(code)

    const assignees = new Set()
    for (const a of p.assignments || []) {
      const person = personById.get(a?.personId)
      if (!person) continue
      const company = normEmail(person.email)
      const login = loginByCompanyEmail.get(company)
      if (login) assignees.add(codeForLogin(login))
      else if (company) assignees.add(personCode(company, hmacKey, person.role)) // 對不到登入帳號：用公司信箱算(仍不輸出 email)
    }
    let phase = ''
    if (startDate && endDate) phase = todayStr < startDate ? 'UPCOMING' : todayStr > endDate ? 'ENDED' : 'ONGOING'
    projRows.push({
      id: code,
      name: anonymize ? `專案 ${code}` : cleanText(p.name, 80),
      type: token(p.type, 20),
      status: token(p.status, 20),
      startDate, endDate,
      year: Number.isFinite(Number(p.year)) ? Number(p.year) : '',
      assigneeCodes: [...assignees].sort(),
      phase,
      daysToStart: startDate ? diffDays(startDate, todayStr) : '',
    })
  }
  projRows.sort((a, b) => a.id.localeCompare(b.id))

  if (reqRows.length > LIMITS.maxRequestRows) throw new LimitError(`需求列數 ${reqRows.length} 超過上限 ${LIMITS.maxRequestRows}`)
  if (projRows.length > LIMITS.maxProjectRows) throw new LimitError(`專案列數 ${projRows.length} 超過上限 ${LIMITS.maxProjectRows}`)

  const stats = computeStats(reqRows)
  const workload = computeWorkload(reqRows)
  const risks = pickRisks(reqRows, todayStr)

  const meta = { snapshotId: snapId, schemaVersion: SCHEMA_VERSION, generatedAt, todayStr, week, anonymize, invalidDueDate }
  const tabs = {
    [TAB.README]: withMeta(readmeRows(meta), meta),
    [TAB.SUMMARY]: withMeta(summaryRows({ meta, stats, workload, risks }), meta),
    [TAB.REQUESTS]: withMeta(requestTableRows(reqRows, snapId), meta),
    [TAB.PROJECTS]: withMeta(projectTableRows(projRows, snapId), meta),
  }
  // 每個資料分頁的「資料列數」(不含 meta 與表頭)：之後寫入狀態分頁，驗證時對照
  const dataRowCounts = {
    [TAB.README]: tabs[TAB.README].length - 1,
    [TAB.SUMMARY]: tabs[TAB.SUMMARY].length - 1,
    [TAB.REQUESTS]: reqRows.length,
    [TAB.PROJECTS]: projRows.length,
  }
  assertNoPii(tabs)
  const checksums = Object.fromEntries(DATA_TABS.map((t) => [t, checksumRows(tabs[t])]))

  return {
    snapshotId: snapId, schemaVersion: SCHEMA_VERSION, generatedAt, todayStr, anonymize,
    tabs, checksums, dataRowCounts,
    counts: { requests: reqRows.length, projects: projRows.length, openRequests: stats.open, invalidDueDate },
    stats, workload, risks,
  }
}

export class LimitError extends Error {
  constructor(msg) { super(msg); this.name = 'LimitError' }
}

export function makeSnapshotId(now) {
  const t = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1T$2')
  return `${t}-${randomBytes(3).toString('hex')}`
}

// ───────────────────────── 彙總口徑 ─────────────────────────
// 每筆需求只會落在「一個」狀態桶(pending/assigned/in_progress/reviewing/completed/rejected)，
// 所以各狀態數加總 = 範圍內需求總數。逾期/本週到期/無交期是「依日期」的另一個維度，
// 只針對指定狀態計算，且彼此互斥(同一筆需求只會在其中一個 dueBucket)。
export function computeStats(rows) {
  const by = { pending: 0, assigned: 0, in_progress: 0, reviewing: 0, completed: 0, rejected: 0 }
  for (const r of rows) by[r.status]++
  const active = rows.filter((r) => ACTIVE_STATUSES.includes(r.status))
  const open = rows.filter((r) => r.isOpen)
  const cnt = (list, pred) => list.filter(pred).length
  return {
    total: rows.length,
    byStatus: by,
    open: open.length,
    active: active.length,
    // 以下為「進行中(已發稿+設計中)」口徑：跟現有逾期提醒信、需求總表紅字一致
    overdue: cnt(active, (r) => r.dueBucket === 'OVERDUE'),
    dueThisWeek: cnt(active, (r) => r.dueBucket === 'THIS_WEEK'),
    noDue: cnt(active, (r) => r.dueBucket === 'NO_DUE'),
    // 補充：納入「待審核、設計確認中」的開放需求口徑
    openDueThisWeek: cnt(open, (r) => r.dueBucket === 'THIS_WEEK'),
    openNoDue: cnt(open, (r) => r.dueBucket === 'NO_DUE'),
    pastDueNotWatched: cnt(open, (r) => r.dueBucket === 'PAST_DUE_NOT_WATCHED'),
    urgentOpen: cnt(open, (r) => r.urgent),
    unassignedNonPending: cnt(open, (r) => r.status !== 'pending' && r.assigneeCodes.length === 0),
  }
}

// 每位負責人：一筆需求指派給多人時「每個人各算一次」(跟現有逾期信一致)，所以「每人數字不可相加」；
// 總數請看 AI_Daily_Summary 的需求總數。sharedActive 表示其中有幾筆是共同指派。
export function computeWorkload(rows) {
  const map = new Map()
  const row = (code) => {
    if (!map.has(code)) map.set(code, { code, assigned: 0, inProgress: 0, reviewing: 0, dueThisWeek: 0, overdue: 0, sharedActive: 0, completed: 0 })
    return map.get(code)
  }
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'rejected') continue // 尚未/不會指派
    const owners = r.assigneeCodes.length ? r.assigneeCodes : ['UNASSIGNED']
    for (const c of owners) {
      const w = row(c)
      if (r.status === 'assigned') w.assigned++
      if (r.status === 'in_progress') w.inProgress++
      if (r.status === 'reviewing') w.reviewing++
      if (r.status === 'completed') w.completed++
      if (ACTIVE_STATUSES.includes(r.status)) {
        if (r.dueBucket === 'THIS_WEEK') w.dueThisWeek++
        if (r.dueBucket === 'OVERDUE') w.overdue++
        if (r.assigneeCodes.length > 1) w.sharedActive++
      }
    }
  }
  return [...map.values()]
    .map((w) => ({ ...w, active: w.assigned + w.inProgress }))
    .sort((a, b) => (b.overdue - a.overdue) || (b.active - a.active) || a.code.localeCompare(b.code))
}

// 風險「候選」(不是結論)：用固定、可解釋的加分規則，排序後取前三。
export function pickRisks(rows, todayStr, limit = 3) {
  const scored = []
  for (const r of rows) {
    if (!r.isOpen) continue
    let score = 0
    const reasons = []
    if (r.isOverdue) { score += 100 + Math.min(r.overdueDays, 30); reasons.push('OVERDUE') }
    if (r.dueBucket === 'PAST_DUE_NOT_WATCHED') {
      const d = Math.min(diffDays(todayStr, r.dueDate), 30)
      if (r.status === 'pending') { score += 80 + d; reasons.push('PENDING_PAST_DUE') }
      else { score += 50 + d; reasons.push('REVIEW_PAST_DUE') }
    }
    if (r.dueDate && r.dueDate >= todayStr && r.dueDate <= addDays(todayStr, 2)) {
      score += 40; reasons.push('DUE_WITHIN_2_DAYS')
      if (r.status === 'assigned') { score += 15; reasons.push('NOT_STARTED') }
    }
    if (r.urgent) { score += 25; reasons.push('URGENT') }
    if (score > 0) scored.push({ r, score, reasons })
  }
  scored.sort((a, b) => (b.score - a.score) || (a.r.dueDate || '9999').localeCompare(b.r.dueDate || '9999') || a.r.id.localeCompare(b.r.id))
  return scored.slice(0, limit).map((s, i) => ({
    rank: i + 1, id: s.r.id, name: s.r.name, status: s.r.status, dueDate: s.r.dueDate,
    overdueDays: s.r.overdueDays, assigneeCodes: s.r.assigneeCodes, score: s.score, reasons: s.reasons,
  }))
}

// ───────────────────────── 表格版面 ─────────────────────────
// 每個資料分頁：第 1 列是 #META(snapshotId/版本/產生時間/資料列數)，第 2 列表頭，之後是資料。
// 「資料列數」= 第 2 列(表頭)之後的列數；AI_README 與 AI_Daily_Summary 是版面型分頁，沒有單一表頭，
// 資料列數就是 #META 之後的總列數。
function withMeta(body, meta) {
  const metaRow = ['#META', `snapshotId=${meta.snapshotId}`, `schemaVersion=${meta.schemaVersion}`, `generatedAt=${meta.generatedAt}`, `bodyRows=${body.length}`]
  return [metaRow, ...body]
}

function requestTableRows(rows, snapId) {
  const header = ['reqCode', 'name', 'category', 'region', 'urgent', 'status', 'dueDate', 'createdDate', 'reviewedDate', 'startedDate',
    'reviewingDate', 'completedDate', 'assigneeCodes', 'isOpen', 'isOverdue', 'overdueDays', 'dueBucket', 'selfCreated', 'snapshotId']
  return [header, ...rows.map((r) => [r.id, r.name, r.category, r.region, r.urgent, r.status, r.dueDate, r.createdDate, r.reviewedDate,
    r.startedDate, r.reviewingDate, r.completedDate, r.assigneeCodes.join(';'), r.isOpen, r.isOverdue, r.overdueDays, r.dueBucket, r.selfCreated, snapId])]
}
function projectTableRows(rows, snapId) {
  const header = ['projCode', 'name', 'type', 'status', 'startDate', 'endDate', 'year', 'assigneeCodes', 'phase', 'daysToStart', 'snapshotId']
  return [header, ...rows.map((p) => [p.id, p.name, p.type, p.status, p.startDate, p.endDate, p.year, p.assigneeCodes.join(';'), p.phase, p.daysToStart, snapId])]
}

function summaryRows({ meta, stats, workload, risks }) {
  const S = stats
  const rows = []
  rows.push(['section', 'metric', 'value', 'definition'])
  const kv = (metric, value, def = '') => rows.push(['SNAPSHOT', metric, value, def])
  kv('snapshotId', meta.snapshotId, '與每個分頁 #META 列、AI_Sync_Status 必須一致')
  kv('schemaVersion', meta.schemaVersion)
  kv('generatedAt', meta.generatedAt, 'UTC ISO')
  kv('todayTaipei', meta.todayStr, '所有日期判斷以台灣時間為準')
  kv('weekMonToSun', `${meta.week.start}..${meta.week.end}`, '本週定義：週一至週日')
  kv('anonymized', meta.anonymize, 'true = 需求/專案名稱已以代碼取代')
  kv('scope', `開放中需求全部 + 近 ${RETENTION_DAYS} 天內結案/駁回`, '更早的已結案/已駁回不在此表，總數不等於系統內歷史總數')
  const m = (metric, value, def = '') => rows.push(['COUNTS', metric, value, def])
  m('totalRequestsInScope', S.total, '範圍內需求總數 = 下列六個狀態加總')
  m('status.pending', S.byStatus.pending, '待審核')
  m('status.assigned', S.byStatus.assigned, '已發稿')
  m('status.in_progress', S.byStatus.in_progress, '設計中')
  m('status.reviewing', S.byStatus.reviewing, '設計確認中(初稿已送出，等確認；不算逾期)')
  m('status.completed', S.byStatus.completed, `已結案，僅近 ${RETENTION_DAYS} 天`)
  m('status.rejected', S.byStatus.rejected, `已駁回，僅近 ${RETENTION_DAYS} 天`)
  m('openRequests', S.open, '待審核 + 已發稿 + 設計中 + 設計確認中')
  m('activeRequests', S.active, '進行中 = 已發稿 + 設計中')
  m('overdue', S.overdue, '進行中且交期早於今天；交期當天不算逾期(與現有逾期提醒信一致)')
  m('dueThisWeek', S.dueThisWeek, '進行中且 今天 ≤ 交期 ≤ 本週日；與逾期互斥')
  m('noDueDate', S.noDue, '進行中但沒有交期')
  m('openDueThisWeek', S.openDueThisWeek, '補充：含待審核、設計確認中')
  m('openNoDueDate', S.openNoDue, '補充：含待審核、設計確認中')
  m('pastDueNotWatched', S.pastDueNotWatched, '待審核/設計確認中且已過交期；系統不算逾期，這裡單獨列出')
  m('urgentOpen', S.urgentOpen, '開放中且標記急件')
  m('unassignedNonPending', S.unassignedNonPending, '已發稿以後卻沒有負責人(資料異常才會 > 0)')
  m('invalidDueDate', meta.invalidDueDate, '交期格式不是 yyyy-mm-dd 的筆數，已視為沒有交期')
  rows.push([])
  rows.push(['WORKLOAD', 'assigneeCode', 'active', 'assigned', 'inProgress', 'reviewing', 'dueThisWeek', 'overdue', 'sharedActive', 'completed'])
  for (const w of workload) rows.push(['WORKLOAD', w.code, w.active, w.assigned, w.inProgress, w.reviewing, w.dueThisWeek, w.overdue, w.sharedActive, w.completed])
  rows.push(['WORKLOAD_NOTE', '共同指派的需求在每位負責人各算一次，所以每人數字不可相加；總數以 COUNTS 為準。UNASSIGNED = 已發稿以後卻沒有負責人'])
  rows.push([])
  rows.push(['RISK_TOP3', 'rank', 'reqCode', 'name', 'status', 'dueDate', 'overdueDays', 'assigneeCodes', 'score', 'reasons'])
  for (const k of risks) rows.push(['RISK_TOP3', k.rank, k.id, k.name, k.status, k.dueDate, k.overdueDays, k.assigneeCodes.join(';'), k.score, k.reasons.join(';')])
  if (risks.length === 0) rows.push(['RISK_TOP3', '(none)'])
  rows.push(['RISK_NOTE', '風險「候選」依固定加分規則排序，不是結論：OVERDUE +100+逾期天數(最多30)；PENDING_PAST_DUE +80+天數；REVIEW_PAST_DUE +50+天數；DUE_WITHIN_2_DAYS +40(已發稿尚未開始再 +15)；URGENT +25'])
  return rows
}

function readmeRows(meta) {
  return [
    ['AI 專案管理資料表 — 使用說明(給 ChatGPT 與人類讀者)'],
    [`schemaVersion=${meta.schemaVersion}`],
    ['⚠️ 讀資料前先檢查：AI_Sync_Status 的 status 必須是 OK，且 snapshotId 與 AI_Daily_Summary、AI_Requests、AI_Projects 第一列 #META 的 snapshotId 完全相同，'
      + 'schemaVersion 一致，lastSuccessAt 距今不超過 26 小時。任何一項不符，請先告知使用者「資料可能過期或不完整」，不要直接分析。'],
    ['資料每日台灣時間 07:45 更新一次。所有日期為台灣時間 yyyy-mm-dd。'],
    ['名稱與負責人已去識別化：reqCode / projCode 是穩定代碼，負責人是 D-xxxxxx(設計師)、P-xxxxxx(Planner)。代碼不能還原為真實姓名或 email。'],
    ['不含：email、附件、分享連結、需求內容、備註、預算、休假與外出。請勿要求或推測這些資料。'],
    ['需求狀態：pending 待審核 → assigned 已發稿 → in_progress 設計中 → reviewing 設計確認中 → completed 已結案；rejected 已駁回。'],
    ['進行中 = assigned + in_progress。逾期 = 進行中且交期 < 今天(交期當天不算)。本週到期 = 進行中且今天 ≤ 交期 ≤ 本週日(週一至週日)。'],
    ['待審核與設計確認中即使已過交期也不算逾期(與公司系統一致)，另以 dueBucket=PAST_DUE_NOT_WATCHED 標出。'],
    [`範圍：開放中需求全部 + 近 ${RETENTION_DAYS} 天內結案/駁回，所以這裡的總數不等於公司系統內的歷史總數。`],
    ['每位負責人的工作量：共同指派的需求每人各算一次，所以每人數字加總會大於需求總數，請以總數為準。'],
    ['風險前三名只是依固定規則算出的「候選」，不是結論；請搭配 AI_Requests 自行判斷。'],
    ['分頁：AI_Daily_Summary(彙總與風險候選)、AI_Requests(每筆需求)、AI_Projects(秀展/設計專案)、AI_Sync_Status(同步狀態)。'],
  ]
}

// ───────────────────────── 完整性：checksum、PII 守門 ─────────────────────────
// 儲存格正規化：寫入前與讀回後都經過同一個函式，比對才有意義
// (Sheets 讀回時，布林/數字型別、尾端空白儲存格都可能跟寫入時不同)。
export function canonCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}
export function canonRows(rows) {
  const out = (rows || []).map((r) => {
    const cells = (r || []).map(canonCell)
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    return cells
  })
  while (out.length && out[out.length - 1].length === 0) out.pop()
  return out
}
export function checksumRows(rows) {
  return createHash('sha256').update(JSON.stringify(canonRows(rows))).digest('hex')
}

// 最後一道防線：任何儲存格含 email 或網址，整份快照作廢(寧可同步失敗，也不要外送)
export function assertNoPii(tabs) {
  for (const [tab, rows] of Object.entries(tabs)) {
    for (const row of rows) {
      for (const cell of row || []) {
        if (typeof cell !== 'string') continue
        if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(cell) || /https?:\/\//i.test(cell)) {
          throw new PiiError(`分頁 ${tab} 偵測到疑似 email/網址，已中止輸出`)
        }
      }
    }
  }
}
export class PiiError extends Error {
  constructor(msg) { super(msg); this.name = 'PiiError' }
}
