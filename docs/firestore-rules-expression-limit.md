# Firestore Rules 1000-expression 上限：最小重現與結論

背景：`firestore.rules` 的 `requests/{id}` 文件模型（附件陣列最多 10 筆、每筆展開驗證，
`ccPlanners` 同樣展開驗證，加上 manager/designer/planner 的狀態機）在 CI 上曾經讓部分
**負向測試**（`assertFails`）因為 Firestore Emulator 的
`Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached`
而被拒 —— 這是 false positive：因為求值超限被拒，不是因為真的觸發了規則要擋的那個條件。

本文件記錄用真實本機 Firestore Emulator（非猜測）做的最小重現，結論、工具版本、以及
「哪些理論被推翻、哪個理論成立」。可執行的重現只保留兩個關鍵 fixture（見下方「可執行重現」），
不含當初排查用的完整 17 個變體矩陣 —— 若需要完整矩陣可依下方「範例規則」重建。

## 工具版本

- node v24.18.0 / npm 11.16.0 / firebase-tools 15.25.0
- Firestore Emulator：`cloud-firestore-emulator-v1.22.0.jar`（standard edition）
- Storage rules runtime：`cloud-storage-rules-runtime-v1.1.3.jar`
- Java：Temurin 21.0.12+8

所有測試都在 `demo-team-scheduler-rules`（Firebase 保留的 emulator-only 專案 id 前綴）上
執行，每個變體都是全新一次 `firebase emulators:exec` process（自動起新 emulator、測完自動
關閉），彼此不共用任何狀態、不共用 coverage cache。

## 這份文件裡，什麼是官方規格、什麼是實驗觀察、什麼是推論

Firebase 官方文件明確記載的只有一件事：**單次請求最多評估 1,000 個運算式**
（"maximum number of expressions evaluated per request = 1,000"）。官方文件**沒有**
記載這個上限的計算範圍是「整個 request」、「單一 `match` 區塊」還是「單一 `allow` 子句」——
這是實作細節，不是公開語意保證。

以下區分本文件的每一個結論屬於哪一類：

- **官方明確規格**：單次請求最多 1,000 個運算式；同一路徑多個重疊 `match`/`allow` 用 OR
  合併判斷結果。
- **Emulator v1.22.0 的實驗觀察**（下面 M/N/O、L0-L4 的測試結果）：在本機 Firestore
  Emulator v1.22.0 上，每個 `allow` 子句各自獨立回報 expression-limit 錯誤，errors 訊息
  分別標註 `for 'create'`/`for 'update'` 且各自獨立達到/沒達到上限——這是**觀察到的行為**，
  不是 Firebase 官方保證的正式語意。
- **尚未在正式環境驗證、不能直接推論到正式 Firestore 的部分**：Emulator 是否在這件事上
  跟正式 Firestore 完全一致，沒有獨立驗證過（受限於「絕不碰正式資料」的硬性要求），見下方
  「限制」一節。

## 先前的錯誤結論（已被推翻）

早期排查一度認為「`match /requests/{id}` 區塊底下 `read/create/update/delete` 四條
`allow` 子句共用同一個 1000-expression 預算池」。這個結論來自：把 `read/update/delete`
暫時改成 `if false` 後，原本失敗的 create 測試轉為通過；恢復任一條真實邏輯後又失敗 —— 但
這個對照組**沒有排除「恢復的那條子句自己也很貴、獨立超標」的可能性**，因此推論無效。

## 決定性測試：M / N / O（推翻 pooled-budget 假說）

用「已確認單獨會通過」的 create 子句（11 欄位檢查 + 10 筆附件只驗證
`name`/`url`/`size`，不含 `storagePath`），疊加**真實、完整、未簡化**的 update 子句
（`isApproveTransition`/`isRejectTransition`/`isManagerMetaEdit`/`isDesignerTransition`，
各自呼叫 `isValidCcPlanners` 最多兩次）：

| 變體 | 內容 | 結果 |
|---|---|---|
| M | 只有便宜版 create | **PASS** |
| N | 便宜版 create ＋ 真實 update（同一個 match 區塊） | **PASS** |
| O | 便宜版 create ＋ 真實 update（另一個重疊 match 區塊） | **PASS** |

