import { statusMeta } from '../utils/requestConstants'
import Attachments from './Attachments'
import Linkify from './Linkify'
import ShareLinkPanel from './ShareLinkPanel'
import ModalShell from './ui/ModalShell'

function fmt(ts) {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// 手機：標籤在上、內容在下（w-24 的固定標籤欄在 320px 會把內容擠成一行一兩個字）
// sm 以上：維持原本左右兩欄的資訊密度
function Row({ label, children, highlight }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className={`flex flex-col sm:flex-row gap-0.5 sm:gap-3 py-2 border-b border-gray-50 text-sm ${highlight ? 'bg-amber-50 -mx-2 px-2 rounded' : ''}`}>
      <dt className="sm:w-24 sm:shrink-0 text-gray-500 text-xs sm:pt-0.5">{label}</dt>
      <dd className={`flex-1 min-w-0 whitespace-pre-wrap break-words ${highlight ? 'text-amber-800' : 'text-gray-700'}`}>{children}</dd>
    </div>
  )
}

// 完整發稿內容彈窗。actions: 額外按鈕(選填)。shareable: 是否顯示「分享連結」面板
// (預設 true)——透過分享連結本身開啟的唯讀檢視(SharedRequestPage)要傳 false，
// 避免對「原本就沒有這筆需求檢視權限」的訪客顯示一個他們用不了的按鈕(建立/撤銷連結
// 本身仍然需要原本的檢視權限，伺服器端 Cloud Function 會再檔一次，這裡只是不讓
// UI 顯示出一個必然失敗的操作)。
export default function RequestDetailModal({ r, onClose, actions, shareable = true }) {
  if (!r) return null
  const meta = statusMeta(r.status)
  return (
    <ModalShell
      onClose={onClose}
      maxWidth="max-w-xl"
      bodyClassName="px-4 sm:px-6 py-3"
      title={
        <span className="block">
          <span className="block break-words">
            {r.urgent && <span className="text-red-500 mr-1">🔥</span>}
            {r.projectName || r.title}
          </span>
          <span className="block text-xs font-normal text-gray-500 mt-0.5 break-words">
            提交：{r.submittedByName || r.submittedBy} · {fmt(r.createdAt) || '—'}
          </span>
        </span>
      }
      headerExtra={<span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>{meta.label}</span>}
      footer={actions ? <div className="flex flex-col sm:flex-row gap-2">{actions}</div> : null}
    >
      {shareable && (
        <div className="pt-1 pb-2">
          <ShareLinkPanel requestId={r.id} shareToken={r.shareToken} shareExpiresAt={r.shareExpiresAt} />
        </div>
      )}

      <dl>
        <Row label="急件">{r.urgent ? '🔥 是(L/T 少於 5 個工作天)' : '否'}</Row>
        <Row label="地區">{r.region}</Row>
        <Row label="稿件類型">{(r.docTypes || []).join('、')}</Row>
        <Row label="交期">{r.dueDate}</Row>
        <Row label="需求簡述">{r.description ? <Linkify text={r.description} /> : null}</Row>
        <Row label="附件">{r.attachments?.length > 0 ? <Attachments items={r.attachments} requestId={r.id} /> : null}</Row>
        <Row label="指派設計師">{(r.assignedDesignersNames?.length ? r.assignedDesignersNames : (r.assignedDesigners || [])).join('、') || null}</Row>
        <Row label="審核備註">{r.reviewNote}</Row>
        <Row label="注意事項" highlight>{r.comment}</Row>
        {r.status === 'rejected' && <Row label="駁回原因">{r.rejectReason}</Row>}
        <Row label="審核時間">{fmt(r.reviewedAt)}</Row>
        <Row label="開始設計">{fmt(r.startedAt)}</Row>
        <Row label="送出確認">{fmt(r.reviewingAt)}</Row>
        <Row label="結案時間">{fmt(r.completedAt)}</Row>
      </dl>
    </ModalShell>
  )
}
