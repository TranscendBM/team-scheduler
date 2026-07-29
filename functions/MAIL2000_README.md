# 透過創見 mail2000 寄信 — 整合說明

這份文件記錄了實際串接 `email.transcend-info.com`（Mail2000 V8.00）寄信時遇到的所有問題與解法。
內容已在正式環境（Firebase Cloud Functions, Node 22）驗證過。

**交辦時把整個資料夾給對方即可，`mailer.js` 可以直接使用。**

---

## 一、連線參數

| 項目 | 值 |
|---|---|
| SMTP 主機 | `email.transcend-info.com` |
| 連接埠 | **587**（STARTTLS） |
| 加密 | STARTTLS，**必須強制啟用** |
| 認證方式 | `AUTH LOGIN` |
| 帳號 | `elvis_cheng@transcend-info.com` |
| 寄件地址 | 同帳號 |

伺服器 EHLO 回應：

```
250-PIPELINING
250-8BITMIME
250-AUTH=LOGIN
250-AUTH LOGIN
250-STARTTLS
250 SIZE 536870912
```

---

## 二、四個必踩的坑

### 坑 1：不能用 port 25

IT 給的預設是 25，但：

- **在雲端跑必定失敗**。Google Cloud（含 Cloud Functions / Cloud Run / Compute Engine）
  預設封鎖所有對外部 IP 的 TCP port 25 egress，這是平台層限制，改程式沒用。
  AWS、Azure 也有類似限制或需申請解除。
- 25 通常是伺服器之間轉信用的，587 才是客戶端提交信件的標準埠。

**一律用 587。**

### 坑 2：TLS 憑證鏈不完整 ⚠️ 最容易誤判的一個

直接連線會得到：

```
Error: unable to verify the first certificate
```

**原因**：伺服器交握時只送出自己的憑證，沒有附上中介憑證，驗證方拼不出到根憑證的完整信任鏈。

**憑證本身是合法的**，不是自簽、也不是攻擊：

```
主體:   C=TW, O=創見資訊股份有限公司, CN=*.transcend-info.com
簽發者: Sectigo Public Server Authentication CA OV R36
效期:   2025-07-22 ~ 2026-08-22
```

**正確解法**：補上缺少的那張中介憑證（`sectigo-intermediate.pem`，本資料夾內附）。
其根憑證 `Sectigo Public Server Authentication Root R46` 已內建於 Node 的信任庫
（Node 22 實測確認存在），所以補中介憑證後即可完成完整驗證。

```js
tls: {
  servername: 'email.transcend-info.com',
  ca: [...require('tls').rootCertificates, intermediatePem],
}
```

> ### ❌ 不要用 `rejectUnauthorized: false`
>
> 網路上搜這個錯誤，九成的答案會叫你關掉憑證驗證。**不要照做。**
>
> `AUTH LOGIN` 是把帳號密碼用 base64 編碼後送出（base64 不是加密，可直接還原）。
> 關掉憑證驗證後，雖然連線仍有加密，但**無法確認對方是不是真的創見伺服器** ——
> 任何能做中間人的攻擊者都可以冒充伺服器並取得公司帳號密碼。
>
> 補中介憑證的做法完全沒有這個風險，而且一樣簡單。

### 坑 3：split-horizon DNS 會讓你誤判

同一個網域名稱，查詢來源不同會得到不同位址：

| 查詢來源 | 解析結果 |
|---|---|
| 公司內網 | `10.0.0.150`（私有位址） |
| 外部（含雲端） | `59.124.102.36`（對外位址） |

**在公司內網除錯時，看到 `10.x.x.x` 不代表外部連不到。** 要用外部 DNS 確認：

```bash
dig +short @8.8.8.8 email.transcend-info.com
```

### 坑 4：一次寄大量信會被伺服器阻擋

不要並發轟炸。使用連線池、循序寄送、每封之間留間隔（實測 0.4 秒穩定）。

---

## 三、其他已確認的事實

