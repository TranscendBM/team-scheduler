import { onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { createMailer } from './mailer.cjs'

const STORAGE_BUCKET = 'team-scheduler-dc7ce.firebasestorage.app'
initializeApp({ storageBucket: STORAGE_BUCKET })
const db = getFirestore()
const bucket = () => getStorage().bucket()

// 組出寄信用的 CC 名單：去重、拿掉空值、拿掉已經在收件人(to)裡的信箱(不必重複收兩次)。
// extraGroups 可以傳多組陣列(例如 [提交人], 主管清單, 主管另外勾選的 CC planner)，這裡統一攤平處理。
export function buildCcList(toEmails, ...extraGroups) {
  const merged = extraGroups.flat().filter(Boolean)
  return [...new Set(merged)].filter((e) => !toEmails.includes(e))
}

// 逸出 HTML 特殊字元(& < > " ')，所有插進郵件 HTML 的使用者資料都要先過這一層，避免任何欄位(專案名稱、備註、
// 檔名、地區…)被拿來注入標籤或跳脫既有屬性。順序很重要：一定要先跳脫 & ，否則後面產生的 &lt; 等實體會被重複跳脫成 &amp;lt;
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 共用的附件網址解析/驗證 —— 只有「https、host 是 Firebase Storage、bucket 是本專案、
// 路徑在 attachments/ 底下」的網址才算合法，其餘一律當作無效(null)。
// 這樣可以擋掉 javascript:、data:、或指向別的 bucket/路徑的偽造網址。
// 回傳 { path, url } 或 null；path 是解碼過的 Storage 路徑，url 是正規化過的網址字串。
// 不對外 export，外面一律透過下面兩個小函式取用，永遠不會有人對 malformed URL 直接 .match(...)[1] 而炸掉。
function parseAttachmentUrl(rawUrl) {
  let u
  try {
    u = new URL(String(rawUrl))
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.hostname !== 'firebasestorage.googleapis.com') return null
  const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/)
  if (!m) return null
  const [, bkt, encodedPath] = m
  if (bkt !== STORAGE_BUCKET) return null
  let path
  try { path = decodeURIComponent(encodedPath) } catch { return null }
  if (!path.startsWith('attachments/')) return null
  return { path, url: u.toString() }
}

// 郵件內容組 <a href> 用：合法就回傳正規化過的網址字串，不合法回傳 null(不產生連結)
export function safeAttachmentUrl(rawUrl) {
  const parsed = parseAttachmentUrl(rawUrl)
  return parsed ? parsed.url : null
}

// previewFile 用：合法就回傳解碼過的 Storage 路徑字串，不合法回傳 null
export function parseAttachmentStoragePath(rawUrl) {
  const parsed = parseAttachmentUrl(rawUrl)
  return parsed ? parsed.path : null
}

// 路徑是否精確符合「這個 request 的附件」該有的格式：attachments/{docId}/{安全檔名}。
// 刻意不用 startsWith('attachments/')：那樣會漏放「attachments/別的docId/檔名」這種指向別筆需求附件的路徑。
export function isAttachmentPathForRequest(path, docId) {
  if (!path || !docId) return false
  const parts = path.split('/')
  return parts.length === 3 && parts[0] === 'attachments' && parts[1] === docId && /^[A-Za-z0-9._-]{1,200}$/.test(parts[2])
}

// previewFile 的核心授權判斷，抽成純函式方便測試：回傳這個附件實際可以讀的 Storage 路徑，
// 或 null(代表應該回 403、不得讀 bucket)。規則：
// 1) a.url 一定要先通過 parseAttachmentStoragePath 驗證(https/host/bucket/attachments 前綴)。
// 2) 如果 a.storagePath 存在，必須跟「從已驗證 URL 解出的路徑」完全相等 —— 不相等就是可疑
//    (合法 token 的 URL 搭配指向別的物件的 storagePath)，一律拒絕，不是「挑一個信任」。
// 3) 不管走哪條路徑，最終路徑都必須精確符合 attachments/{docId}/{檔名}，其中 docId 是「這次要讀的 request」，
//    擋掉 storagePath 或 url 指向別筆需求附件的情況。
export function resolveAttachmentPath(attachment, docId) {
  const urlPath = parseAttachmentStoragePath(attachment?.url)
  if (!urlPath) return null
  if (attachment.storagePath !== undefined && attachment.storagePath !== urlPath) return null
  const path = attachment.storagePath !== undefined ? attachment.storagePath : urlPath
  if (!isAttachmentPathForRequest(path, docId)) return null
  return path
}

