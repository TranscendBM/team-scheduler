import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './AuthContext'
import { canAccess as canAccessFn } from '../utils/pages'

const PermissionsContext = createContext(null)

export function PermissionsProvider({ children }) {
  const { user, unauthorized } = useAuth()
  const [perms, setPerms] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || unauthorized) { setPerms({}); setLoading(false); return }
    const unsub = onSnapshot(doc(db, 'settings', 'permissions'),
      snap => { setPerms(snap.exists() ? (snap.data().pages || {}) : {}); setLoading(false) },
      () => setLoading(false))
    return unsub
  }, [user, unauthorized])

  const value = {
    perms,
    loading,
    canAccess: (pageKey, role) => canAccessFn(perms, pageKey, role),
  }
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export const usePermissions = () => useContext(PermissionsContext)
