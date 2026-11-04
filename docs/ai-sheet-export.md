# AI 專案管理資料表（Firestore → 私人 Google Sheet → ChatGPT）

每天台灣時間 **07:45**，Cloud Function `aiExportToSheet` 讀取 `requests`、`projects`（唯讀），去識別化並彙總後，寫入一份**私人** Google Sheet，讓 ChatGPT 透過已連接的 Google Drive 讀取，做進度、工作量、逾期風險分析。

- 不改 `firestore.rules`、前端、既有函式、`users` 結構；不新增任何 Firestore 集合；對 Firestore **零寫入**。
- 不使用服務帳戶金鑰；不開放「知道連結者可查看」；不使用公開 CSV。
- 第一階段名稱一律匿名（`AI_EXPORT_ANONYMIZE` 預設 `true`，只有明確設為 `false` 才會輸出真實名稱）。
- 第一階段**不匯出專案**（`AI_EXPORT_INCLUDE_PROJECTS` 預設 `false`）：`AI_Projects` 只有表頭，且函式完全不讀取 `projects`、`people` 集合。

## 檔案

| 檔案 | 用途 |
|---|---|
| `functions/aiExport.js` | 純函式：欄位白名單、HMAC 代號、口徑、彙總、風險候選、完整性檢查、PII 守門 |
| `functions/aiExportSource.js` | 唯讀讀取 Firestore（`select()` 只取白名單欄位；單一欄位查詢，不需新增索引） |
| `functions/aiExportSync.js` | 寫入 Sheets 的流程（commit marker、讀回驗證、失敗保護）、Sheets client |
| `functions/index.js` | 只新增 `aiExportToSheet` 排程函式與失敗通知（其餘不動） |
| `scripts/ai-export-synthetic.mjs` | 合成資料測試（預設 dry-run；`--write` 才寫測試 Sheet） |
| `scripts/ai-export-person-code.mjs` | 本機反查「某 email 的負責人代號」 |
| `functions/test/aiExport*.test.js`、`test/unit/aiExportConsistency.test.js` | 測試 |

## Sheet 分頁

| 分頁 | 內容 |
|---|---|
| `AI_README` | 口徑與使用說明（給 ChatGPT 與人類讀者） |
| `AI_Sync_Status` | `status`（OK / UPDATING / FAILED）、`dataTrusted`、`snapshotId`、`schemaVersion`、`lastAttemptAt`、`lastSuccessAt`、各分頁列數與 checksum、`errorClass` |
| `AI_Daily_Summary` | 需求總數、各狀態數、逾期、本週到期、無交期、各負責人工作量、風險前三候選 |
| `AI_Requests` | 每筆需求一列（去識別化） |
| `AI_Projects` | 秀展 / 設計專案（去識別化）。**第一階段停用**：只有表頭，README 與摘要會明示「沒有匯出 ≠ 沒有專案」 |

每個資料分頁第 1 列是 `#META`（`snapshotId`、`schemaVersion`、`generatedAt`、`bodyRows`），每筆資料列也帶 `snapshotId`。

## 計算口徑（與既有系統一致）

日期一律以台灣時間 `yyyy-mm-dd` 判斷。

| 項目 | 定義 | 與既有系統 |
|---|---|---|
| 範圍 | 開放中需求全部 + 近 90 天內結案 / 駁回 | 系統內歷史更久的結案不在表內，所以總數不等於歷史總數 |
| 狀態桶 | pending / assigned / in_progress / reviewing / completed / rejected，每筆只落一個，加總 = 總數 | — |
| 進行中 | assigned + in_progress | 與逾期提醒信監控範圍相同 |
| 逾期 | 進行中且 `dueDate < 今天`（交期當天不算） | 與 `findOverdueRequests`、前端 `overdueDays` 相同（有測試對照） |
| 本週到期 | 進行中且 今天 ≤ 交期 ≤ 本週日（週一至週日），與逾期互斥 | 新增指標 |
| 無交期 | 進行中且沒有（或格式錯誤的）交期 | 系統內不算逾期，這裡單獨計數 |
| 待審核 / 設計確認中已過交期 | **不算逾期**，單獨列為 `pastDueNotWatched` | 與系統一致（系統只監控已發稿、設計中） |
| 已駁回 | 只計入狀態數，不進個人工作量 | 系統內不算逾期、不算工作量 |
| 已結案 | 近 90 天內計入狀態數與個人「已結案」欄 | 系統內結案不算逾期 |
| 每人工作量 | 共同指派的需求每位各算一次 → 每人數字不可相加；總數看 COUNTS | 與逾期信的分組方式相同 |

