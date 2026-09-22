import { useId } from 'react'
import useScrollLock from '../../hooks/useScrollLock'

// 破壞性操作的確認視窗（刪除、撤銷…）。
//
// 刻意「不」支援 backdrop 或 Escape 關閉——跟改版前的行為一致，也避免手機上
// 誤觸背景就把確認視窗關掉。使用者只能明確按「取消」或確認鍵。
// 手機按鈕改成上下堆疊且等寬（確認鍵在上、取消在下都能單手按到），桌面維持原本靠右排列。
export default function ConfirmDialog({
  title = '確認刪除',
  message,
  confirmLabel = '刪除',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  confirmClassName = 'bg-red-600 hover:bg-red-700',
  busy = false,
}) {
  const labelId = useId()
  useScrollLock(true)

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-sm w-full max-h-[92dvh] overflow-y-auto"
      >
        <h3 id={labelId} className="text-base sm:text-lg font-semibold text-gray-800 mb-2 break-words">{title}</h3>
        {message && <p className="text-sm text-gray-500 mb-6 break-words">{message}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 sm:border-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm text-white rounded-lg disabled:opacity-50 ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