- **SPF 已涵蓋這台主機**：`v=spf1 ip4:59.124.102.34/27 ip4:220.128.205.242/27 ~all`
  從這台伺服器寄出的信會通過 SPF 驗證，不需要額外設定 DNS。
- **附件大小**：伺服器宣告 `SIZE 536870912`（512MB），但實務上收件方多半限制
  10MB 以內，超過容易被退信。
- **代理寄件（Send As）**：`press_center@transcend-info.com` 這類群組信箱沒有密碼、
  不能登入，但個人帳號若被 IT 授權，可以用自己的帳密認證、卻以群組地址寄出
  （認證身分與 From 標頭是兩件事）。**本程式不需要這個功能**，直接用
  `elvis_cheng@transcend-info.com` 認證並寄出即可。

---

## 四、密碼怎麼放

**絕對不要寫死在程式碼裡**，也不要進版控。依執行環境選一種：

| 環境 | 建議做法 |
|---|---|
| Google Cloud / Firebase | Secret Manager |
| AWS | Secrets Manager / Parameter Store |
| 自架伺服器 | 環境變數，或權限鎖死的設定檔 |
| 本機開發 | `.env` 且加入 `.gitignore` |

另外，**公司密碼每半年會強制更換**。請把密碼設計成「可以在不改程式碼、不重新部署的情況下更新」，
否則半年後會在沒人察覺的情況下寄信失敗。

---

## 五、使用方式

```bash
npm install nodemailer
```

```js
const { createMailer } = require('./mailer')

const mailer = createMailer({
  user: 'elvis_cheng@transcend-info.com',
  pass: process.env.SMTP_PASS,     // 不要寫死
})

// 建議：正式寄信前先驗證連線，錯誤訊息會被翻成看得懂的說明
const check = await mailer.verify()
if (!check.ok) throw new Error(check.message)

await mailer.send({
  to: 'someone@example.com',
  subject: '測試信',
  text: '純文字內容',
  html: '<p>HTML 內容</p>',
  attachments: [{ filename: 'a.pdf', content: buffer }],
})

await mailer.close()
```

批次寄送請用 `sendMany()`，它已內建間隔與逐筆結果回報：

```js
const results = await mailer.sendMany([
  { to: 'a@example.com', subject: '...', text: '...' },
  { to: 'b@example.com', subject: '...', text: '...' },
])
// [{ to, ok, error? }, ...]
```

---

## 六、疑難排解對照表

| 錯誤訊息 | 原因 | 解法 |
|---|---|---|
| `unable to verify the first certificate` | 憑證鏈不完整 | 補中介憑證（見坑 2） |
| `ETIMEDOUT` / 連線逾時 | 用了 port 25，或防火牆擋住 | 改用 587；確認來源 IP 可連外 |
| `ECONNREFUSED` | 主機或埠號錯誤 | 檢查參數 |
| `535` / `authentication failed` | 帳號密碼錯誤 | 確認密碼是否已過期 |
| `550` / `sender not allowed` | 寄件地址未被授權 | From 要與認證帳號一致，或請 IT 開代理寄件權限 |
| 大量寄送到一半失敗 | 被伺服器限流 | 加大間隔、降低並發 |

---

## 七、時效性提醒

**伺服器憑證 2026-08-22 到期。**

換發新憑證後：

- 若 IT 一併安裝了完整憑證鏈 → 本資料夾的中介憑證變成備援，留著無害
- 若換成其他 CA → 可能再次出現 `unable to verify the first certificate`，
  需要換上新的中介憑證。取得方式：

```bash
# 從伺服器憑證中找出中介憑證的下載網址
echo | openssl s_client -starttls smtp -connect email.transcend-info.com:587 \
  -servername email.transcend-info.com 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "CA Issuers"

# 下載並轉成 PEM
curl -sL "<上面查到的網址>" -o inter.crt
openssl x509 -inform DER -in inter.crt -out sectigo-intermediate.pem
```

---

*本文件整理自 2026-07-20 實際串接經驗，所有結論均經實測驗證。*