風險候選是依固定加分規則排序的「候選」，不是結論（規則寫在表內 `RISK_NOTE`）。

## 匯出與不匯出

**匯出（白名單）**：需求代碼、匿名名稱、稿件類型、地區、是否急件、狀態、交期、各階段日期（只到「日」）、負責人代號、逾期欄位、是否自建。專案：專案代碼、匿名名稱、類型、狀態、起訖日、年度、負責人代號、階段。

**不匯出**：email、附件與下載連結、`shareToken`、`description`、`comment`、`reviewNote`、`rejectReason`、提交人 / 審核人、預算、地點、辦公室、備註、休假、外出、設計師姓名。

防護層次：① `select()` 在讀取時就只取白名單欄位 → ② 建表時只複製明列欄位 → ③ 最後一道 PII 守門（任何儲存格含 email 或網址就整份作廢）→ ④ 測試用「敏感哨兵字串」確認不會出現在任何分頁。

## 代號（HMAC，無對照表）

- 負責人：`D-xxxxxxxx`（設計師）、`P-xxxxxxxx`（Planner）。本體 = `HMAC-SHA256(密鑰, "person:" + 小寫 email)` 前 8 碼（32 bit；30 人以內碰撞機率約 1e-7，萬一碰撞同步會失敗並通知，不會悄悄合併兩個人）。需求與專案透過公司信箱對應到同一個人，代號一致。
- 需求 / 專案：`R-` / `J-` + 10 碼（`HMAC(密鑰, 類型:文件ID)`）。
- 沒有對照表存放在 Firestore、Sheet 或日誌。
- **長期穩定性**：代號只取決於「密鑰 + 小寫 email + 演算法/格式」。因此：
  - 密鑰不變、演算法不變 → 代號永遠不變（測試用 openssl 獨立算出的固定向量鎖住演算法，改動會讓測試失敗）。
  - **更換或遺失密鑰 → 所有代號改變**（等同重置，ChatGPT 的歷史對話與代號對不上）。請把密鑰存進密碼管理員，不要輕易輪替。
  - 某人更換登入 Gmail（人員管理的更換登入帳號）→ 該人視為新代號。
  - 某人角色改變 → 只有前綴字母（D/P）變，8 碼本體不變。
  - 代號格式若要調整，必須升 `SCHEMA_VERSION`，並同步告知 ChatGPT 端。
  - Firestore 文件 ID 不變 → 需求代號不變；刪除重建的需求會是新代號。
- 反查（只在本機）：`AI_EXPORT_HMAC_KEY='<密鑰>' node scripts/ai-export-person-code.mjs a@gmail.com`
- 密鑰放 Secret Manager（`AI_EXPORT_HMAC_KEY`），至少 16 字元，建議 48 字元以上；缺少或太短時同步直接失敗，不會用空密鑰產生可預測代號。

## Firestore IAM 最小權限

- 這支函式以專用服務帳戶 `ai-sheet-sync@team-scheduler-dc7ce.iam.gserviceaccount.com` 執行，**不使用**預設運算服務帳戶。
- 需要的專案層級角色：`roles/datastore.viewer`（只讀）、`roles/logging.logWriter`。兩個 secret（`AI_EXPORT_HMAC_KEY`、`SMTP_PASS`）的 `secretAccessor`：Firebase CLI 部署宣告了 secrets 的函式時會自動授予該函式的執行身分，**部署後仍請確認**。
- **無寫入權限**：Firestore 不給任何寫入角色，`aiExportMeta` 之類的集合不存在。
- 限制：Firestore 的 IAM 無法限制到「只能讀某幾個集合」。服務帳戶技術上能讀整個資料庫，「只讀 requests / projects / users / people」是由程式碼（`select()` 白名單）與測試保證，不是 IAM 保證。要更嚴格可建自訂角色（僅 `datastore.entities.get`、`datastore.entities.list`），但需要在實際環境驗證查詢是否仍成功，第一階段建議用 `datastore.viewer`。
- 第一階段實際讀取的集合：`requests`、`users`（用角色決定代號前綴；寄失敗通知時解析主管的通知信箱）。`projects`、`people` 在專案停用時**完全不讀**。這些資料只在記憶體中使用，不寫入 Sheet。

## 同步失敗時的資料版本保護（commit marker）

Sheets API 沒有跨分頁交易，所以不依賴「一次寫入就全成全敗」：

