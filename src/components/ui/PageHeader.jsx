// 頁首（標題 + 說明 + 右側操作）。
// 手機上下排列、桌面左右排列；操作列在窄螢幕可換行，不會把標題擠爆。
//
// variant:
//  - 'bar'（預設）：白底 + 底線，給「整頁 flex 直向、內容區自己捲動」的頁面用
//  - 'plain'：無底色，給 p-4 sm:p-6 lg:p-8 這種一般捲動頁面用
export default function PageHeader({ title, subtitle, actions, variant = 'bar', children }) {
  const wrapper = variant === 'bar'
    ? 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-b bg-white shrink-0'
    : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4'

  return (
    <div className={wrapper}>
      <div className="min-w-0">
        <h1 className={`${variant === 'bar' ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'} font-bold text-gray-800 break-words`}>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-gray-500 break-words">{subtitle}</p>}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:justify-end sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