三個都是乾淨 `CREATE_RESULT: PASS`，0 次 expression-limit 錯誤文字。**這直接推翻
pooled-budget 假說**：create 有餘裕時，疊加多複雜的 update 子句（同區塊或重疊區塊）都不會
拖累 create。

那為什麼早期會看到「恢復 update 後 create 又失敗」？因為 create 自己（用真實的 10 筆附件
+ storagePath↔requestId 三次 `split()` 綁定）**在整份規則檔案沒有任何其他規則的情況下，
單獨一條子句就已經超過 1000**（見下方變體 A）。恢復的 update 子句本身也獨立超標
（它又呼叫一次 `isValidAttachments`、外加 `isValidCcPlanners` 呼叫兩次），emulator 把
兩個違規分開回報：

```
Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'create' @ L128,
Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'update' @ L130
```

`for 'create'` 跟 `for 'update'` 是**兩個獨立的違規**，各自對應各自的 1000 上限，不是
同一個計數器被共同耗盡。用恆假的無關子句可以乾淨證明「沒有成本」：`allow update: if false`
的評估結果永遠是乾淨的 `false for 'update'`，不計入任何超支，同區塊或重疊區塊都一樣。

## 逐步疊加複雜度：找出真正的分界點（L0-L4）

用「完全孤立、整份檔案只有這一條 create、沒有任何其他規則」的方式，逐步加回真實邏輯：

| 層級 | 內容 | 結果 |
|---|---|---|
| L0 | 只檢查 `whitelisted()` | PASS |
| L1 | + 11 欄位型別檢查，`attachments` 只檢查是不是 list（不逐項驗證） | PASS |
| **L2** | + 10 筆附件逐項驗證 `name`/`url`/`size`（不含 `storagePath`） | **PASS** |
| **L3** | + `storagePath` 型別/長度檢查（不比對 requestId，不呼叫 `split()`） | **FAIL** |
| L4 | + `storagePath` 用 1 次 `split()` 精確比對 requestId | FAIL |

**分界點在 L2→L3 之間**：光是幫 10 筆附件「多加一個選填欄位的型別/長度檢查」
（`!('storagePath' in a) || (a.storagePath is string && a.storagePath.size() > 0 && a.storagePath.size() <= 500)`），
就從通過變成失敗。這代表「10 筆附件逐項驗證」這個 pattern 本身，光是三個最基本欄位
（`name`/`url`/`size`）就已經非常接近上限，**幾乎沒有餘裕**再加其他驗證 —— 不管是
`storagePath` 型別檢查，更別說 requestId 綁定的 `split()` 邏輯。

## 同 match 與重疊 match：結果完全一樣，沒有隔離效果

| 對照 | 同一個 match 區塊 | 重疊的 match 區塊 |
|---|---|---|
| create（會超標）+ 無關恆假子句 | 無關子句乾淨評估為 `false`，不影響 create | 完全一樣 |
| create（會超標）+ 真實 update | 兩者各自獨立超標，錯誤同時列出 `create`/`update` | 完全一樣 |
| create（有餘裕）+ 真實 update | PASS（變體 N） | PASS（變體 O） |

**拆成重疊 match block 完全不會給 create 跟 update 各自獨立的預算**——這點跟官方文件
「同路徑多個 match/allow 用 OR 合併」一致（合併就代表兩邊都要被評估）。「同一路徑拆成多個
match block」**不是**可靠的隔離手段，也不等於不同資料路徑。

## 真正的根本原因（Emulator v1.22.0 觀察，非官方保證的正式語意）

**在 Firestore Emulator v1.22.0 的最小重現中**，expression-limit 是每個 `allow` 子句
各自獨立回報，不像同一個 `match` 區塊（或整份檔案）共用同一個計數池。這是實驗觀察，
Firebase 官方並未正式文件化「per allow clause」這個計算範圍，不能直接當作正式 Firestore
保證會完全相同的語意——只能說「在我們測試過的這個 Emulator 版本上，行為是這樣」。