// previewFile 的 proxy 路徑帶的是「完整 download token 的前 12 碼」(見 src/components/Attachments.jsx
// 的 token.slice(0, 12))，不是完整 token —— 完整 token 不會出現在網址上，是要讓 Office 線上檢視器
// 抓資料時網址短一點。這裡的驗證必須是「完整 token 的前 12 碼」精確相等，不能用 startsWith：
// startsWith 允許呼叫端只送 1 個字元，只要那 1 個字元剛好對就會通過(公開 endpoint，攻擊者可以逐字元窮舉)。
const PREVIEW_TOKEN_LENGTH = 12
const PREVIEW_TOKEN_RE = new RegExp(`^[\\w-]{${PREVIEW_TOKEN_LENGTH}}$`)

// 用 URL/URLSearchParams 安全解析 Firebase Storage 下載網址裡的 token query 參數，
// 不對原始字串直接 regex 取值 —— URL 不合法或沒有 token 參數都回傳 null，不會噴錯。
export function extractDownloadToken(rawUrl) {
  let u
  try {
    u = new URL(String(rawUrl))
  } catch {
    return null
  }
  return u.searchParams.get('token')
}

// previewFile 路徑裡帶的 proxy token(providedPrefix)是否確實是 fullToken 的前 12 碼。
// providedPrefix 本身也必須「剛好」是 12 個合法字元 —— 短於或長於 12 碼一律拒絕，
// 不接受任何長度的 prefix 比對，避免猜 1 個字元就矇過去。
export function isValidPreviewToken(fullToken, providedPrefix) {
  if (typeof fullToken !== 'string' || typeof providedPrefix !== 'string') return false
  if (!PREVIEW_TOKEN_RE.test(providedPrefix)) return false
  if (fullToken.length < PREVIEW_TOKEN_LENGTH) return false
  return fullToken.slice(0, PREVIEW_TOKEN_LENGTH) === providedPrefix
}

// 依登入 email 查該使用者的公司通知信箱；沒設定就退回原本的登入 email
async function resolveNotifyEmail(loginEmail) {
  if (!loginEmail) return ''
  try {
    const snap = await db.collection('users').doc(loginEmail.toLowerCase()).get()
    const notify = snap.exists ? (snap.data().notifyEmail || '').trim() : ''
    return notify || loginEmail
  } catch (e) {
    logger.warn('查通知信箱失敗，退回登入 email', { loginEmail, e: e.message })
    return loginEmail
  }
}

