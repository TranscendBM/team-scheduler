// AI 資料表的「來源讀取」：只讀 Firestore(唯讀)，並用 select() 只取白名單欄位。
// db 由呼叫端傳入(正式環境是 Admin SDK 的 Firestore，測試是 emulator)，這個檔案不 import firebase。
//
// 所需 IAM：只要 Firestore 讀取(roles/datastore.viewer)，不需要任何寫入權限。
// 查詢都是「單一欄位」條件，不需要新增 Firestore 複合索引(不動 firestore.indexes.json)。
import { LIMITS, OPEN_STATUSES, RETENTION_DAYS, LimitError } from './aiExport.js'

const REQ_FIELDS = ['projectName', 'title', 'docTypes', 'region', 'urgent', 'status', 'dueDate', 'createdAt', 'reviewedAt',
  'startedAt', 'reviewingAt', 'completedAt', 'assignedDesigners', 'selfCreated']
const PROJECT_FIELDS = ['name', 'type', 'status', 'startDate', 'endDate', 'year', 'assignments']
const USER_FIELDS = ['role', 'active', 'notifyEmail']
const PEOPLE_FIELDS = ['role', 'email']

export async function collectSourceData(db, { now = new Date(), retentionDays = RETENTION_DAYS } = {}) {
  const cap = LIMITS.maxSourceReads + 1
  // 多抓 2 天當緩衝(時區與邊界)，精確的 90 天(台灣日期)由 buildSnapshot 再過濾一次
  const cutoff = new Date(now.getTime() - (retentionDays + 2) * 86400000)
  const reqCol = db.collection('requests')

  const [openSnap, doneSnap, rejectedSnap, projectSnap, userSnap, peopleSnap] = await Promise.all([
    reqCol.where('status', 'in', OPEN_STATUSES).select(...REQ_FIELDS).limit(cap).get(),
    reqCol.where('completedAt', '>=', cutoff).select(...REQ_FIELDS).limit(cap).get(),
    reqCol.where('status', '==', 'rejected').select(...REQ_FIELDS).limit(cap).get(),
    db.collection('projects').select(...PROJECT_FIELDS).limit(cap).get(),
    db.collection('users').select(...USER_FIELDS).limit(cap).get(),
    db.collection('people').select(...PEOPLE_FIELDS).limit(cap).get(),
  ])

  const reads = openSnap.size + doneSnap.size + rejectedSnap.size + projectSnap.size + userSnap.size + peopleSnap.size
  if (reads > LIMITS.maxSourceReads) throw new LimitError(`來源讀取筆數 ${reads} 超過上限 ${LIMITS.maxSourceReads}`)

  const reqById = new Map()
  for (const snap of [openSnap, doneSnap, rejectedSnap]) {
    for (const d of snap.docs) reqById.set(d.id, { id: d.id, ...d.data() })
  }
  return {
    reads,
    requests: [...reqById.values()],
    projects: projectSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    users: userSnap.docs.map((d) => ({ email: d.id, ...d.data() })),
    people: peopleSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  }
}
