import { useEffect, useId } from 'react'
import useScrollLock from '../../hooks/useScrollLock'

// 全站共用的 Modal 外框。
//
// 桌面：置中卡片，寬度由 maxWidth 決定（跟各頁原本的 max-w-* 一致）。
// 手機：貼底的 bottom sheet（接近全螢幕），最大高度用 100dvh 計算，
//       header / footer 固定、中間內容自己捲動，鍵盤跳出來時主要按鈕仍然到得了。
//
// 行為刻意跟原本各頁自己寫的 Modal 保持一致，不改變任何確認流程：
//  - dismissible=true（預設）：點 backdrop 或按 Escape 會呼叫 onClose。
//  - dismissible=false：破壞性確認用，backdrop 與 Escape 都不會關閉，
//    使用者只能明確按「取消」（原本的刪除確認視窗本來就沒有 backdrop 關閉行為）。
export default function ModalShell({
  onClose,
  title,
  maxWidth = 'max-w-lg',
  dismissible = true,
  footer,
  children,
  headerExtra,
  showClose = true,
  bodyClassName = 'px-4 sm:px-6 py-5 space-y-4',
}) {
  const labelId = useId()
  useScrollLock(true)

  useEffect(() => {
    if (!dismissible) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismissible, onClose])

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => { if (dismissible && e.target === e.currentTarget) onClose?.() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        className={`bg-white w-full ${maxWidth} rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col min-h-0 max-h-[92dvh] sm:max-h-[90vh]`}
      >
        {(title || headerExtra) && (
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-start justify-between gap-3 shrink-0 bg-white rounded-t-2xl">
            <h3 id={labelId} className="text-base sm:text-lg font-semibold text-gray-800 min-w-0 break-words">{title}</h3>
            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              {showClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="關閉"
                  className="w-11 h-11 -mr-2 -my-2 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-white shrink-0 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
