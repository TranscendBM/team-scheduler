// 空狀態（RWD：手機上不會被固定高度撐出捲動、文字可換行）
export default function EmptyState({ icon, title, children, className = '' }) {
  return (
    <div className={`flex items-center justify-center py-12 sm:py-16 px-4 text-gray-500 ${className}`}>
      <div className="text-center max-w-sm">
        {icon && <div className="text-4xl mb-2">{icon}</div>}
        {title && <p className="text-sm sm:text-base break-words">{title}</p>}
        {children}
      </div>
    </div>
  )
}
