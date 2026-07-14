// 客製化設計需求 — 共用定義（規格 §2.1 / §2.4）

// 狀態流：pending →(rejected)/ assigned → in_progress → reviewing → completed
// color 統一帶 inline-block + whitespace-nowrap,避免小螢幕時標籤文字斷行
const BADGE = 'inline-block whitespace-nowrap'
export const STATUS = {
  pending:     { label: '待審核',     color: `${BADGE} bg-amber-100 text-amber-700`,    dot: 'bg-amber-400' },
  rejected:    { label: '已駁回',     color: `${BADGE} bg-red-100 text-red-700`,        dot: 'bg-red-400' },
  assigned:    { label: '已發稿',     color: `${BADGE} bg-blue-100 text-blue-700`,      dot: 'bg-blue-400' },
  in_progress: { label: '設計中',     color: `${BADGE} bg-indigo-100 text-indigo-700`,  dot: 'bg-indigo-400' },
  reviewing:   { label: '設計確認中', color: `${BADGE} bg-purple-100 text-purple-700`,  dot: 'bg-purple-400' },
  completed:   { label: '已結案',     color: `${BADGE} bg-emerald-100 text-emerald-700`,dot: 'bg-emerald-400' },
}

export const statusMeta = (s) => STATUS[s] || { label: s, color: `${BADGE} bg-gray-100 text-gray-600`, dot: 'bg-gray-400' }

// 設計師手動往前推的順序（不可跳轉）
export const NEXT_STATUS = {
  assigned: 'in_progress',
  in_progress: 'reviewing',
  reviewing: 'completed',
}
export const NEXT_STATUS_LABEL = {
  assigned: '開始設計',
  in_progress: '送出確認',
  reviewing: '打勾結案',
}
// 對應被推進後要蓋的時間戳欄位
export const STATUS_TIMESTAMP = {
  in_progress: 'startedAt',
  reviewing: 'reviewingAt',
  completed: 'completedAt',
}

// 地區（單選）
export const REGIONS = ['HQ', 'SD1', 'SD2', 'SD3', 'SD4', 'SD5', 'CN', 'HK', 'JP', 'KR', 'US', 'GM', 'NL', 'UK']

// 稿件類型（可複選）
export const DOC_TYPES = ['DM', 'Poster', 'Display Board', 'BTO', '其他印刷品', 'Photo', 'eDM', 'PEP', 'Banner', '網頁 / HTML', 'Video', '其他']

// 附件上限
export const MAX_ATTACHMENT_MB = 10

// 設計師工作列表的「進行中」狀態（§2.5）
export const ACTIVE_STATUSES = ['assigned', 'in_progress', 'reviewing']
