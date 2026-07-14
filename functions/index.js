import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import nodemailer from 'nodemailer'

initializeApp()
const db = getFirestore()

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

// 寄件身份（過渡方案：個人 Gmail + App Password）
const GMAIL_USER = 'tselvis814@gmail.com'
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD') // firebase functions:secrets:set 設定

const SITE = 'https://transcend-design.web.app'

function makeTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.value() },
  })
}

function buildHtml(r) {
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
       <td style="padding:8px 12px;color:#6b7280;width:32%;vertical-align:top">${k}</td>
       <td style="padding:8px 12px;font-weight:500;white-space:pre-wrap">${String(v).replace(/</g, '&lt;')}</td>
     </tr>`).join('')
  const atts = (r.attachments || [])
  const attHtml = atts.length
    ? `<div style="margin-top:16px">
         <p style="font-size:13px;color:#6b7280;margin:0 0 6px">附件</p>
         ${atts.map(a => `<a href="${a.url}" style="display:inline-block;margin:0 6px 6px 0;background:#f3f4f6;color:#374151;text-decoration:none;padding:6px 12px;border-radius:6px;font-size:12px">📄 ${String(a.name).replace(/</g, '&lt;')}</a>`).join('')}
       </div>`
    : ''
  return `
  <div style="font-family:sans-serif;color:#1f2937;max-width:560px;margin:auto;padding:24px">
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

// status 由 pending → assigned 時，寄信通知指派的設計師（CC 提交人 + 主管）
export const notifyOnAssign = onDocumentUpdated(
  { document: 'requests/{id}', region: 'asia-east1', secrets: [GMAIL_APP_PASSWORD] },
  async (event) => {
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    if (!before || !after) return
    if (!(before.status === 'pending' && after.status === 'assigned')) return
    const designers = after.assignedDesigners || []
    if (designers.length === 0) { logger.warn('無 assignedDesigners，略過'); return }

    const transporter = makeTransporter()
    // 收件人 / CC 都改用「公司通知信箱」（查不到才退回登入 email）
    const toEmails = await Promise.all(designers.map(resolveNotifyEmail))
    const submitterEmail = await resolveNotifyEmail(after.submittedBy)
    const managers = await getManagerEmails()
    const cc = [...new Set([submitterEmail, ...managers])].filter(e => e && !toEmails.includes(e))
    try {
      await transporter.sendMail({
        from: `Team Scheduler <${GMAIL_USER}>`,
        to: toEmails,
        cc,
        subject: `[設計需求] ${after.projectName || '新任務'}${after.urgent ? '（🔥急件）' : ''}`,
        html: buildHtml(after),
      })
      logger.info('已寄信', { to: toEmails, cc })
    } catch (e) {
      logger.error('寄信失敗', e)
      throw e
    }
  }
)

// status 由 pending → rejected 時，寄信通知提交人（CC 所有主管）
export const notifyOnReject = onDocumentUpdated(
  { document: 'requests/{id}', region: 'asia-east1', secrets: [GMAIL_APP_PASSWORD] },
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
    <div style="font-family:sans-serif;color:#1f2937;max-width:560px;margin:auto;padding:24px">
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:8px;margin-bottom:18px">
        <h2 style="margin:0 0 4px;font-size:17px">❌ 設計需求已駁回</h2>
        <p style="margin:0;color:#6b7280;font-size:13px">你提交的設計需求未通過審核</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #f0f0f0;border-radius:8px;overflow:hidden">
        <tr><td style="padding:8px 12px;color:#6b7280;width:32%">專案名稱</td><td style="padding:8px 12px;font-weight:500">${String(after.projectName || '').replace(/</g, '&lt;')}</td></tr>
        <tr style="background:#f9fafb"><td style="padding:8px 12px;color:#6b7280">地區</td><td style="padding:8px 12px">${after.region || ''}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b7280">駁回原因</td><td style="padding:8px 12px;color:#dc2626;font-weight:500;white-space:pre-wrap">${String(after.rejectReason || '（未填寫）').replace(/</g, '&lt;')}</td></tr>
      </table>
      <a href="${SITE}/#/my-requests" style="display:inline-block;margin-top:20px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">前往我的需求 →</a>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">此信由 Team Scheduler 於需求駁回時自動寄出。</p>
    </div>`

    try {
      await makeTransporter().sendMail({
        from: `Team Scheduler <${GMAIL_USER}>`,
        to: submitterEmail,
        cc,
        subject: `[設計需求駁回] ${after.projectName || ''}`,
        html,
      })
      logger.info('已寄駁回通知', { to: submitterEmail, cc })
    } catch (e) {
      logger.error('駁回通知寄信失敗', e)
      throw e
    }
  }
)
