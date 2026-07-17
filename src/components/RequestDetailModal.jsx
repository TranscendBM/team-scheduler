import { statusMeta } from '../utils/requestConstants'
import Attachments from './Attachments'

function fmt(ts) {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Row({ label, children, highlight }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className={`flex gap-3 py-2 border-b border-gray-50 text-sm ${highlight ? 'bg-amber-50 -mx-2 px-2 rounded' : ''}`}>
      <dt className="w-24 shrink-0 text-gray-400 text-xs pt-0.5">{label}</dt>
      <dd className={`flex-1 min-w-0 whitespace-pre-wrap ${highlight ? 'text-amber-800' : 'text-gray-700'}`}>{children}</dd>
    </div>
  )
}

// 完整發稿內容彈窗。actions: 額外按鈕(選填)
export default function RequestDetailModal({ r, onClose, actions }) {
  if (!r) return null
  const meta = statusMeta(r.status)
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start gap-3 rounded-t-2xl">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-800">
              {r.urgent && <span className="text-red-500 mr-1">🔥</span>}
              {r.projectName || r.title}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">提交：{r.submittedByName || r.submittedBy} · {fmt(r.createdAt) || '—'}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>{meta.label}</span>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-lg leading-none">✕</button>
        </div>

        <dl className="px-6 py-3">
          <Row label="急件">{r.urgent ? '🔥 是(L/T 少於 5 個工作天)' : '否'}</Row>
          <Row label="地區">{r.region}</Row>
          <Row label="稿件類型">{(r.docTypes || []).join('、')}</Row>
          <Row label="交期">{r.dueDate}</Row>
          <Row label="需求簡述">{r.description}</Row>
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

        {(actions || null) && (
          <div className="px-6 pb-5 pt-1 flex gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