// 所有「主管」的通知信箱（動態抓 users collection，不寫死）
async function getManagerEmails() {
  try {
    const snap = await db.collection('users').where('role', '==', 'manager').get()
    return snap.docs
      .map(d => d.data())
      .filter(u => u.active !== false)
      .map(u => (u.notifyEmail || u.email || '').trim().toLowerCase())
      .filter(Boolean)
  } catch (e) {
    logger.warn('查主管名單失敗', e.message)
    return []
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Firestore 批次上限是 500 筆寫入，這裡保守抓 400 筆一批，安全分批 commit
const RENAME_BATCH_SIZE = 400

// 把某個 query 命中的 requests 逐批(每批 ≤ RENAME_BATCH_SIZE)套用 patch 並 commit，回傳受影響筆數。
// 每一批各自是原子的 batch commit；query 本身是冪等的(欄位已經改過的文件不會再被撈到)，
// 所以就算中途失敗，之後重打一次同樣的 query 只會處理「還沒改到」的文件，不會重複處理或漏掉。
async function migrateRequestsBatch(query, applyPatch) {
  const snap = await query.get()
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += RENAME_BATCH_SIZE) {
    const chunk = docs.slice(i, i + RENAME_BATCH_SIZE)
    const batch = query.firestore.batch() // 用 query 所屬的 firestore 實例(測試時才會是 emulator，而不是正式專案)
    for (const d of chunk) batch.update(d.ref, applyPatch(d))
    await batch.commit()
  }
  return docs.length
}

// 用一個 transaction 原子地「搶」下這組 oldEmail→newEmail 搬遷：
// - userRenameOperations/{oldEmail} 是這組操作的 durable 紀錄(doc id 就是 oldEmail 本身)，
//   兩個「同一個 oldEmail、不同 newEmail」的並行請求會搶著讀寫同一份 opRef，
//   Firestore transaction 的樂觀鎖會讓其中一個 commit 失敗並自動重試，
//   重試時重新讀到 opRef 已經被對方寫入不同的 newEmail，就能正確擋下第二個。
// - 兩個「不同 oldEmail、同一個 newEmail」的並行請求會搶著讀寫同一個 newRef，
//   一樣靠 transaction 的樂觀鎖天然序列化，輸的那個重試時會看到 newRef 已存在且 renamedFrom 不是自己，
//   正確回報 already-exists。
// 回傳 phase：'not-found'(oldEmail 不存在，且沒有任何操作紀錄可佐證 newEmail 跟它有關)、
//            'completed'(這組操作先前已經完整跑完，可以冪等回報成功)、
//            'pending'(剛搶到、或是接續先前中斷在「搬 requests」到「收尾」之間的操作)。
async function reserveRename(firestoreDb, oldEmail, newEmail) {
  const oldRef = firestoreDb.collection('users').doc(oldEmail)
  const newRef = firestoreDb.collection('users').doc(newEmail)
  const opRef = firestoreDb.collection('userRenameOperations').doc(oldEmail)

  return firestoreDb.runTransaction(async (tx) => {
    const [oldSnap, newSnap, opSnap] = await Promise.all([tx.get(oldRef), tx.get(newRef), tx.get(opRef)])

    if (opSnap.exists) {
      const op = opSnap.data()
      if (op.newEmail !== newEmail) {
        // 同一個 oldEmail 已經有另一組目標信箱不同的搬遷紀錄(不論完成與否)，不能再啟動一個不同目標的搬遷，
        // 否則會產生「這個舊帳號同時被搬去兩個新帳號」的分裂資料
        throw new HttpsError(
          'failed-precondition',
          `這個帳號已經有另一筆改名操作(目標信箱：${op.newEmail})，請先確認該筆操作的狀態，不能同時搬去不同的新信箱`
        )
      }
      // op.newEmail === newEmail：同一組操作的重複呼叫(可能是重試、也可能是先前呼叫已經完成)，
      // 冪等地依 op.status 回報，不重新建立/覆蓋任何東西
      return { phase: op.status === 'completed' ? 'completed' : 'pending' }
    }

    // 沒有既有操作紀錄:這是第一次呼叫，這裡是唯一「決定誰搶到這組 oldEmail+newEmail」的地方
    if (!oldSnap.exists) {
      // 沒有操作紀錄可以佐證「就算 newEmail 存在」是這次搬遷的產物，不能無條件當作已完成
      return { phase: 'not-found' }
    }

    if (newSnap.exists) {
      if (newSnap.data().renamedFrom === oldEmail) {
        // 新帳號已經存在且標記確實吻合這組搬遷，但操作紀錄不見了 —— 正常情況下兩者同一個 transaction
        // 寫入不會分開，這裡當防禦性續傳，順便補回操作紀錄
        tx.set(opRef, { oldEmail, newEmail, status: 'pending', createdAt: FieldValue.serverTimestamp() })
        return { phase: 'pending' }
      }
      throw new HttpsError('already-exists', '新的登入信箱已經被其他帳號使用')
    }

    tx.set(opRef, { oldEmail, newEmail, status: 'pending', createdAt: FieldValue.serverTimestamp() })
    tx.set(newRef, { ...oldSnap.data(), email: newEmail, renamedFrom: oldEmail })
    return { phase: 'pending' }
  })
}

// 核心邏輯抽成獨立、不綁定 onCall 的函式，方便直接餵 Firestore emulator 做整合測試
// (見 functions/test/renameUserLogin.test.js)，不需要另外啟動 Functions emulator。
// db 用參數傳入(而非直接用外層的 db)，就是為了讓測試可以指向 emulator 而不是正式專案。
//
// 主管把某位成員的登入 Gmail 從 oldEmail 改成 newEmail：
// 1) reserveRename() 用 transaction 原子地建立 users/{newEmail}(標記 renamedFrom)
//    + userRenameOperations/{oldEmail}(durable 操作紀錄，status: pending) —— 這一步也負責擋掉並行衝突
// 2) 分批把 requests.assignedDesigners / requests.submittedBy 裡的 oldEmail 換成 newEmail
// 3) 一個原子 batch 同時做完:清掉 newRef 的 renamedFrom 標記、把操作紀錄標成 completed、刪 users/{oldEmail}。
//    三件事同一個 batch，要嘛全部生效、要嘛完全不生效，不會出現「舊帳號已刪但操作紀錄還沒標完成」的中間態。
// 若中途失敗，重新呼叫同樣的參數即可安全接續(reserveRename 會依 durable 的操作紀錄正確判斷該從哪裡繼續)。
export async function renameUserLoginCore(firestoreDb, callerEmail, data) {
  if (!callerEmail) throw new HttpsError('unauthenticated', '請先登入')

  const callerSnap = await firestoreDb.collection('users').doc(callerEmail).get()
  const callerData = callerSnap.exists ? callerSnap.data() : null
  if (!callerData || callerData.role !== 'manager' || callerData.active === false) {
    throw new HttpsError('permission-denied', '只有啟用中的主管可以執行這個操作')
  }

  const oldEmail = String(data?.oldEmail || '').trim().toLowerCase()
  const newEmail = String(data?.newEmail || '').trim().toLowerCase()
  if (!EMAIL_RE.test(oldEmail) || !EMAIL_RE.test(newEmail)) {
    throw new HttpsError('invalid-argument', 'email 格式不正確')
  }
  if (oldEmail === newEmail) {
    throw new HttpsError('invalid-argument', '新舊登入信箱相同')
  }

  const { phase } = await reserveRename(firestoreDb, oldEmail, newEmail)

  if (phase === 'not-found') {
    throw new HttpsError('not-found', '找不到原本的登入帳號')
  }
  if (phase === 'completed') {
    return { newEmail, migratedAsDesigner: 0, migratedAsSubmitter: 0, alreadyDone: true }
  }

  // phase === 'pending'：剛搶到，或是接續先前中斷的搬遷
  const oldRef = firestoreDb.collection('users').doc(oldEmail)
  const newRef = firestoreDb.collection('users').doc(newEmail)
  const opRef = firestoreDb.collection('userRenameOperations').doc(oldEmail)

  // requests.assignedDesignersNames 是跟 assignedDesigners 同 index 的顯示名稱陣列，
  // 這裡只是原地替換 email 字串值、不改變陣列長度或順序，所以不需要另外同步
  const migratedAsDesigner = await migrateRequestsBatch(
    firestoreDb.collection('requests').where('assignedDesigners', 'array-contains', oldEmail),
    (d) => ({ assignedDesigners: (d.data().assignedDesigners || []).map((e) => (e === oldEmail ? newEmail : e)) })
  )
  const migratedAsSubmitter = await migrateRequestsBatch(
    firestoreDb.collection('requests').where('submittedBy', '==', oldEmail),
    () => ({ submittedBy: newEmail })
  )

  // 收尾一次原子 batch:清掉 renamedFrom、標記操作完成、刪舊帳號 —— 三件事同時成功或同時不生效
  const finalBatch = firestoreDb.batch()
  finalBatch.update(newRef, { renamedFrom: FieldValue.delete() })
  finalBatch.set(opRef, { oldEmail, newEmail, status: 'completed', completedAt: FieldValue.serverTimestamp() }, { merge: true })
  finalBatch.delete(oldRef)
  await finalBatch.commit()

  logger.info('已完成登入信箱搬遷', { oldEmail, newEmail, migratedAsDesigner, migratedAsSubmitter })
  return { newEmail, migratedAsDesigner, migratedAsSubmitter }
}

export const renameUserLogin = onCall({ region: 'asia-east1' }, async (request) => {
  const callerEmail = (request.auth?.token?.email || '').trim().toLowerCase()
  return renameUserLoginCore(db, callerEmail, request.data)
})

// 寄件身份：改用公司 mail2000 信箱（email.transcend-info.com），不再用個人 Gmail 過渡方案。
// 用公司網域寄信對公司內部收件者而言天生比外部 Gmail 更不容易被判 spam
// （SPF 已涵蓋這台主機，詳見 MAIL2000_README.md）。
// 連線細節（port 587 STARTTLS、中介憑證、限速）全部封裝在 mailer.cjs，不要重新試錯。
const SMTP_USER = 'elvis_cheng@transcend-info.com'
const SMTP_PASS = defineSecret('SMTP_PASS') // firebase functions:secrets:set SMTP_PASS 設定，半年會過期需更新

const SITE = 'https://transcend-design.web.app'

// 每次呼叫建立新的 mailer（pool 連線交給 mailer.cjs 內部管理，用完呼叫 .close()）
function getMailer() {
  return createMailer({ user: SMTP_USER, pass: SMTP_PASS.value(), fromName: 'Team Scheduler' })
}

// export 供 test/buildHtml.test.js 做純函式測試（不連任何 Firebase 服務）
export function buildHtml(r) {
  const docTypes = (r.docTypes || []).join('、')
  const rows = [
    ['專案名稱', r.projectName || r.title || ''],
    ['地區', r.region || ''],
    ['稿件類型', docTypes],
    ['交期', r.dueDate || '未指定'],
    ['急件', r.urgent ? '🔥 是' : '否'],
    ['需求簡述', r.description || '（無）'],
    ['審核備註', r.reviewNote || '（無）'],
    ['注意事項', r.comment || '（無）'],
    ['提交人', r.submittedByName || r.submittedBy || ''],
  ]
  const tr = rows.map(([k, v], i) =>
    `<tr style="background:${i % 2 ? '#f9fafb' : '#fff'}">
       <td style="padding:8px 12px;color:#6b7280;width:32%;vertical-align:top">${escapeHtml(k)}</td>
       <td style="padding:8px 12px;font-weight:500;white-space:pre-wrap">${escapeHtml(v)}</td>
     </tr>`).join('')
  const atts = (r.attachments || [])
  const attHtml = atts.length
    ? `<div style="margin-top:16px">
         <p style="font-size:13px;color:#6b7280;margin:0 0 6px">附件</p>
         ${atts.map(a => {
           const label = `📄 ${escapeHtml(a.name)}`
           const safeUrl = safeAttachmentUrl(a.url)
           return safeUrl
             ? `<a href="${escapeHtml(safeUrl)}" style="display:inline-block;margin:0 6px 6px 0;background:#f3f4f6;color:#374151;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:12px">${label}</a>`
             : `<span style="display:inline-block;margin:0 6px 6px 0;background:#f3f4f6;color:#9ca3af;padding:6px 12px;border-radius:6px;font-size:12px">${label}（連結無效）</span>`
         }).join('')}
       </div>`
    : ''
  return `
  <div style="font-family:'Microsoft JhengHei','微軟正黑體','PingFang TC','Heiti TC',sans-serif;color:#1f2937;max-width:560px;margin:auto;padding:24px">
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:14px 18px;border-radius:8px;margin-bottom:18px">
      <h2 style="margin:0 0 4px;font-size:17px">📌 新設計任務已發稿</h2>
      <p style="margin:0;color:#6b7280;font-size:13px">你被指派了一項設計需求，詳情如下</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #f0f0f0;border-radius:8px;overflow:hidden">${tr}</table>
    ${attHtml}
    <a href="${SITE}/#/requests" style="display:inline-block;margin-top:20px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">前往需求總表 →</a>
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">此信由 Team Scheduler 於需求核准發稿時自動寄出。</p>
  </div>`
}

// status 由 pending → assigned 時，寄信通知指派的設計師（CC 提交人 + 主管 + 主管核准時另外勾選的 planner）
export const notifyOnAssign = onDocumentUpdated(
  { document: 'requests/{id}', region: 'asia-east1', secrets: [SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after) return
    if (!(before.status === 'pending' && after.status === 'assigned')) return
    const designers = after.assignedDesigners || []
    if (designers.length === 0) { logger.warn('無 assignedDesigners，略過'); return }

    const mailer = getMailer()
    // 收件人 / CC 都改用「公司通知信箱」（查不到才退回登入 email）
    const toEmails = await Promise.all(designers.map(resolveNotifyEmail))
    const submitterEmail = await resolveNotifyEmail(after.submittedBy)
    const managers = await getManagerEmails()
    const ccPlanners = await Promise.all((after.ccPlanners || []).map(resolveNotifyEmail))
    const cc = buildCcList(toEmails, [submitterEmail], managers, ccPlanners)
    try {
      await mailer.send({
        to: toEmails,
        cc,
        subject: `[設計需求] ${after.projectName || '新任務'}${after.urgent ? '（🔥急件）' : ''}`,
        html: buildHtml(after),
      })
      logger.info('已寄信', { to: toEmails, cc })
    } catch (e) {
      logger.error('寄信失敗', e)
      throw e
    } finally {
      await mailer.close()
    }
  }
)

// 已發稿後主管「編輯指派」新增設計師時，寄信通知「新加入」的設計師（CC 提交人 + 主管 + 勾選的 planner）
export const notifyOnReassign = onDocumentUpdated(
  { document: 'requests/{id}', region: 'asia-east1', secrets: [SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after) return
    // 初次核准(pending→assigned)由 notifyOnAssign 處理，這裡只管「已審核後」的名單變動
    if (before.status === 'pending' || after.status === 'rejected') return
    const prev = before.assignedDesigners || []
    const cur = after.assignedDesigners || []
    const added = cur.filter(e => !prev.includes(e))
    if (added.length === 0) return

    const toEmails = await Promise.all(added.map(resolveNotifyEmail))
    const submitterEmail = await resolveNotifyEmail(after.submittedBy)
    const managers = await getManagerEmails()
    const ccPlanners = await Promise.all((after.ccPlanners || []).map(resolveNotifyEmail))
    const cc = buildCcList(toEmails, [submitterEmail], managers, ccPlanners)
    const mailer = getMailer()
    try {
      await mailer.send({
        to: toEmails,
        cc,
        subject: `[設計需求] ${after.projectName || '任務'}${after.urgent ? '（🔥急件）' : ''}（新增指派）`,
        html: buildHtml(after),
      })
      logger.info('已寄新增指派通知', { to: toEmails, cc })
    } catch (e) {
      logger.error('新增指派通知寄信失敗', e)
      throw e
    } finally {
      await mailer.close()
    }
  }
)

// status 由 pending → rejected 時，寄信通知提交人（CC 所有主管）
export const notifyOnReject = onDocumentUpdated(
  { document: 'requests/{id}', region: 'asia-east1', secrets: [SMTP_PASS] },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after) return
    if (!(before.status === 'pending' && after.status === 'rejected')) return

    const submitterEmail = await resolveNotifyEmail(after.submittedBy)
    if (!submitterEmail) { logger.warn('無提交人信箱，略過'); return }
    const managers = await getManagerEmails()
    const cc = [...new Set(managers)].filter(e => e && e !== submitterEmail)

    const html = `
    <div style="font-family:'Microsoft JhengHei','微軟正黑體','PingFang TC','Heiti TC',sans-serif;color:#1f2937;max-width:560px;margin:auto;padding:24px">
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:8px;margin-bottom:18px">
        <h2 style="margin:0 0 4px;font-size:17px">❌ 設計需求已駁回</h2>
        <p style="margin:0;color:#6b7280;font-size:13px">你提交的設計需求未通過審核</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #f0f0f0;border-radius:8px;overflow:hidden">
        <tr><td style="padding:8px 12px;color:#6b7280;width:32%">專案名稱</td><td style="padding:8px 12px;font-weight:500">${escapeHtml(after.projectName)}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#6b7280">地區</td><td style="padding:8px 12px">${escapeHtml(after.region)}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b7280">駁回原因</td><td style="padding:8px 12px;color:#dc2626;font-weight:500;white-space:pre-wrap">${escapeHtml(after.rejectReason || '（未填寫）')}</td></tr>
      </table>
      <a href="${SITE}/#/my-requests" style="display:inline-block;margin-top:20px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">前往我的需求 →</a>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">此信由 Team Scheduler 於需求駁回時自動寄出。</p>
    </div>`

    const mailer = getMailer()
    try {
      await mailer.send({
        to: submitterEmail,
        cc,
        subject: `[設計需求駁回] ${after.projectName || ''}`,
        html,
      })
      logger.info('已寄駁回通知', { to: submitterEmail, cc })
    } catch (e) {
      logger.error('駁回通知寄信失敗', e)
      throw e
    } finally {
      await mailer.close()
    }
  }
)