在這個前提下，真正的成本驅動很明確：`isValidAttachments` 這個 10 筆展開驗證的 pattern，
光是最基本的三個欄位檢查就已經逼近上限，而這個函式同時被 `create`
（`isValidRequestCreate`）跟 `update`（提交人編輯分支）各呼叫一次，`update` 還額外呼叫
`isValidCcPlanners`（同樣 10 筆展開）兩次——每條子句各自獨立超標，不是互相拖累。

## 限制：不能推論到正式 Firestore 的部分

即使是**純粹的 create() 操作**（文件先前不存在），只要同區塊/重疊區塊有 update 子句，
emulator 的錯誤訊息就會列出 `for 'update'`——代表 emulator 確實有評估 update 子句的
運算式，即便這次請求跟 update 完全無關。這件事本身是真實可重現的，但**只在本機 Firestore
Emulator v1.22.0 上驗證過，沒有也無法對正式 Firestore 驗證**（受限於「絕不碰正式資料」的
硬性要求）。重要的是：這個「跨子句評估」的現象**沒有影響任何一次的放行結果**（M/N/O 全部
正確 PASS），所以不影響「在這個 Emulator 版本上，1000 上限是逐條 `allow` 子句各自回報、
不是被單一計數池共同耗盡」這個觀察的可信度，但這整套結論**僅限於 Emulator v1.22.0**，
無法排除正式 Firestore 環境行為不同的可能性——這也是為什麼
`docs/firestore-attachments-subcollection-design.md` 第 2 節（方案 A 的 Rules 草案）
明確要求「實作時要重新用同樣的方法論實測，不能只憑閱讀規則推論」。

## 對現行 PR 的影響

`firestore.rules` 維持 `8bd231f` 版本（未套用任何拆 match block / 弱化驗證的實驗性改動）。
目前已知：合法的 0/1/10 筆附件正向案例可以通過，但「附件 array 內展開驗證最多 10 筆」這個
資料模型，會讓**部分負向測試案例**在 Emulator 上因 1000-expression 上限被拒（見 PR 說明
列出的實際次數）。這是已知技術債，完整解法需要把附件搬到子集合（見
`docs/firestore-attachments-subcollection-design.md` 的設計文件），非本次 PR 範圍。

## 可執行重現（精簡版）

只保留兩個關鍵 fixture，展示 L2→L3 這個分界點：

- `test/fixtures/expression-limit/run-variant.mjs` — runner，只做「一次合法 create」
- `test/fixtures/expression-limit/l2-pass.rules` — 對應上表 L2（PASS）
- `test/fixtures/expression-limit/l3-fail.rules` — 對應上表 L3（FAIL）

執行方式：

```bash
# 需要本機已安裝 Java
RULES_FILE=l2-pass.rules firebase emulators:exec --project demo-team-scheduler-rules \
  --only firestore,storage "node test/fixtures/expression-limit/run-variant.mjs"
# 預期 CREATE_RESULT: PASS

RULES_FILE=l3-fail.rules firebase emulators:exec --project demo-team-scheduler-rules \
  --only firestore,storage "node test/fixtures/expression-limit/run-variant.mjs"
# 預期 CREATE_RESULT: FAIL: ... maximum of 1000 expressions ...
```

（Windows PowerShell：用 `$env:RULES_FILE = "l2-pass.rules"` 取代 `RULES_FILE=...`。）

## 最小必要 Rules 範例（L3，示範分界點）

```
function isValidAttachment(a) {
  return a.name is string && a.name.size() > 0 && a.name.size() <= 300
    && a.url is string && a.url.size() > 0 && a.url.size() <= 2000
    && a.size is number && a.size > 0 && a.size <= 10485760
    && (!('storagePath' in a) || (a.storagePath is string && a.storagePath.size() > 0 && a.storagePath.size() <= 500));
}
function isValidAttachments(atts) {
  return atts is list && atts.size() <= 10
    && (atts.size() < 1  || isValidAttachment(atts[0]))
    && (atts.size() < 2  || isValidAttachment(atts[1]))
    // ... 展開到 atts.size() < 10 || isValidAttachment(atts[9])
}
```

拿掉 `storagePath` 那段（回到只驗證 `name`/`url`/`size`）就是 L2，會通過；加回去就是
L3，會撞到 1000-expression 上限。完整內容見 `l2-pass.rules` / `l3-fail.rules`。
