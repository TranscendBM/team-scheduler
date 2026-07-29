/**
 * 創見 mail2000 寄信模組
 *
 * 已處理的環境問題（詳見 README.md）：
 *   - 使用 port 587 + STARTTLS（port 25 在雲端環境會被封鎖）
 *   - 補上伺服器缺少的中介憑證，維持完整 TLS 驗證
 *   - 連線池 + 循序寄送 + 間隔，避免被伺服器判定為濫發
 *
 * 依賴：npm install nodemailer
 */

const fs = require('node:fs')
const path = require('node:path')
const tls = require('node:tls')
const nodemailer = require('nodemailer')

const DEFAULTS = {
  host: 'email.transcend-info.com',
  port: 587,
  /** 批次寄送時每封之間的間隔（毫秒）。實測 400ms 穩定。 */
  intervalMs: 400,
}

/**
 * mail2000 交握時不送中介憑證，Node 因此拼不出信任鏈。
 * 補上這張憑證即可完整驗證，不需要（也不應該）關閉 rejectUnauthorized。
 */
function loadIntermediateCa() {
  try {
    return fs.readFileSync(
      path.join(__dirname, 'sectigo-intermediate.pem'),
      'utf8',
    )
  } catch {
    throw new Error(
      '找不到 sectigo-intermediate.pem，請確認它與 mailer.js 放在同一個資料夾。',
    )
  }
}

/** 把 SMTP 的原始錯誤翻成看得懂的說明，省下查錯時間。 */
function describeError(message) {
  const m = String(message || '').toLowerCase()
  if (m.includes('unable to verify') || m.includes('self signed')) {
    return `TLS 憑證鏈驗證失敗 —— 可能是伺服器換了憑證，需更新 sectigo-intermediate.pem（${message}）`
  }
  if (m.includes('535') || m.includes('auth') || m.includes('credentials')) {
    return `帳號或密碼錯誤，請確認密碼是否已過期（${message}）`
  }
  if (m.includes('timeout') || m.includes('etimedout')) {
    return `連線逾時 —— 確認是否誤用 port 25，或來源 IP 被防火牆阻擋（${message}）`
  }
  if (m.includes('econnrefused')) {
    return `伺服器拒絕連線，請檢查主機與連接埠（${message}）`
  }
  if (m.includes('550') || m.includes('sender') || m.includes('not allowed')) {
    return `伺服器拒絕這個寄件地址 —— From 必須與認證帳號一致，或請 IT 開放代理寄件權限（${message}）`
  }
  return message
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {object} options
 * @param {string} options.user  認證帳號，例如 elvis_cheng@transcend-info.com
 * @param {string} options.pass  密碼。請從環境變數或密鑰服務取得，不要寫死。
 * @param {string} [options.from]      寄件地址，預設同 user
 * @param {string} [options.fromName]  寄件人顯示名稱
 * @param {string} [options.replyTo]   回覆地址，預設同 from
 * @param {string} [options.host]
 * @param {number} [options.port]
 * @param {number} [options.intervalMs]
 */
function createMailer(options) {
  if (!options?.user || !options?.pass) {
    throw new Error('必須提供 user 與 pass。')
  }

  const cfg = { ...DEFAULTS, ...options }
  if (Number(cfg.port) === 25) {
    throw new Error(
      'port 25 在雲端環境會被封鎖（Google Cloud 等平台預設禁止對外 25 埠），請改用 587。',
    )
  }

  const from = cfg.from || cfg.user
  const replyTo = cfg.replyTo || from
  const secure = Number(cfg.port) === 465

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port),
    secure,
    // 沒有 TLS 的話，AUTH LOGIN 的帳密等同明文傳送
    requireTLS: !secure,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: {
      servername: cfg.host,
      ca: [...tls.rootCertificates, loadIntermediateCa()],
    },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  })

  function buildFrom() {
    return cfg.fromName ? `"${String(cfg.fromName).replace(/"/g, '')}" <${from}>` : from
  }

  return {
    /** 驗證連線與帳密。正式寄信前先跑一次，可以省下大量除錯時間。 */
    async verify() {
      try {
        await transporter.verify()
        return { ok: true, message: '連線與帳密驗證成功。' }
      } catch (err) {
        return { ok: false, message: describeError(err.message) }
      }
    },

    /** 寄一封信。失敗會 throw，訊息已翻譯過。 */
    async send(mail) {
      try {
        return await transporter.sendMail({
          from: buildFrom(),
          replyTo,
          ...mail,
        })
      } catch (err) {
        throw new Error(describeError(err.message))
      }
    },

    /**
     * 批次寄送。循序寄出並自動間隔，單封失敗不會中斷其他信件。
     * @returns {Promise<Array<{to: string, ok: boolean, error?: string}>>}
     */
    async sendMany(mails) {
      const results = []
      for (const mail of mails) {
        try {
          await transporter.sendMail({ from: buildFrom(), replyTo, ...mail })
          results.push({ to: mail.to, ok: true })
        } catch (err) {
          results.push({ to: mail.to, ok: false, error: describeError(err.message) })
        }
        await sleep(cfg.intervalMs)
      }
      return results
    },

    /** 用完記得關閉連線池。 */
    async close() {
      transporter.close()
    },
  }
}

module.exports = { createMailer, describeError }