// 需求文件被刪除時,同步刪除該需求的所有附件檔案
export const cleanupOnDelete = onDocumentDeleted(
  { document: 'requests/{id}', region: 'asia-east1' },
  async (event) => {
    const id = event.params.id
    try {
      await bucket().deleteFiles({ prefix: `attachments/${id}/` })
      logger.info('已刪除附件資料夾', { id })
    } catch (e) {
      logger.error('刪除附件失敗', { id, e: e.message })
    }
  }
)

// 每天 03:00(台灣時間)清理「結案超過 30 天」的需求附件(需求紀錄保留,只刪檔案)
export const cleanupOldAttachments = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Asia/Taipei', region: 'asia-east1' },
  async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const snap = await db.collection('requests').where('completedAt', '<=', cutoff).get()
    let cleaned = 0
    for (const d of snap.docs) {
      const x = d.data()
      if (x.status !== 'completed') continue
      if (!x.attachments || x.attachments.length === 0) continue
      try {
        await bucket().deleteFiles({ prefix: `attachments/${d.id}/` })
        await d.ref.update({ attachments: [], attachmentsPurgedAt: new Date() })
        cleaned++
        logger.info('已清理結案附件', { id: d.id, projectName: x.projectName })
      } catch (e) {
        logger.error('清理附件失敗', { id: d.id, e: e.message })
      }
    }
    logger.info(`附件清理完成:${cleaned} 筆`)
  }
)