1. 讀上次狀態，做合理性檢查（來源 0 筆但上次有資料、或筆數驟降超過 50% 且上次 ≥ 10 筆 → 拒絕寫入並標 FAILED，資料分頁完全不動）。
2. 先把 `AI_Sync_Status` 寫成 `UPDATING`（`dataTrusted=false`，保留上次成功時間與筆數）。
3. 清除並重寫資料分頁。
4. **讀回**每個資料分頁，重算 checksum 並核對 `snapshotId`，必須完全一致。
5. 最後才把狀態寫成 `OK`（含 `lastSuccessAt`、各分頁列數與 checksum）。
6. 任一步失敗 → 盡力寫成 `FAILED`（`lastSuccessAt` 保持舊值）並寄通知給主管本人（只含時間與錯誤類別）。
7. 連 FAILED 都寫不進去（Sheets 整個壞掉）時，狀態停在 `UPDATING`，仍是不可信。

讀者（ChatGPT）只信任同時滿足以下條件的資料（`AI_README` 已寫明）：`status = OK`、各分頁 `#META` 的 `snapshotId` 與狀態相同、`schemaVersion` 一致、`lastSuccessAt` 距今不超過 26 小時。

**限制（請知悉）**：失敗時能保證的是「讀者不會誤信」，不是「昨天的資料還留著」。在步驟 3 之後才失敗的話，資料分頁可能是清空或新舊混合，只是被標示為不可信，沒有雙份備份。步驟 1 的合理性檢查失敗、來源讀取失敗、Sheets 暫時不可用（尚未動資料分頁）這幾種情況，資料分頁維持昨天內容、狀態標為 `FAILED`。若之後要「失敗時仍保留可用的昨天資料」，需要改成雙緩衝（寫到暫存分頁、驗證後再切換），第一階段未做。

## 排程與限制

- `45 7 * * *`（Asia/Taipei）；`maxInstances: 1`、`retryCount: 0`、逾時 180 秒。
- 讀取上限 6000 筆、需求 3000 列、專案 1000 列；超過就失敗並通知，不截斷。
- 預估：Firestore 讀取約 700–1900 次/日（免費額度 5 萬/日），函式 30 次/月，Sheets API 約 8 次/次。每月成本約 0 美元（假設為 Blaze 方案內的免費額度；正式資料量待確認）。

## 設定步驟（需要你操作；部署前）

### A. Google Cloud / Firebase Console

1. **確認 Blaze 方案**（Firebase Console → 左下角方案）。
2. **啟用 Google Sheets API**：Google Cloud Console → API 和服務 → 程式庫 → 搜尋「Google Sheets API」→ 啟用（專案 `team-scheduler-dc7ce`）。
3. **建立服務帳戶**：IAM 與管理 → 服務帳戶 → 建立，ID 填 `ai-sheet-sync`，名稱「AI Sheet Sync」。**不要建立金鑰**。
4. **授予角色**：IAM 與管理 → IAM → 新增主體 `ai-sheet-sync@team-scheduler-dc7ce.iam.gserviceaccount.com`，角色 `Cloud Datastore 檢視者`、`記錄寫入者`。
5. **讓部署者能指定此服務帳戶**：在該服務帳戶的「權限」分頁，授予你自己（部署者）`服務帳戶使用者`（`roles/iam.serviceAccountUser`）。若要用下方「本機模擬服務帳戶」測試，再授予你自己 `服務帳戶權杖建立者`（`roles/iam.serviceAccountTokenCreator`）。
6. **建立密鑰（HMAC）並存進 Secret Manager**（不要貼到聊天或文件）：
   ```bash
   node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
   firebase functions:secrets:set AI_EXPORT_HMAC_KEY
   ```
   在提示時貼上剛產生的字串。請另外安全保存（密碼管理員）；遺失只會讓代號重置，不影響系統。

### B. Google Sheets

1. 用你的 Google 帳戶建立**全新**空白 Sheet，名稱如「AI 專案管理資料表（測試）」。正式用的另建一份。
2. 右上「共用」：
   - 一般存取權維持「**受限**」（絕不要選「知道連結的任何人」）。
   - 新增 `ai-sheet-sync@team-scheduler-dc7ce.iam.gserviceaccount.com` 為「**編輯者**」，取消勾選「通知對方」。
   - 新增要讓 ChatGPT 讀取的 Google 帳戶為「**檢視者**」（建議是專用帳戶，只放這份 Sheet）。
   - 共用設定齒輪：取消「編輯者可以變更權限，以及與其他人共用」；若可選，取消「檢視者和加註者可選擇顯示下載、列印和複製選項」。
