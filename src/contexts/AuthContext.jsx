import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)        // Firebase user 物件
  const [role, setRole] = useState(null)        // 'manager' | 'designer' | 'planner'
  const [regions, setRegions] = useState([])    // planner 負責的區域
  const [unauthorized, setUnauthorized] = useState(false) // 已登入但不在白名單
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null); setRole(null); setUnauthorized(false); setLoading(false)
        return
      }
      // 依 email 查 users collection 決定角色（白名單制）
      const email = (fbUser.email || '').toLowerCase()
      try {
        const snap = await getDoc(doc(db, 'users', email))
        if (snap.exists() && snap.data().active !== false) {
          setUser(fbUser); setRole(snap.data().role); setRegions(snap.data().regions || []); setUnauthorized(false)
        } else {
          // 不在名單或被停用 → 擋下
          setUser(fbUser); setRole(null); setRegions([]); setUnauthorized(true)
        }
      } catch (e) {
        console.error('讀取使用者角色失敗', e)
        setUser(fbUser); setRole(null); setRegions([]); setUnauthorized(true)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const value = {
    user,
    role,
    regions,
    email: user?.email?.toLowerCase() || null,
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