// 附件預覽代理:提供「無 %-編碼」的乾淨網址給 Office 線上檢視器
// (Firebase 下載連結路徑含 %2F,Office viewer 會 file not found)
// 路徑格式:/previewFile/{docId}/{附件index}/{token前12碼} — 逐檔驗證,非公開整個 bucket
export const previewFile = onRequest(
  { region: 'asia-east1' },
  async (req, res) => {
    try {
      const [docId, idxStr, tok] = req.path.split('/').filter(Boolean)
      if (!docId || !idxStr || !tok) return res.status(400).send('bad request')
      // 這是公開 endpoint，先擋掉格式不對的 proxy token(不是剛好 12 個合法字元)，
      // 不接受任何長度的 prefix，避免逐字元窮舉猜出完整 token
      if (!PREVIEW_TOKEN_RE.test(tok)) return res.status(403).send('forbidden')

      const snap = await db.collection('requests').doc(docId).get()
      if (!snap.exists) return res.status(404).send('not found')
      const a = (snap.data().attachments || [])[Number(idxStr)]
      if (!a) return res.status(404).send('not found')

      // extractDownloadToken 用 URL/URLSearchParams 安全解析，malformed URL 或缺少 token 都回傳 null，
      // isValidPreviewToken 要求「完整 token 的前 12 碼」跟 tok 精確相等(不是 startsWith 前綴比對)
      const fullToken = extractDownloadToken(a.url)
      if (!isValidPreviewToken(fullToken, tok)) return res.status(403).send('forbidden')

      // 不能只信任 Firestore 存的 storagePath 字串(規則只驗證它是字串，沒驗證真的對應這個 request 的哪個檔案)，
      // 也不能對 url 直接 regex 取值後不檢查就用(malformed URL 會讓 [1] 對 undefined 取值而 500)。
      // resolveAttachmentPath 統一處理:先驗證 url 合法、storagePath(如果有)要跟 url 解出的路徑完全一致、
      // 最終路徑要精確符合 attachments/{這個 docId}/{檔名} —— 任何一關不過就直接 403，不讀 bucket。
      const path = resolveAttachmentPath(a, docId)
      if (!path) return res.status(403).send('forbidden')
      const file = bucket().file(path)
      const [exists] = await file.exists()
      if (!exists) return res.status(404).send('file gone')
      const [meta] = await file.getMetadata()
      res.set('Content-Type', meta.contentType || 'application/octet-stream')
      res.set('Cache-Control', 'public, max-age=300')
      file.createReadStream().pipe(res)
    } catch (e) {
      logger.error('previewFile 失敗', e.message)
      res.status(500).send('error')
    }
  }
)

// 每天 02:00(台灣時間)抓一次美金匯率(frankfurter.dev,免費、不需金鑰、採歐洲央行公告匯率)
// 寫入 settings/exchangeRates,前端秀展編輯視窗用來「建議換算」,不會自動覆蓋既有預算數字
export const updateExchangeRates = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'Asia/Taipei', region: 'asia-east1' },
  async () => {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD')
    if (!res.ok) throw new Error(`frankfurter.dev 回應失敗:${res.status}`)
    const data = await res.json()
    await db.collection('settings').doc('exchangeRates').set({
      base: 'USD',
      rates: data.rates,
      date: data.date,
      updatedAt: new Date().toISOString(),
    })
    logger.info('匯率更新完成', { date: data.date })
  }
)
