import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db, googleProvider } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)        // Firebase user 物件
  const [role, setRole] = useState(null)        // 'manager' | 'designer' | 'planner'
  const [regions, setRegions] = useState([])    // planner 負責的區域
  const [unauthorized, setUnauthorized] = useState(false) // 已登入但不在白名單/已停用
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubUserDoc = null

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      // 換帳號或登出時，先解除前一個使用者文件的監聽，避免殘留舊角色資料
      if (unsubUserDoc) { unsubUserDoc(); unsubUserDoc = null }

      if (!fbUser) {
        setUser(null); setRole(null); setRegions([]); setUnauthorized(false); setLoading(false)
        return
      }

      // email 理論上一定存在（Google provider），但防禦性處理避免 undefined.toLowerCase() 炸掉
      const email = (fbUser.email || '').trim().toLowerCase()
      if (!email) {
        console.error('登入帳號沒有 email，無法比對白名單')
        setUser(fbUser); setRole(null); setRegions([]); setUnauthorized(true); setLoading(false)
        return
      }

      // 即時監聽使用者文件：角色/regions 被改、帳號被停用或刪除時立刻反映到前端，
      // 不必等下次登入或重整。
      unsubUserDoc = onSnapshot(
        doc(db, 'users', email),
        (snap) => {
          if (snap.exists() && snap.data().active !== false) {
            const data = snap.data()
            setUser(fbUser); setRole(data.role || null); setRegions(data.regions || []); setUnauthorized(false)
          } else {
            // 不在名單、被停用或文件被刪除 → 立即擋下（即使原本已登入中）
            setUser(fbUser); setRole(null); setRegions([]); setUnauthorized(true)
          }
          setLoading(false)
        },
        (err) => {
          console.error('讀取使用者角色失敗', err)
          setUser(fbUser); setRole(null); setRegions([]); setUnauthorized(true); setLoading(false)
        }
      )
    })

    return () => {
      unsubAuth()
      if (unsubUserDoc) unsubUserDoc()
    }
  }, [])

  const value = {
    user,
    role,
    regions,
    email: user?.email ? user.email.trim().toLowerCase() : null,
    isManager: role === 'manager',
    isDesigner: role === 'designer',
    isPlanner: role === 'planner',
    unauthorized,
    loading,
    login: () => signInWithPopup(auth, googleProvider),
    logout: () => signOut(auth),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
