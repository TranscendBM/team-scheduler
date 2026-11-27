// 儀表板「我的夥伴」的個人化訊息 —— 純函式，不碰 Firestore/React，方便單元測試。
// 訊息由現有資料用規則產生(不呼叫 AI)：問候、我負責的秀展倒數、設計師/需求人的需求狀況、主管的全公司重點。
// today 從外面傳入('YYYY-MM-DD')，測試才不用 mock 時間。
import { daysBetween } from './tradeshowCountdown'

export function greeting(hour) {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 14) return '午安'
  if (hour < 18) return '午安'
  return '辛苦了'
}

// 頭像檔名 key：公司信箱 @ 前面那段(小寫)，沒有就用登入信箱；檔案放 public/avatars/<key>.png
export function avatarKey(...emails) {
  for (const e of emails) {
    const k = String(e || '').trim().toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '')
    if (k) return k
  }
  return ''
}

// 找不到圖時顯示的縮寫：英文取前兩個字母，中文取第一個字
export function initialsOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  if (/^[ -~]+$/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase()
  }
  return s[0]
}

// → [{ text, tone }]，tone: 'info' | 'warn' | 'good'。依重要性由高到低排序，最後一則一定是問候
export function buildCompanionMessages({
  name = '', role = '', today, hour = 9,
  ongoingShows = [], upcomingShows = [],
  assignedRequests = [], myRequests = [],
  manager = {},
} = {}) {
  const out = []
  const who = name ? `${name}，` : ''

  // 秀展：進行中最優先，其次是最近要開展的
  for (const p of ongoingShows.slice(0, 2)) {
    const day = daysBetween(p.startDate, today) + 1
    out.push({ tone: 'info', text: `「${p.name}」展期進行中，今天是第 ${day} 天，現場加油！` })
  }
  const next = upcomingShows[0]
  if (next) {
    const days = daysBetween(today, next.startDate)
    if (days === 0) out.push({ tone: 'warn', text: `「${next.name}」今天開展！` })
    else if (days <= 14) out.push({ tone: 'warn', text: `你負責的「${next.name}」還有 ${days} 天開展，進度都還順利嗎？` })
    else out.push({ tone: 'info', text: `下一場是「${next.name}」，還有 ${days} 天。` })
  }

  // 設計師：指派給我的需求
  if (role === 'designer') {
    const open = assignedRequests.filter(r => r.dueDate)
    const overdue = open.filter(r => r.dueDate < today)
    const soon = open.filter(r => r.dueDate >= today && daysBetween(today, r.dueDate) <= 3)
    if (overdue.length) out.push({ tone: 'warn', text: `有 ${overdue.length} 件需求已經超過期限，先處理它們吧。` })
    if (soon.length) out.push({ tone: 'warn', text: `有 ${soon.length} 件需求 3 天內到期。` })
    if (assignedRequests.length && !overdue.length && !soon.length) {
      out.push({ tone: 'info', text: `手上有 ${assignedRequests.length} 件需求進行中，時程都還充裕。` })
    }
    if (!assignedRequests.length) out.push({ tone: 'good', text: '目前沒有進行中的需求，可以喘口氣！' })
  }

  // 需求人：我送出的需求
  if (role === 'planner') {
    const done = myRequests.filter(r => r.status === 'completed').length
    const review = myRequests.filter(r => r.status === 'reviewing').length
    const pending = myRequests.filter(r => r.status === 'pending').length
    if (review) out.push({ tone: 'warn', text: `有 ${review} 件需求的設計稿等你確認。` })
    if (done) out.push({ tone: 'good', text: `最近有 ${done} 件需求已經結案，太棒了！` })
    if (pending) out.push({ tone: 'info', text: `${pending} 件需求正在等主管審核。` })
  }

  // 主管：全公司重點
  if (role === 'manager') {
    if (manager.newProductAttention) out.push({ tone: 'warn', text: `有 ${manager.newProductAttention} 項新品上官網逾期或即將上線。` })
    if (manager.showsSoon) out.push({ tone: 'info', text: `未來三個月共有 ${manager.showsSoon} 場秀展。` })
    if (manager.onLeaveSoon) out.push({ tone: 'info', text: `未來一個月有 ${manager.onLeaveSoon} 筆休假預排。` })
  }

  out.push({ tone: 'info', text: `${greeting(hour)}，${who}今天也一起加油！` })
  return out
}
