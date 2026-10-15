import { createContext, useContext, useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './AuthContext'
import { buildAssignmentAlerts } from '../utils/assignmentAlerts'

// 新任務提示:
// - designer / planner:localStorage 記錄「看過」的需求 id,沒點開過的進行中需求顯示 NEW(側邊欄+總表列)
// - manager:側邊欄「需求審核」顯示待審核數量
const NotificationsContext = createContext(null)

const storeKey = (email) => `ts-seen:${email}`
const loadSeen = (email) => {
  try { return new Set(JSON.parse(localStorage.getItem(storeKey(email)) || 'null') || []) }
  catch { return new Set() }
}
const persistSeen = (email, set) => {
  try { localStorage.setItem(storeKey(email), JSON.stringify([...set].slice(-2000))) } catch { /* 忽略 */ }
}

const ACTIVE = ['pending', 'assigned', 'in_progress', 'reviewing']

export function NotificationsProvider({ children }) {
  const { role, email, regions, unauthorized, canReview } = useAuth()
  const [rows, setRows] = useState([])
  const [delegateRows, setDelegateRows] = useState([])   // 臨時審核代理人專用：待審核數量
  const [ownRows, setOwnRows] = useState([])             // 我提交的需求(提交人要知道何時被指派)
  const [nowMs] = useState(() => Date.now())             // 站內通知只看「最近指派」的時間窗，開著不動也不影響
  const [seen, setSeen] = useState(() => loadSeen(email))
  const [seenForEmail, setSeenForEmail] = useState(email)

  // email 變動(登入/切換帳號)時，改讀新帳號在 localStorage 記錄的「已看過」清單。
  // 在 render 期間直接比對調整 state(而非另開 effect)，避免多一次非同步的 setState 級聯渲染。
  if (email !== seenForEmail) {
    setSeenForEmail(email)
    setSeen(loadSeen(email))
  }

  useEffect(() => {
    if (!email || unauthorized || !role) return
    let q
    if (role === 'manager') {
      q = query(collection(db, 'requests'), where('status', '==', 'pending'))
    } else if (role === 'designer') {
      q = query(collection(db, 'requests'), where('assignedDesigners', 'array-contains', email))
    } else if (role === 'planner') {
      if (!regions || regions.length === 0) return
      q = query(collection(db, 'requests'), where('region', 'in', regions.slice(0, 30)))
    } else { return }

    const unsub = onSnapshot(q, snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setRows([]) }
  }, [role, email, regions, unauthorized])

  // 臨時審核代理人（非 manager 但目前被指派代理審核）：額外訂閱待審核數量，跟上面 role 分支的查詢無關。
  // 不符合條件時不訂閱即可——state 初始值就是 []，切換回不符合條件時前一輪的 cleanup 也會清空，不用在這裡多呼叫一次 setState
  useEffect(() => {
    if (role === 'manager' || !canReview) return
    const q = query(collection(db, 'requests'), where('status', '==', 'pending'))
    const unsub = onSnapshot(q, snap => setDelegateRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setDelegateRows([]) }
  }, [role, canReview])

  // 「我提交的需求」：planner 的發稿被主管指派下去時要通知提交人(上面 role 分支是依地區查詢，
  // 不保證涵蓋自己提交但地區不在負責範圍內的需求，所以另開一個依 submittedBy 的訂閱)
  useEffect(() => {
    if (!email || unauthorized || !role || role === 'manager') return
    const q = query(collection(db, 'requests'), where('submittedBy', '==', email))
    const unsub = onSnapshot(q, snap => setOwnRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setOwnRows([]) }
  }, [role, email, unauthorized])

  function markSeen(id) {
    if (!email) return
    setSeen(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev); next.add(id)
      persistSeen(email, next)
      return next
    })
  }

  function markAllSeen(ids) {
    if (!email || !ids.length) return
    setSeen(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.add(id))
      persistSeen(email, next)
      return next
    })
  }

  const alerts = buildAssignmentAlerts({ role, email, assignedRows: rows, ownRows, seen, nowMs })

  const pendingCount = role === 'manager' ? rows.length : (canReview ? delegateRows.length : 0)
  const newIds = new Set(
    role === 'manager' ? [] : rows
      .filter(r => ACTIVE.includes(r.status))
      .filter(r => r.submittedBy !== email)   // 自己送的不算 NEW
      .filter(r => !seen.has(r.id))
      .map(r => r.id)
  )

  return (
    <NotificationsContext.Provider value={{ newIds, newCount: newIds.size, pendingCount, markSeen, markAllSeen, alerts }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
