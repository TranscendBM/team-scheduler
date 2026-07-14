import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login, logout, user, unauthorized } = useAuth()
  const [err, setErr] = useState('')

  async function handleLogin() {
    setErr('')
    try {
      await login()
    } catch (e) {
      console.error('登入失敗', e)
      setErr(`${e.code || ''} ${e.message || e}`.trim())
    }
  }

  // 已登入但不在白名單 → 顯示未開通訊息
  if (user && unauthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">帳號尚未開通</h1>
          <p className="text-gray-500 text-sm mb-1">你登入的帳號</p>
          <p className="text-gray-700 text-sm font-medium mb-6 break-all">{user.email}</p>
          <p className="text-gray-500 text-sm mb-8">尚未被授權使用本系統,請聯絡主管開通權限。</p>
          <button
            onClick={logout}
            className="w-full bg-gray-100 text-gray-600 py-3 px-6 rounded-xl font-medium hover:bg-gray-200 transition-all"
          >
            使用其他帳號登入
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Team Scheduler</h1>
        <p className="text-gray-500 text-sm mb-8">設計師 & Planner 排程管理系統</p>
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 py-3 px-6 rounded-xl font-medium hover:bg-gray-50 hover:shadow-md transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          使用 Google 帳號登入
        </button>
        {err && (
          <p className="text-xs text-red-500 mt-4 break-words bg-red-50 rounded-lg p-2">{err}</p>
        )}
        <p className="text-xs text-gray-400 mt-6">僅限授權成員使用</p>
      </div>
    </div>
  )
}
