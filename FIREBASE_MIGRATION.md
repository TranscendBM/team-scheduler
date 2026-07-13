# Firebase 移轉指南（舊帳號 → 新個人帳號）

舊專案：`team-scheduler-97c89`
目標：在**新的個人 Google 帳號**下建立新 Firebase 專案，搬遷所有 Firestore 資料，切換前端與通知設定。

---

## 你要手動做的部分（瀏覽器）

### A. 建立新 Firebase 專案
1. 用**新個人帳號**登入 https://console.firebase.google.com/
2. 「新增專案」→ 取名（例：`team-scheduler`）→ 記下自動產生的 **Project ID**（例：`team-scheduler-xxxx`）
3. Google Analytics 可以關閉（此專案用不到）

### B. 建立 Firestore
1. 左側「建構 → Firestore Database」→「建立資料庫」
2. 位置選 **asia-east1（台灣）** 或 asia-northeast1
3. 模式先選「以正式版模式啟動」（規則我們稍後用 `firestore.rules` 覆蓋）

### C. 註冊 Web App，拿到 config
1. 專案設定（齒輪）→「一般」→ 下方「你的應用程式」→ 點 **`</>`（Web）**
2. 取一個暱稱、註冊（不用勾 Hosting）
3. 複製 `firebaseConfig` 那段（apiKey / authDomain / projectId / storageBucket / messagingSenderId / appId）
4. **把這 6 個值貼回給我**

### D. 產生「新專案」的 Service Account 金鑰（給搬遷 + 通知用）
1. 專案設定 →「服務帳戶」→「產生新的私密金鑰」→ 下載 JSON
2. 檔案先存到本機（**不要放進 repo**），例如 `~/team-scheduler-new-sa.json`
3. **告訴我這個檔案的完整路徑**（內容不用貼出來）

### E. 拿到「舊專案」的 Service Account 金鑰（搬遷資料要用來讀舊資料）
1. 用**舊帳號**登入 Firebase 主控台 → 開 `team-scheduler-97c89`
2. 專案設定 →「服務帳戶」→「產生新的私密金鑰」→ 下載 JSON
3. 存到本機，例如 `~/team-scheduler-old-sa.json`
4. **告訴我完整路徑**
   > 若你沒有舊帳號的存取權，這步無法做 → 就無法自動搬資料，需另外想辦法（例如請舊帳號擁有者匯出）。

---

## 我會做的部分（你把上面資訊給我之後）

1. 把新 config 寫進本機 `.env`，更新 `.firebaserc` 的 project id
2. 跑搬遷腳本（先 `--dry-run` 給你看筆數，再實際搬）：
   ```
   OLD_SA=~/team-scheduler-old-sa.json NEW_SA=~/team-scheduler-new-sa.json \
     node scripts/migrate_firestore.mjs --dry-run
   ```
3. 用 `npx firebase deploy --only firestore:rules` 部署安全規則到新專案
4. 本機 `npm run dev` 驗證前端讀到的是新專案資料
5. 指示你更新 **GitHub Secrets**（Deploy 與每日通知都要換）：
   - `VITE_FIREBASE_*`（6 個，前端 build 用）
   - `FIREBASE_SERVICE_ACCOUNT`（新專案 SA JSON 內容，通知腳本用）
   - `FIREBASE_PROJECT_ID`（新 project id）
6. 觸發一次 deploy 驗證線上站台連到新專案

---

## 注意
- Service account JSON = 完整資料庫存取權，**外洩等於資料庫被接管**。已在 `.gitignore` 排除 `secrets/`、`*serviceAccount*.json`，請勿 commit。
- 舊專案資料在搬遷後仍會保留（搬遷是複製，不刪除），確認新站台正常後再考慮停用舊專案。
