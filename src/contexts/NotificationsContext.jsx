import { createContext, useContext, useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './AuthContext'

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
  const { role, email, regions, unauthorized } = useAuth()
  const [rows, setRows] = useState([])
  const [seen, setSeen] = useState(new Set())

  useEffect(() => {
    if (!email || unauthorized || !role) { setRows([]); return }
    let q
    if (role === 'manager') {
      q = query(collection(db, 'requests'), where('status', '==', 'pending'))
    } else if (role === 'designer') {
      q = query(collection(db, 'requests'), where('assignedDesigners', 'array-contains', email))
    } else if (role === 'planner') {
      if (!regions || regions.length === 0) { setRows([]); return }
      q = query(collection(db, 'requests'), where('region', 'in', regions.slice(0, 30)))
    } else { setRows([]); return }

    setSeen(loadSeen(email))
    const unsub = onSnapshot(q, snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [role, email, regions, unauthorized])

  function markSeen(id) {
    if (!email) return
    setSeen(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev); next.add(id)
      persistSeen(email, next)
      return next
    })
  }

  const pendingCount = role === 'manager' ? rows.length : 0
  const newIds = new Set(
    role === 'manager' ? [] : rows
      .filter(r => ACTIVE.includes(r.status))
      .filter(r => r.submittedBy !== email)   // 自己送的不算 NEW
      .filter(r => !seen.has(r.id))
      .map(r => r.id)
  )

  return (
    <NotificationsContext.Provider value={{ newIds, newCount: newIds.size, pendingCount, markSeen }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
