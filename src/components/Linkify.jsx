import { splitLinkParts } from '../utils/linkify'

// 把純文字裡的網址轉成可點擊連結。用文字節點 + <a> 陣列 render，不是 dangerouslySetInnerHTML，
// 沒有 XSS 風險。
export default function Linkify({ text }) {
  return splitLinkParts(text).map((part, i) =>
    part.type === 'url'
      ? (
        <a key={i} href={part.value} target="_blank" rel="noreferrer noopener"
          className="text-blue-600 underline hover:text-blue-800 break-all">
          {part.value}
        </a>
      )
      : <span key={i}>{part.value}</span>
  )
}