3. 從網址 `https://docs.google.com/spreadsheets/d/<這一段就是 Sheet ID>/edit` 取得 Sheet ID。分頁不用手動建，函式會自動建立。

### C. 本機（測試用）

用「模擬服務帳戶」登入（不產生金鑰檔，且會同時驗證服務帳戶的 Sheet 權限）：

```bash
gcloud auth application-default login --impersonate-service-account=ai-sheet-sync@team-scheduler-dc7ce.iam.gserviceaccount.com
```

## 測試順序

1. **單元 + 整合測試（不碰任何 Google 服務）**：`npm run test:rules`（含 emulator 整合）、`cd functions && npm test`、`npx vitest run test/unit/aiExportConsistency.test.js`。
2. **合成資料 dry-run**（只在本機）：`node scripts/ai-export-synthetic.mjs --out=<檔案>`。
3. **合成資料寫入「測試 Sheet」**（確認 Google Sheets 讀寫與權限、ChatGPT 讀取正常）：
   ```bash
   node scripts/ai-export-synthetic.mjs --write --sheet-id=<測試 Sheet ID>
   ```
   （預設不含專案；要測 `AI_Projects` 分頁的版面可加 `--with-projects`，仍是合成資料。）
   然後在 ChatGPT 連接 Drive，問它：「先檢查 AI_Sync_Status 與各分頁 snapshotId，再回報本週到期與逾期數」，核對數字與腳本輸出的 stats 相同。
4. **（核准後）部署函式、指向測試 Sheet、`AI_EXPORT_ANONYMIZE=true`**：驗證服務帳戶權杖能呼叫 Sheets API、排程能觸發、筆數與正式系統（需求總表）相符。
5. **（核准後）切換到正式 Sheet，仍維持匿名**，與正式系統核對逾期件數與各狀態數。
6. 名稱是否改為真實內容：另行評估，不屬於第一階段。

## 部署前檢查清單

- [ ] Blaze 方案確認；Sheets API 已啟用
- [ ] 服務帳戶 `ai-sheet-sync` 已建立、**沒有金鑰**，角色只有 Datastore 檢視者 + 記錄寫入者
- [ ] `AI_EXPORT_HMAC_KEY` 已存入 Secret Manager；Cloud Functions 的該函式執行身分有 `secretAccessor`（`AI_EXPORT_HMAC_KEY`、`SMTP_PASS`）
- [ ] `functions/.env.team-scheduler-dc7ce` 已設定 `AI_EXPORT_SHEET_ID=<測試 Sheet ID>`、`AI_EXPORT_ANONYMIZE=true`、`AI_EXPORT_INCLUDE_PROJECTS=false`（此檔已被 `.gitignore` 排除，不要 commit）
- [ ] Sheet 共用：一般存取「受限」；只有服務帳戶（編輯者）與指定檢視者；未開「知道連結者」
- [ ] 用未登入狀態開 `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv` 與 `.../gviz/tq?tqx=out:csv`，**必須要求登入或回 403**
- [ ] 用一個「沒被分享」的 Google 帳戶開 Sheet，**必須被擋**
- [ ] 公司對「專案 / 工作量資料交由 OpenAI 處理」的政策確認；ChatGPT 帳號資料控制已確認（是否用於改善模型）
- [ ] 合成資料測試通過；匿名正式資料與正式系統數字核對完
- [ ] 只部署這一支函式：`firebase deploy --only functions:aiExportToSheet`（不要順手 `--only functions` 全部重佈）
- [ ] 部署後確認 Cloud Scheduler 工作存在且為 07:45 Asia/Taipei；手動執行一次，檢查 `AI_Sync_Status = OK`

## 回滾 / 停用

- 暫停：Cloud Scheduler 暫停該工作，或 `firebase functions:delete aiExportToSheet`。
- 撤銷存取：Sheet 移除服務帳戶與檢視者；ChatGPT 中斷 Drive 連接。
- 不影響任何既有功能（沒有改動 Firestore 規則、資料或前端）。

## 建議貼進 ChatGPT 的使用說明

> 你可以讀取我 Google Drive 裡的「AI 專案管理資料表」。每次分析前，先讀 `AI_README` 與 `AI_Sync_Status`：`status` 必須是 OK，`snapshotId` 必須與 `AI_Daily_Summary`、`AI_Requests`、`AI_Projects` 第一列 `#META` 相同，`lastSuccessAt` 距今不超過 26 小時；任一項不符，請先告訴我「資料可能過期或不完整」，不要直接下結論。名稱與負責人都是代碼，請不要嘗試還原真實姓名。風險前三名只是候選，請說明你的判斷依據。
