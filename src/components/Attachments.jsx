// 顯示需求附件的下載連結
export default function Attachments({ items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(a => (
        <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-2.5 py-1 transition-colors">
          📄 <span className="truncate max-w-[180px]">{a.name}</span>
        </a>
      ))}
    </div>
  )
}
