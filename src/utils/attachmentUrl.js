// 附件 URL 的前端安全驗證 —— 邏輯跟 functions/index.js 的 parseAttachmentUrl/resolveAttachmentPath
// 完全對應(必須保持一致，任一邊改了 STORAGE_BUCKET 等常數都要同步改另一邊)。
//
// 為什麼前端也要驗證：Firestore Rules 只確認 url 是非空字串，storagePath 也不驗證是否對應這個
// request(見 firestore.rules isValidAttachment 的說明 —— 那項比對刻意交給 Cloud Function 做)。
// 使用者理論上可以直接在 Firestore 寫入任意 url/storagePath，前端如果不驗證就直接塞進
// <img src>/<iframe src>/<a href>/window.open()，就是 stored XSS／惡意導向(例如 javascript:、
// data: 內嵌 HTML、或指向別的 bucket／別筆需求附件的網址)。Cloud Function 端的驗證(previewFile)
// 保護的是「透過 previewFile 代理下載」這條路徑，不會保護前端直接讀 Firestore metadata 這條路徑，
// 兩邊都要驗證。

const STORAGE_BUCKET = 'team-scheduler-dc7ce.firebasestorage.app'
const STORAGE_HOST = 'firebasestorage.googleapis.com'
const FILENAME_RE = /^[A-Za-z0-9._-]{1,200}$/

// 只接受：https + 這個專案的 Firebase Storage host/bucket + 路徑在 attachments/ 底下的網址。
// 其餘一律回傳 null，包含 javascript:、data:、任意外部 https 網址、host/bucket 不符、malformed URL。
// 刻意不用 startsWith()/正則模糊比對整個網址 —— 用 URL API 把 protocol/hostname/pathname
// 拆開精確比對，避免「網址裡剛好包含 firebasestorage.googleapis.com 字樣」之類的繞過。
function parseAttachmentUrl(rawUrl) {
  let u
  try {
    u = new URL(String(rawUrl))
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.hostname !== STORAGE_HOST) return null
  const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/)
  if (!m) return null
  const [, bucket, encodedPath] = m
  if (bucket !== STORAGE_BUCKET) return null
  let path
  try {
    path = decodeURIComponent(encodedPath)
  } catch {
    return null
  }
  if (!path.startsWith('attachments/')) return null
  return { path, url: u.toString() }
}

// path 是否精確符合「這個 request 的附件」該有的格式：attachments/{requestId}/{安全檔名}。
// 刻意不用 startsWith('attachments/requestId')：那樣會誤放「attachments/{requestId}xxx/檔名」
// (前綴相同但其實是別的 requestId)，也不允許多一層子目錄(常見的 path traversal 手法)。
function isAttachmentPathForRequest(path, requestId) {
  if (!path || !requestId) return false
  const parts = path.split('/')
  return parts.length === 3 && parts[0] === 'attachments' && parts[1] === requestId && FILENAME_RE.test(parts[2])
}

// 核心驗證鏈，回傳這個附件「實際可以操作」(顯示連結、或刪除 Storage 物件)的 Storage 路徑；
// 驗證失敗一律回傳 null —— 呼叫端必須完全不載入、不開啟、不產生可點擊連結、不呼叫 deleteObject，
// 不能退而求其次顯示原始網址、部分渲染，或用寬鬆規則猜一個路徑出來刪。
//
// 驗證鏈(跟 functions/index.js 的 resolveAttachmentPath 完全對應)：
// 1) url 一定要先通過 parseAttachmentUrl(https/host/bucket/attachments 前綴)。
// 2) 如果 storagePath 存在，必須跟「從已驗證 URL 解出的路徑」完全相等 —— 不相等就是可疑組合
//    (合法網址搭配指向別的物件的 storagePath)，一律拒絕，不是「挑一個信任」。
// 3) 不管走哪條路徑，最終路徑都必須精確符合 attachments/{這個 requestId}/{檔名}：
//    - 舊附件沒有 storagePath 時，仍然只信任「已驗證 URL 解出的路徑」，且一樣要綁定目前 requestId
//      (不能因為沒有 storagePath 就跳過 requestId 檢查)。
//    - 有 storagePath 時，兩邊都要對得上目前 requestId。
//
// 用在「刪除」這種有副作用的操作時尤其重要：manager 能刪任何 request 的附件，如果單純信任
// attachment.storagePath 或用寬鬆的字串反推，等於讓 manager 端的 UI 有 confused-deputy 風險 ——
// 惡意或壞掉的資料可能讓 UI 對著 requestId A 卻刪到 storagePath 指向 requestId B 的物件。
export function resolveSafeAttachmentPath(attachment, requestId) {
  const parsed = parseAttachmentUrl(attachment?.url)
  if (!parsed) return null
  if (attachment?.storagePath !== undefined && attachment.storagePath !== parsed.path) return null
  if (!isAttachmentPathForRequest(parsed.path, requestId)) return null
  return parsed.path
}

// 給定一筆附件 metadata 跟它應該屬於的 requestId，回傳可以安全拿去 render(img src、iframe src、
// a href、window.open)的網址字串；驗證失敗一律回傳 null。建立在 resolveSafeAttachmentPath 之上，
// 兩者共用同一套驗證鏈，不會有「顯示的連結」跟「實際會被刪除的路徑」驗證標準不一致的情況。
export function getSafeAttachmentUrl(attachment, requestId) {
  const path = resolveSafeAttachmentPath(attachment, requestId)
  if (!path) return null
  return parseAttachmentUrl(attachment.url).url
}
