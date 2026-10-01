// 圓角數字徽章，比照 iOS 未讀訊息紅點樣式——紅色用在「需要注意」的數量(例如設計師手上
// 案件數)，灰色用在中性的分類計數(例如已結案筆數)，共用同一顆元件避免兩個頁面各自維護
// 一份幾乎一樣的 class 字串。
const TONES = {
  red: 'bg-red-500 text-white',
  gray: 'bg-gray-400 text-white',
}

export default function CountBadge({ count, tone = 'red' }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-none ${TONES[tone] || TONES.red}`}>
      {count}
    </span>
  )
}
