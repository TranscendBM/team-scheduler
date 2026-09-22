import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import RequestDetailModal from '../components/RequestDetailModal'

const getSharedRequestFn = httpsCallable(functions, 'getSharedRequest')

// 透過分享連結唯讀檢視單一需求。這個路由本身仍在 App.jsx 的 <ProtectedRoute> 底下
// (必須已登入才看得到)，但刻意不套用 PermRoute/角色權限矩陣——是否能看到「這一筆」需求
// 完全由網址帶的 token 決定(見 functions/index.js getSharedRequestCore)，跟角色/地區無關，
// 這正是「分享連結」這個功能存在的目的。
export default function SharedRequestPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const requestKey = `${id}::${token}`
  // fetchedKey 代表「result 目前裝的是哪一組 id/token 的結果」；跟 requestKey 對不上
  // 就代表還在載入中(或還沒開始載入)——用比較 key 的方式推導 loading 狀態，而不是在
  // effect 一開始就同步呼叫 setState({loading:true}) 去手動標記，這樣 effect 裡唯一會
  // 呼叫 setState 的地方，就只有非同步呼叫真正 resolve/reject 之後的 callback，符合
  // React 建議的 effect 寫法(不要在 effect body 開頭就同步 setState)。
  const [fetchedKey, setFetchedKey] = useState(null)
  const [result, setResult] = useState({ error: '', data: null })
  const loading = fetchedKey !== requestKey

  useEffect(() => {
    if (!id || !token) return undefined // 缺參數時不發送請求，交給下面的提早 return 畫面處理
    let cancelled = false

    getSharedRequestFn({ requestId: id, token })
      .then(({ data }) => {
        if (cancelled) return
        setResult({ error: '', data })
        setFetchedKey(requestKey)
      })
      .catch((e) => {
        if (cancelled) return
        // 刻意不細分「token 錯」跟「已過期」以外的錯誤訊息差異(見 getSharedRequestCore
        // 的說明：避免被拿來窮舉試探合法 token)，但「帳號本身有問題」跟「連結本身有問題」
        // 是兩種使用者能自行判斷、也需要不同下一步動作的情境(前者要找主管處理帳號，
        // 後者要找建立連結的人重新產生)，所以這兩種還是分開講。
        const message = e.code === 'permission-denied'
          ? '這個帳號不在白名單內，或已被停用，無法透過分享連結檢視需求。'
          : '分享連結無效或已過期，請向建立連結的人重新索取。'
        setResult({ error: message, data: null })
        setFetchedKey(requestKey)
      })

    return () => { cancelled = true }
  }, [id, token, requestKey])

  if (!id || !token) {
    return (
      <ErrorScreen message="這個分享連結缺少必要的參數，請確認網址是否完整貼上。" onBack={() => navigate('/')} />
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh] p-4 text-gray-500">載入中…</div>
  }

  if (result.error) {
    return <ErrorScreen message={result.error} onBack={() => navigate('/')} />
  }

  return <RequestDetailModal r={result.data} onClose={() => navigate('/')} shareable={false} />
}

function ErrorScreen({ message, onBack }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-6 max-w-md w-full text-center space-y-3">
        <p className="text-gray-700 text-sm break-words">{message}</p>
        <button onClick={onBack} className="text-blue-600 hover:underline text-sm py-2 min-h-[44px]">回到首頁</button>
      </div>
    </div>
  )
}
