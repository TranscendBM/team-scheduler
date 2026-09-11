import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

const createShareLinkFn = httpsCallable(functions, 'createShareLink')
const revokeShareLinkFn = httpsCallable(functions, 'revokeShareLink')

function buildShareUrl(requestId, token) {
  // HashRouter：實際路徑在 # 後面，見 src/main.jsx
  return `${window.location.origin}/#/request/shared/${requestId}?token=${token}`
}

// shareExpiresAt 有兩種來源、兩種型別：從父層 onSnapshot 即時監聽拿到的是 Firestore
// client SDK 的 Timestamp 物件(有 .toDate())，從 createShareLinkFn() 呼叫回傳的是
// 已經轉成 ISO 字串的值(見 functions/index.js toIsoOrNull)——這裡統一轉成毫秒數，
// 兩種輸入、以及完全沒有值的情況都要能安全處理，不能假設一定是某一種型別。
function toMillis(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function fmtExpiry(value) {
  const ms = toMillis(value)
  if (ms == null) return ''
  return new Date(ms).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// 需求詳情裡的「分享連結」小面板：建立/撤銷分享連結，讓組員即使原本沒有這筆需求的
// 檢視權限，登入後也能透過連結看到內容(唯讀)。審核前後都能用，不受 status 限制。
//
// r.shareToken/r.shareExpiresAt 是 requests/{id} 文件本身的欄位(由 Cloud Function 寫入，
// 見 functions/index.js createShareLinkCore)，父層的 onSnapshot 監聽本來就會即時收到。
// 這裡用「override」保存 create/revoke 呼叫回傳的最新值，讓畫面立刻反映結果、不用等
// snapshot 往返；當 props 傳進來的 shareToken 真的變了(snapshot 送到、或換了別筆需求)，
// 就在 render 當下清掉 override 讓 props 重新接手——這是 React 官方建議的「render 期間
// 依 props 變化調整 state」寫法，刻意不用 useEffect 呼叫 setState 去同步 props
// (避免多一次額外的重新渲染，也符合 eslint react-hooks/set-state-in-effect 的要求)。
//
// 是否「過期」交給後端(getSharedRequestCore)在真正被拿去用的當下判斷——這裡顯示的到期
// 日期只是給使用者看的資訊，不在畫面上呼叫 Date.now() 重新計算「現在是否已過期」
// (react-hooks/purity 不允許 render 期間呼叫這類會隨時間改變結果的不純函式)。
export default function ShareLinkPanel({ requestId, shareToken, shareExpiresAt }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [override, setOverride] = useState(null) // { shareToken, shareExpiresAt } | null

  const [trackedShareToken, setTrackedShareToken] = useState(shareToken)
  if (shareToken !== trackedShareToken) {
    setTrackedShareToken(shareToken)
    setOverride(null)
  }

  const effectiveToken = override ? override.shareToken : shareToken
  const effectiveExpiresAt = override ? override.shareExpiresAt : shareExpiresAt
  const hasActiveLink = !!effectiveToken

  async function handleCreate() {
    setError('')
    setBusy(true)
    setCopied(false)
    try {
      const { data } = await createShareLinkFn({ requestId })
      setOverride({ shareToken: data.shareToken, shareExpiresAt: data.shareExpiresAt })
    } catch (e) {
      setError('建立分享連結失敗：' + (e.message || e.code))
    }
    setBusy(false)
  }

  async function handleRevoke() {
    setError('')
    setBusy(true)
    try {
      await revokeShareLinkFn({ requestId })
      setOverride({ shareToken: null, shareExpiresAt: null })
      setCopied(false)
    } catch (e) {
      setError('撤銷分享連結失敗：' + (e.message || e.code))
    }
    setBusy(false)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildShareUrl(requestId, effectiveToken))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('複製失敗，請手動選取連結文字')
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
      >
        🔗 分享連結
      </button>
    )
  }

  return (
    <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-600">🔗 分享連結</span>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">收合</button>
      </div>
      <p className="text-gray-500">
        產生連結後，任何已登入且在白名單內的組員都能透過連結唯讀檢視這筆需求(不受原本的角色/地區限制)，審核前後皆可使用。
      </p>

      {hasActiveLink ? (
        <>
          <div className="flex gap-2">
            <input
              readOnly
              value={buildShareUrl(requestId, effectiveToken)}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-white border border-gray-200 rounded px-2 py-1 text-gray-700"
            />
            <button
              onClick={handleCopy}
              disabled={busy}
              className="shrink-0 px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <div className="flex items-center justify-between text-gray-500">
            <span>有效期限至 {fmtExpiry(effectiveExpiresAt)}</span>
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={busy} className="text-blue-600 hover:underline disabled:opacity-50">重新產生</button>
              <button onClick={handleRevoke} disabled={busy} className="text-red-600 hover:underline disabled:opacity-50">撤銷連結</button>
            </div>
          </div>
        </>
      ) : (
        <button
          onClick={handleCreate}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '產生中…' : '建立分享連結'}
        </button>
      )}

      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
