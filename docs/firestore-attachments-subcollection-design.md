# 設計文件：附件搬到子集合（方案 A）— 僅設計，不實作

**狀態：設計草案，尚未實作、未部署、未遷移任何資料。所有正式資料操作（含遷移、任何唯讀
稽核腳本對正式專案的執行）都必須另外取得明確核准後才能執行，本文件本身不構成核准。**

## 0. 為什麼選方案 A

見 `docs/firestore-rules-expression-limit.md` 的完整最小重現：在 Firestore Emulator
v1.22.0 的最小重現裡，每個 `allow` 子句各自獨立回報 expression-limit 錯誤（這是實驗觀察，
不是 Firebase 官方文件保證的正式語意，見該文件的用詞修正）。不管上限的確切語意為何，實測
確認的成本驅動很明確：「附件陣列展開驗證最多 10 筆」這個 pattern 本身——即使每筆只驗證
最基本的 3 個欄位，10 筆展開就已經逼近上限，沒有餘裕再驗證 `storagePath` 綁定。

把附件搬到子集合後，**每次寫入只需要驗證「一筆」附件**，不再需要「10 筆展開」這個 pattern，
`requestId` 也直接來自路徑變數，從根源消除已實測確認的成本驅動因子，而不是像目前這樣在
「附件驗證完整度」跟「1000 上限」之間做取捨。

其餘方案（B/C/D）的比較與 why-not，已經在對話中列出，此處不重複；長期方向排序為：
A（本文件）→ 只有 A 完成後 update 仍超限才評估 B → C 不採用（claims 有 token refresh 延遲，
安全撤銷不即時）→ D 不採用（跨 collection 搬移與查詢重寫風險過高）。

## 1. 新資料結構

```
requests/{requestId}                     ← 既有文件，attachments 欄位最終會移除(遷移完成後)
requests/{requestId}/attachments/{slot}  ← 新子集合，slot 只允許 '0' ~ '9'(字串)
```

**修正**：原草稿把使用者看到的 `name`（可能含中文、空格）直接拿去組 Storage path，但現行
`RequestNewPage.jsx` 的真實邏輯是 `storagePath = attachments/{requestId}/${safeFileName(file.name, i)}`
——`safeFileName` 產生的是 ASCII 安全檔名，跟使用者看到的原始檔名通常不同。子文件必須明確
分成「顯示用」跟「Storage 實際檔名」兩個欄位，不能只有一個 `name`：

**修正(第二輪)**：`storagePath` 其實在 reservation 建立當下就是完全確定的
（只跟 `requestId`/`objectName` 有關，不需要等實際上傳完成），所以不必留到 finalize 才
寫入——這樣 reservation 文件本身就能被 Rules 完整驗證路徑綁定，不用等 finalize 那一刻。
真正只有上傳完成後才知道的欄位只有 `url`(下載網址，Storage 產生時才有)跟 `size`(要實際
讀到檔案才知道)。另外新增 `reservationId`（見第 7 節的競態修正——每次「建立新 reservation」
或「接管一個逾時的舊 reservation」都要產生一個全新、不可預測的值，finalize/delete 都要
比對這個欄位，防止舊 uploader 晚到時搞壞新的 reservation）。

**修正(第三輪)**：`storagePath` 不能只是 `'attachments/' + requestId + '/' + objectName`(即僅由 requestId 跟 objectName 組成、完全不含 reservationId 的舊寫法)
——這個路徑只跟 slot 的 `objectName` 有關，同一個 slot 每次 takeover 都可能重新使用相同或
不同的 `objectName`，導致舊 reservation(A)跟新 reservation(B)的 Storage 物件可能落在
**同一個路徑**上。這會讓第 7 節第 9 點「transaction 比對 `reservationId` 才刪 Firestore
文件」的保護出現漏洞：即使 Firestore 文件層面已經正確擋下了 A 誤刪 B 的*文件*，A 手上
記錄的 Storage 路徑跟 B 現在真正使用的路徑仍然是同一個字串——A 對 Storage 執行的
`deleteObject(storagePath)` 完全不受 Firestore transaction 保護，會直接刪掉 B 剛上傳好
的檔案（見第 7 節新增的時序案例 3）。修正：**把 `reservationId` 也編進 Storage path**，
讓每一次 reservation（不管是初次建立還是接管）的 Storage 物件路徑都是全域唯一、永不重用：

```
attachments/{requestId}/{reservationId}/{objectName}
```

```
{
  name: string,             // 原始顯示名稱(使用者上傳時的檔名，可能含中文/空格)，僅供 UI 顯示，
                            // reservation 建立當下就知道(來自 File 物件)，不是 finalize 才有
  objectName: string,      // Storage 實際檔名(safeFileName 產生的 ASCII 安全名稱)，
                            // 唯一可以拿來組 storagePath 的欄位；reservation 建立當下就決定
  storagePath: string,      // attachments/{requestId}/{reservationId}/{objectName}，
                            // reservation 建立當下就完整寫入(見上方說明)，不是選填、也不是
                            // finalize 才補上的欄位——注意路徑裡包含 reservationId，見上方
                            // 第三輪修正的說明，這是防止跨 reservation 誤刪的關鍵設計
  url: string,              // Firebase Storage download URL，1-2000 字元；只有 finalize
                            // (uploading -> ready)這一步才會出現
  size: number,             // bytes，0 < size <= 10485760 (10MB)；只有 finalize 才會出現
  createdAt: Timestamp,     // reservation 建立時間(見第 7 節)
  createdBy: string,        // reservation 建立者 email
  reservationId: string,    // 每次 create(初次保留)或 update(逾時接管)都要換成全新、不可
                            // 預測的值(例如前端產生的 UUID)，finalize/delete/cleanup 都要
                            // 比對這個欄位是否跟自己記得的一致，也是 storagePath 的一部分，見第 7 節
  status: 'uploading' | 'ready', // 見第 7 節的 reservation 流程
}
```

**`name` 絕對不可以用來組 Storage path**——它只是顯示用的原始檔名，Rules 驗證
`storagePath`/`objectName` 的一致性時完全不看 `name` 欄位。

`slot` 是文件 id（不是欄位），直接對應目前陣列的 index（0-9）。沒有附件的 slot 不建立
文件（不是建立空文件）。**但「目前有幾筆附件」不能單純用「子集合底下有幾個文件」判斷**——
見第 7 節，`status: 'uploading'` 的 reservation 文件也會佔用一個 slot，計數時需要決定是否
把 `uploading` 也算進去（建議：算，因為它佔用了那個 slot，即使最終上傳失敗也需要先被清理
掉才能釋出）。

## 2. slot 0-9 的 Rules 驗證方式

**修正(第二輪)**：原草稿用同一個 `isValidSingleAttachment` 驗證 `uploading`/`ready`
兩種狀態，但 `uploading` 的 reservation payload 根本沒有 `url`/`size`（見第 1 節，這兩個
欄位要等 finalize 才會出現），照原草稿的單一驗證函式（強制要求 `url`/`size` 一定要存在）
去驗證 reservation 建立時的 payload，會直接被 Rules 擋下——這是原設計裡真實存在、會讓
方案 A 完全跑不動的 bug，不是風格問題。拆成兩個函式，分別對應兩種狀態各自的必要/允許
欄位：

```
match /requests/{requestId} {
  // ...既有的 read/create/update/delete，attachments 欄位驗證移除...
}

match /requests/{requestId}/attachments/{slot} {
  allow read: if canReadRequestAttachments(requestId);  // 見下方第 5 節——現行 firestore.rules
  // 沒有 canReadRequest() 這個函式，requests/{id} 的 read 規則是直接內嵌用 resource.data
  // 表達的；子集合的 resource.data 是「附件文件」，不是 parent request，不能直接沿用同一段
  // 表達式，必須另外定義一個會 get() parent 文件的 helper，見第 5 節。

  // create：這個 slot 目前不存在——初次 reservation，只能建立 status:'uploading'(見第 7 節)
  allow create: if
    slot in ['0','1','2','3','4','5','6','7','8','9']
    && canEditRequestAttachments(requestId)
    && isValidUploadingReservation(request.resource.data, requestId);

  // update：兩種情況(見第 7 節的完整時序)——
  // (a) finalize：同一個 reservationId，uploading -> ready，只允許 url/size/status 這三個
  //     欄位變動(changedOnly)，objectName/storagePath/createdBy/createdAt/reservationId/name
  //     一律不可變(changedOnly 沒列的欄位，Firestore 規則語言本身就會擋掉任何差異)。
  // (b) stale takeover：舊 reservation 已逾時，接管者用一個全新、不可預測的 reservationId
  //     整個覆蓋掉(state 仍是 uploading，可以是不同的 objectName——這個 slot 視為重新從頭
  //     使用)，不透過 changedOnly 限制欄位(整份都可能換掉)，但仍要求新資料本身通過完整驗證。
  allow update: if canEditRequestAttachments(requestId) && (
    (resource.data.status == 'uploading'
      && resource.data.reservationId == request.resource.data.reservationId
      && changedOnly(['url', 'size', 'status'])
      && isValidReadyAttachment(request.resource.data, requestId))
    ||
    (isStaleUploadingReservation()
      && request.resource.data.reservationId != resource.data.reservationId
      && isValidUploadingReservation(request.resource.data, requestId))
  );
  // 實作時要照 docs/firestore-rules-expression-limit.md 的方法論，用真實 Emulator
  // 對這兩條 OR 分支實測運算式成本，不能只憑閱讀規則推論「單一 slot 一定遠低於 1000」。

  // delete：見第 7 節——Rules 的 allow delete 沒有 request.resource 可以比對「呼叫端預期的
  // reservationId」(Firestore 的 delete 操作不帶任何 payload)，所以「這是不是我建立的那個
  // reservation」這一層比對，設計上必須放在呼叫端的 transaction 裡，不能寫成 Rules 條件——
  // 這裡只負責身分/狀態層面的授權。
  allow delete: if canEditRequestAttachments(requestId);
}

// 10 分鐘逾時視為 stale——示意值，實作時要跟前端 reservation → upload 的預期耗時對齊
function isStaleUploadingReservation() {
  return resource.data.status == 'uploading'
    && request.time > resource.data.createdAt + duration.value(10, 'm');
}

// 兩種狀態共用的身分欄位驗證：objectName 才是唯一可以拿來組 storagePath 的欄位，
// name 只驗證型別/長度，不參與任何路徑比對。storagePath 這一輪改成包含 reservationId
// (attachments/{requestId}/{reservationId}/{objectName})，讓每次 reservation 的 Storage
// 路徑全域唯一、永不重用——見第 1 節第三輪修正、第 7 節第 10 點跟時序案例 3 的完整說明，
// 這是防止「A 刪除 reservation 後、B 立即重用同一個 slot、A 晚到的 Storage cleanup
// 誤刪 B 剛上傳的檔案」這個問題的關鍵設計，不是隨意加欄位。
function isValidAttachmentIdentity(a, requestId) {
  return a.name is string && a.name.size() > 0 && a.name.size() <= 300
    && a.objectName is string && a.objectName.size() > 0 && a.objectName.size() <= 200
    && a.objectName.matches('^[A-Za-z0-9._-]{1,200}$')
    && a.reservationId is string && a.reservationId.size() > 0 && a.reservationId.size() <= 100
    && a.reservationId.matches('^[A-Za-z0-9-]{1,100}$')
    && a.storagePath is string
    && a.storagePath == 'attachments/' + requestId + '/' + a.reservationId + '/' + a.objectName
    && a.createdBy == email();
}

// reservation 建立/接管當下的狀態：只有身分欄位 + createdAt 必須是這次寫入的時間，
// 不允許 url/size 存在(這兩個欄位要等 finalize 才出現，reservation 階段還沒有)。
function isValidUploadingReservation(a, requestId) {
  return isValidAttachmentIdentity(a, requestId)
    && a.status == 'uploading'
    && a.createdAt == request.time
    && !('url' in a) && !('size' in a);
}

// finalize 後的最終狀態：身分欄位不變(由 allow update 的 changedOnly 保證)，
// 新增驗證 url/size 這兩個這時候才出現的欄位。
function isValidReadyAttachment(a, requestId) {
  return isValidAttachmentIdentity(a, requestId)
    && a.status == 'ready'
    && a.url is string && a.url.size() > 0 && a.url.size() <= 2000
    && a.size is number && a.size > 0 && a.size <= 10485760;
}
```

因為每次只驗證一筆（沒有「10 筆展開」的 unrolled pattern），`storagePath` 的
`requestId` 綁定驗證可以直接用路徑變數 `requestId`（來自 `match` 路徑，不是欄位），完全
不需要 `split()`，也不需要在「驗證完整度」跟「1000 上限」之間取捨。

**驗證清單（對應需求逐項確認）**：
- `objectName` 是 1-200 字元、只允許 `[A-Za-z0-9._-]`。
- `name` 只供顯示，Rules 完全不用它組任何路徑，`uploading`/`ready` 兩種狀態都一樣。
- `storagePath` 必須精確等於 `'attachments/' + requestId + '/' + reservationId + '/' +
  objectName`（`objectName` 必須等於 `storagePath` 最後一段，`reservationId` 必須等於
  `storagePath` 倒數第二段——這裡直接用字串相等表達，不需要額外 `split()` 反查）。路徑裡
  包含 `reservationId` 是第三輪修正加上的（見第 1 節、第 7 節第 10 點），讓每次 reservation
  的 Storage 路徑全域唯一。
- `uploading → ready` 這個 finalize 動作用 `changedOnly(['url', 'size', 'status'])` 限制
  affected keys，`objectName`/`storagePath`/`createdBy`/`createdAt`/`reservationId`/`name`
  這幾個欄位不在允許清單內，Firestore Rules 的 `diff().affectedKeys().hasOnly(...)` 語意
  本身就會擋掉任何想同時竄改這些欄位的 finalize 請求——不需要另外逐一比對舊值/新值。
- **URL 解出的 path 必須與 storagePath 相同**：這一步在 Rules 層無法驗證（Rules 沒有 URL
  decode/解析能力），維持現行架構——Storage 端（`storage.rules`）跟 Functions 端
  （`resolveAttachmentPath`）已經各自做這個驗證，子集合遷移不改變這一層的責任分工。

## 3. 如何避免超過 10 筆

- Rules 層：`slot` 只允許 `'0'`~`'9'` 這 10 個字串值（above），寫入任何其他 slot id
  一律被拒——這是**結構性**上限，不需要額外的 `count()` 查詢或 `size()` 檢查。
- 前端：計數時把 `status` 是 `'uploading'` 或 `'ready'` 的 slot 都算進「已佔用」（見第 7
  節），達到 10 筆時 UI 停用上傳按鈕。
- 因為 slot 上限本身就是 Rules 強制的邊界，即使前端邏輯有 bug 想塞第 11 筆，也會在
  `allow create` 就被擋下（沒有合法的 slot id 可以用）。

## 4. parent request 的讀寫授權

子集合文件的讀取/編輯授權沿用 parent 文件的授權判斷（不重新定義一套邏輯）：

```
function canEditRequestAttachments(requestId) {
  return signedIn() && email() != ''
    && exists(/databases/$(database)/documents/requests/$(requestId))
    && canEditRequestAttachmentsAs(email(), get(/databases/$(database)/documents/requests/$(requestId)).data);
}
function canEditRequestAttachmentsAs(e, parent) {
  // 提交人：需求仍在 pending 時可以編輯附件(對應現行 update 規則的提交人分支)
  return parent.submittedBy == e && parent.status == 'pending';
  // manager 事後編輯已審核需求時，附件不可變(現行規則本來就沒開放這條路徑改附件，維持一致)
}
```

（實作時要重新驗證運算式成本，預期遠低於 1000，但仍要照
`docs/firestore-rules-expression-limit.md` 的方法論實測驗證，不能只憑閱讀規則推論。）

## 5. 讀取授權：`canReadRequestAttachments(requestId)`（修正不存在的 `canReadRequest()`）

**原草稿的錯誤**：第 2 節寫著 `allow read: if canReadRequest();`，但現行 `firestore.rules`
**沒有**這個函式——`requests/{id}` 的 read 規則是直接寫在 `match` 區塊裡的內嵌表達式，用
`resource.data` 表示「這份 request 文件」：

```
// 現行 firestore.rules 的真實寫法(match /requests/{id} 區塊內)：
allow read: if isManager()
  || (whitelisted() && resource.data.submittedBy == email())
  || (whitelisted() && email() in resource.data.get('assignedDesigners', []))
  || (whitelisted() && resource.data.region in myRegions());
```

子集合的 `match /requests/{requestId}/attachments/{slot}` 區塊裡，`resource.data` 指的是
**附件文件**，不是 parent request——沒有 `resource.data.submittedBy`/`region`/
`assignedDesigners` 這些欄位可以直接讀，不能照抄現行寫法。必須另外定義一個會 `get()`
parent 文件、用 `parent.data` 判斷權限的 helper，邏輯要跟現行 read 規則完全一致
（manager 全讀 / 提交人讀自己的 / 被指派的設計師讀自己的 / 負責區域的 planner 讀）：

```
function canReadRequestAttachments(requestId) {
  return exists(/databases/$(database)/documents/requests/$(requestId))
    && canReadRequestAttachmentsAs(email(), get(/databases/$(database)/documents/requests/$(requestId)).data);
}
function canReadRequestAttachmentsAs(e, parent) {
  return isManager()
    || (whitelisted() && parent.submittedBy == e)
    || (whitelisted() && e in parent.get('assignedDesigners', []))
    || (whitelisted() && parent.region in myRegions());
}
```

**跟現行行為一致性的重點**：
- `isManager()`/`whitelisted()`/`myRegions()` **直接重用現行 `firestore.rules` 已有的**
  函式，不重新發明一套——這三個函式內部已經各自處理好「白名單 + `active != false`」的判斷
  （`whitelisted()` 內部會 `exists()`/`get()` 查 `users/{email()}`，`email()` 內部用
  `request.auth.token.get('email', '').lower()`，對沒有 email claim 的登入方式安全地退回
  空字串而不是直接噴錯）。舊帳號、`active == false`、缺 email claim 這些邊界情況的行為，
  跟現行 `requests/{id}` 的 read 規則**完全相同**，因為呼叫的是同一組函式，不是重新實作。
- 這裡**沒有**額外呼叫 `signedIn() && email() != ''`——因為 `isManager()`/`whitelisted()`
  已經各自在內部檢查這件事，額外呼叫只是重複計算、增加運算式成本，不是安全性差異。
- **實作時要用 Emulator 分別測試 single-document `get()` 跟 collection query 兩種存取
  模式**：`onSnapshot`/`getDocs` 對整個 `attachments` 子集合下 query 時，Rules 引擎對
  collection query 的每一份候選文件都要各自通過 `allow read`（包含它各自觸發的
  `get(parent)` 呼叫）；要確認實測時不只測「已知 slot id 的單一 `get()`」，也要測「對整個
  子集合下 query」這個情境下的實際運算式成本與 `get()` 呼叫次數，兩者在 Firestore Rules
  的計費/限制模型下不一定等價，不能只驗證一種存取模式就假設另一種也沒問題。

## 6. schemaVersion：明確版本旗標，取代「子集合是否為空」的判斷

**原草稿的錯誤設計**：「子集合為空時 fallback 讀舊 `attachments` 陣列」。這在下面這個情境
會出錯：文件已完成遷移 → 使用者刪除全部新附件 → 子集合合法地變成空 → 但舊陣列欄位仍有
(遷移時複製過去的)舊資料 → fallback 邏輯誤判成「尚未遷移」，讓已經被使用者刪除的附件重新
出現。**「子集合是否為空」不能拿來判斷資料版本**，因為「已遷移但真的沒有附件」跟「尚未
遷移」這兩種狀態，子集合看起來是一樣的(都是空的)。

**修正設計**：在 parent 文件維護一個明確欄位：

```
requests/{requestId} {
  ...
  attachmentsSchemaVersion: 1 | 2   // 1 = 舊 array 是 authoritative；2 = 新子集合是 authoritative
}
```

（沒有這個欄位的既有文件視為 `1`，等同 `attachmentsMigrated: false` 的效果，兩種寫法擇一
即可，這裡選 `attachmentsSchemaVersion` 是因為未來如果有第三種資料形狀，數字版本比布林值
更容易延伸，不需要多加一個欄位。）

**規則**：
- `attachmentsSchemaVersion` 不存在或等於 `1`：一律讀舊 `attachments` 陣列欄位，完全不看
  子集合（即使子集合裡因為某種原因已經有文件，也不讀）。
- `attachmentsSchemaVersion == 2`：一律只讀新子集合，**即使子集合目前是空的，也絕對不
  fallback 讀舊陣列**——空子集合在版本 2 就是「真的沒有附件」的正確表示。
- 這個欄位**只能在「新子集合 `ready` 文件數精確等於舊陣列長度(0-10)，且每一筆來源與
  destination 內容都驗證一致」之後**才設定成 `2`（見第 13 節的完整一致性檢查——不是固定
  寫滿 10 個 slot，是跟舊陣列實際長度一致）——不是遷移腳本開始處理就設，是驗證通過才設，
  這是這個欄位唯一的寫入時機。
- **Rollback 時如何恢復讀取來源**：把該文件的 `attachmentsSchemaVersion` 寫回 `1`（或整個
  刪除這個欄位）。因為遷移階段全程保留舊陣列欄位不刪除（見第 12 節），這個回退是單純的
  欄位寫入，不需要任何資料搬回去，前端/Functions 的讀取邏輯看到 `1` 就會自動切回讀舊陣列。
  子集合裡已經遷移好的文件不需要清掉，之後要重新切回版本 2 可以直接複用。

## 7. slot 的 reservation 流程（取代「先查空 slot 再 setDoc」的競態設計）

**原草稿的競態問題**：「前端查詢空 slot → 找第一個空位 → setDoc」——兩個並行的客戶端
（例如使用者連續點兩次上傳，或兩個分頁）可能查到同一個空 slot，後寫者會覆蓋前者的
`setDoc`，前者的 Storage 物件就變成沒有任何 Firestore 文件指向的孤兒物件。

**第一輪修正的殘留問題**：第一輪把「stale takeover」也寫成 transaction `create()`——但
`create()` 的語意是「這個文件目前不存在」，一個 stale 的 `uploading` reservation文件
**是存在的**（只是逾時），對已存在的文件呼叫 `create()` 會直接失敗，不會有任何「接管」
效果。

**第三輪修正：前端 Firebase JavaScript(Web) SDK 的 `Transaction` 根本沒有 `create()` 這個
方法**——`firebase/firestore` 的 Web SDK `Transaction` 只有 `get()`/`set()`/`update()`/
`delete()` 四個方法（`create()` 是 Admin SDK/某些其他語言 SDK 才有的，Web SDK 沒有這個
API，本文件第一、二輪的示意寫法用了 Web SDK 不存在的方法名稱，必須修正，即使只是設計文件
也不能寫成看起來能直接照抄執行、實際上會噴 `TypeError: tx.create is not a function` 的
程式碼）。正確寫法是 `tx.get()` 讀一次，判斷文件是否存在，不存在才 `tx.set()`：

```js
async function reserveSlot(db, slotRef, reservationData) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(slotRef)
    if (snap.exists()) {
      throw new SlotOccupiedError() // 這個 slot 已經有人在用，換下一個 slot 重試
    }
    tx.set(slotRef, reservationData)
  })
}
```

**transaction 一定要先 `get()`，再 `set()`，順序不能反過來**——`runTransaction` 的
callback 裡，所有 `get()` 呼叫都必須在任何 `set()`/`update()`/`delete()` 呼叫之前完成
（這是 Firestore transaction 本身的 API 限制，不是這個設計額外加的規則）。**若另一個
client 在這個 transaction 提交前修改了同一份文件**（例如 B 也在同一時間嘗試 reservation
同一個 slot，並且先一步 commit 成功），Firestore 會偵測到版本衝突，**自動重新執行整個
transaction callback**（不是拋錯給呼叫端自己重試——`runTransaction` 本身內建這個重跑機制）：
重新執行時，`tx.get(slotRef)` 會讀到「文件已經存在」（因為 B 已經 set 進去了），
`snap.exists()` 為真，丟出 `SlotOccupiedError`，`runTransaction` 把這個錯誤往外傳給呼叫端。
**呼叫端接到 `SlotOccupiedError` 之後，正確的處理是換下一個 slot 重試，不是對同一個 slot
再呼叫一次 `reserveSlot`**（同一個 slot 再試一次，結果一樣是被佔用，沒有意義）。

初次 reservation 用「`get()` 確認不存在 → `set()`」；接管 stale reservation 必須用
`update()`，且兩者都要靠一個全新、不可預測的 `reservationId` 來防止「舊 uploader 晚到」
把新的 reservation 弄壞。

**Rules 的 `allow create` 不需要因為前端改用 `set()` 就跟著放寬**——Firestore 的
`allow create`/`allow update` 是**伺服器端**依「這次寫入的目標文件，在寫入前是否已經存在」
自動判斷的，跟前端呼叫的是 SDK 的哪個方法名稱（`set()`/`update()`/`create()`）完全無關：
即使前端呼叫 `setDoc()`/`tx.set()`，只要目標文件先前不存在，Firestore 仍然是對照
`allow create` 規則判斷；文件已存在時的 `set()`（未加 `{merge:true}` 時是整份覆蓋）則對照
`allow update` 規則判斷。第 2 節的 `allow create`/`allow update` 拆分完全不用因為這一輪
把 SDK 呼叫從（不存在的）`create()` 改成 `get()+set()` 而修改。

**修正設計：reservation → upload → finalize 三階段（貫穿 `reservationId`）**

1. **初次 Reservation（Firestore transaction，`tx.get()` + `tx.set()`，見上方對
   Web SDK 沒有 `create()` 的修正說明）**：
   ```js
   const reservationId = crypto.randomUUID() // 全新、不可預測，前端產生
   const objectName = safeFileName(file.name, slotIndex)
   const storagePath = `attachments/${requestId}/${reservationId}/${objectName}`
   await runTransaction(db, async (tx) => {
     const snap = await tx.get(slotRef)
     if (snap.exists()) throw new SlotOccupiedError()
     tx.set(slotRef, {
       objectName, name: file.name, storagePath,
       createdAt: serverTimestamp(), createdBy: email(),
       reservationId,
       status: 'uploading',
     })
   })
   ```
   （這時還沒有 `url`/`size`，因為檔案還沒上傳；把這次產生的 `reservationId` 存在這個
   上傳流程的本地變數裡，後面 finalize/rollback 都要用它。`SlotOccupiedError` 拋出後，
   呼叫端要換下一個 slot 重試，見上方「transaction 一定要先 get 再 set」的說明。）
2. **Transaction 成功後才上傳 Storage**——reservation 失敗（slot 已存在且不是 stale，見
   下方第 8 點）就換下一個 slot 重試，不會上傳到會變成孤兒的路徑。
3. **上傳成功後 finalize（`update()`，且必須明確帶上 `reservationId`）**：
   ```
   update(slotRef, { url, size, status: 'ready', reservationId })
   ```
   **關鍵細節（第二輪新增，第一輪遺漏）**：這個 `update()` payload **必須明確包含
   `reservationId`**（值是這次上傳流程一開始拿到、記在本地變數裡的那個值），**不能省略**。
   原因：Firestore 對 `update()` payload 裡沒出現的欄位，會直接沿用文件「目前」的值去組
   `request.resource.data`；如果 finalize 的 payload 不包含 `reservationId`，Rules 條件
   `resource.data.reservationId == request.resource.data.reservationId` 會變成拿「目前
   值」跟「目前值」比對，恆為真，等於完全沒有比對到任何東西——這樣一來，即使有另一個
   client 已經用新的 `reservationId` 接管了這個 slot，舊 uploader 晚到的 finalize 依然
   會被 Rules 誤判為「reservationId 相符」而放行，把新 reservation 的 `url`/`size` 覆蓋
   成舊 uploader（其實已經過期）的資料。**這是設計上必須明確要求前端實作遵守的正確性
   前提，不是可有可無的細節。**
4. **上傳失敗時的 rollback（見下方第 9 點的 transaction 前置條件，而不是直接 `deleteDoc`）**。
5. **已經是 `ready` 的 slot，不允許一般 client 任意覆蓋**——第 2 節的 Rules 已經示意這點，
   `ready` 之後要換掉這個附件，必須先 `delete` 再走一次完整的 reservation 流程，不能直接
   `update` 一個 `ready` 的文件。
6. **同一個 slot 的並行「初次」reservation 只能有一個成功**：靠 Firestore transaction 的
   樂觀鎖機制本身保證——兩個並行 transaction 對同一個 slot 各自 `tx.get()` 都讀到「不存在」，
   都打算 `tx.set()`，但 Firestore 只會讓其中一個先提交成功；另一個因為版本衝突被自動重跑
   （見上方「transaction 一定要先 get 再 set」的說明），重跑時 `tx.get()` 會讀到「已經存在」，
   丟出 `SlotOccupiedError`，不是應用層邏輯自己判斷「誰先誰後」。
7. **同一個 slot 的並行「接管」也只能有一個成功**：接管走的是 `update()`，Rules 條件裡的
   `isStaleUploadingReservation()` 讀到的 `resource.data.createdAt`/`status` 在同一個
   transaction 裡是一致的快照，兩個並行的接管 transaction 對同一份 `resource` 版本各自
   提交時，Firestore 一樣會用樂觀鎖機制讓其中一個因版本衝突而重試——重試時重新 `get()`
   會看到「已經被別人接管了」（`reservationId` 已經換掉、`createdAt` 也已經更新，不再
   符合 stale 的判斷條件），所以重試應該改成換下一個 slot，而不是無限重試接管同一個 slot。
8. **stale `uploading` reservation 的判定與逾時**：
   - `isStaleUploadingReservation()`（第 2 節）：`status == 'uploading'` 且
     `request.time > createdAt + 10 分鐘`——示意逾時值，實作時要跟前端「reservation →
     實際上傳」預期的最長耗時對齊（例如依檔案大小上限抓一個合理上限，10 分鐘只是起點）。
   - 前端在「找可用 slot」時，查到的 slot 若是 `uploading` 且已超過逾時，就對它送出一次
     接管 `update()`（帶新的 `reservationId`），成功就可以使用這個 slot；失敗（被別人搶先
     接管，或它其實還沒真的 stale）就換下一個 slot，不重試同一個。
   - 額外用一個排程 Cloud Function 定期掃描、接管/清理過期的 `uploading` reservation
     （不依賴一定要有前端使用者剛好去查詢那個 slot 才會被清理——長期沒人上傳的半成品需求
     不該永遠佔用 slot）。
9. **rollback / 清理必須是「transaction 讀到 reservationId 相符才刪」，不能是裸的
   `deleteDoc()`**：Firestore 的 `delete` 操作**不帶任何 payload**，Rules 的
   `allow delete` 沒有 `request.resource` 可以拿來跟呼叫端「預期的 reservationId」比對
   （這是 Firestore 平台本身的限制，不是這個設計的疏漏，見第 2 節 `allow delete` 的
   註解）。因此「這是不是我建立的那個 reservation」這一層比對，**必須放在呼叫端的
   transaction 裡**：
   ```
   runTransaction(db, async (tx) => {
     const snap = await tx.get(slotRef)
     if (!snap.exists() || snap.data().reservationId !== myReservationId) {
       return // no-op：已經被別人接管，不是我的 reservation 了，什麼都不做
     }
     tx.delete(slotRef)
   })
   ```
   Rules 層的 `allow delete: if canEditRequestAttachments(requestId)` 只負責「這個人有沒有
   資格編輯這個 request 的附件」這個身分/狀態層面的授權，**不負責**「這是不是我建立的那個
   reservation」——這件事在 Firestore 的 delete 語意下無法用 Rules 表達，只能在呼叫端用
   transaction 前置條件擋。同樣的 Storage 物件清理（如果已經上傳了一部分）也要在同一個
   transaction 確認 reservationId 相符「之後」才執行，避免刪到接管者剛上傳好的檔案。
10. **光靠「transaction 內比對 reservationId 才刪 Firestore 文件」還不夠——Storage 物件本身
    也必須是每次 reservation 全域唯一的路徑**（第三輪修正，見第 1 節、第 2 節）：即使第 9
    點已經確保 A 不會誤刪 B 的 Firestore reservation *文件*，A 手上記住的 Storage
    `storagePath` 字串，如果只跟 `requestId`/`objectName` 有關（不含 `reservationId`），
    B 接管同一個 slot 後上傳的檔案完全可能落在**同一個路徑**上——這時 A 對 Storage 執行
    `deleteObject(storagePath)` 是純粹的 Storage 操作，**完全不受 Firestore transaction
    保護**，會直接刪掉 B 剛上傳好的檔案（即使 Firestore 文件層面的 reservationId 比對完全
    正確）。修正：`storagePath` 固定為 `attachments/{requestId}/{reservationId}/{objectName}`
    （見第 1 節的資料結構），這樣：
    - A 記住的 `storagePath` 永遠是 `.../${RID_A}/...`，B 接管後使用的是全新的
      `.../${RID_B}/...`——兩者在 Storage 上是完全不同的物件路徑，A 的 `deleteObject`
      物理上就刪不到 B 的檔案，不需要依賴任何執行時序或額外比對。
    - 這比「只比對 Firestore 文件的 reservationId」更根本：Firestore 文件層面的比對只能防止
      誤刪*紀錄*，防不了誤刪 Storage *物件本身*，因為兩個操作(刪 Firestore 文件、刪 Storage
      物件)不在同一個事務裡；讓路徑本身包含 reservationId，才能讓「刪除」這個動作對 Storage
      而言天生就是精準指向自己那份 reservation，不需要靠時序或額外檢查來保證安全。
    - 詳見下方時序案例 3。

    **對現行 Storage Rules / 前端 URL validator / Cloud Functions path validator 的未來
    設計影響（本輪只更新這裡的設計說明，不實際修改這三處正式程式）**：現行 `attachments/`
    路徑固定是 3 段（`attachments/{requestId}/{filename}`），`storage.rules`、
    `src/utils/attachmentUrl.js`（`getSafeAttachmentUrl`）、`functions/index.js` 的
    `isAttachmentPathForRequest`（`parts.length === 3 && parts[0] === 'attachments' &&
    parts[1] === docId`）都是照這個 3 段結構寫的。方案 A 一旦真的實作，路徑會變成 4 段
    （多插入 `{reservationId}`），這三處都需要對應調整為「4 段，且第 2 段(`reservationId`)
    存在、第 1 段是 `requestId`、最後一段是合法檔名」的判斷，而不是繼續假設固定 3 段。
    這只是設計階段先標注影響範圍，實際的 Storage Rules 路徑比對規則、前端/Functions 的
    path-parsing 邏輯調整，要留到真正決定實作方案 A、並取得核准之後才動手，本輪不觸碰
    這三個正式檔案。
11. **Firestore transaction 跟 Storage upload 沒辦法形成單一跨服務的原子交易**——這是
    Firestore/Storage 分屬不同服務的根本限制，不是這個設計的缺陷。因此失敗補償
    **必須是冪等、可重試、且帶著 `reservationId` 一起判斷**：
    - 刪除一個不存在的 reservation 文件、或刪除一個不存在的 Storage 物件，都必須是
      no-op（不噴錯），這樣補償邏輯本身可以安全地重試任意次。
    - 補償邏輯本身失敗（例如刪除 Storage 物件時網路斷線）時，要能重新觸發（前端重試按鈕，
      或前面提到的排程清理 Function 一併處理「有孤兒 Storage 物件但沒有對應 reservation」
      的情況——這需要列出 `attachments/{requestId}/` 底下的 Storage 物件，比對 Firestore
      子集合，抓出不一致的孤兒物件並清除，是第 8 點排程清理 Function 的延伸工作項目）。
      每次重試補償都要重新用第 9 點的 transaction 前置條件確認 `reservationId` 仍然相符，
      不能假設「我第一次檢查過就永遠有效」——即使有第 10 點的路徑唯一性保護，Firestore
      文件層面的補償仍然需要 reservationId 比對，兩者是互補的兩層防護，不是其中一個可以
      取代另一個。

**時序案例 1：uploader A 逾時，B 接管，A 晚到才 finalize**

| 時間 | 事件 |
|---|---|
| t=0 | A 對 slot `3` 做初次 reservation：`tx.get()` 確認不存在後 `tx.set()`，`reservationId=RID_A`，`status:'uploading'`，`storagePath=attachments/{requestId}/RID_A/{objectName}` |
| t=0~11min | A 的上傳因網路問題卡住，遲遲沒有 finalize |
| t=11min | B 查詢可用 slot，看到 slot `3` 是 `uploading` 且 `createdAt` 已超過 10 分鐘逾時 → B 送出接管 `update()`：`reservationId=RID_B`（全新產生），符合第 2 節 `allow update` 的「stale takeover」分支（`request.resource.data.reservationId != resource.data.reservationId` 且 `isStaleUploadingReservation()` 成立），成功。此時 slot `3` 的 `reservationId` 已經是 `RID_B` |
| t=15min | A 的上傳終於完成，A 呼叫 finalize：`update(slotRef, { url, size, status:'ready', reservationId: RID_A })`——**因為第 3 點要求 finalize 必須明確帶上 `reservationId`**，這裡送出的是 `RID_A`（A 記得的、自己 reservation 時的值） |
| t=15min | Rules 檢查 finalize 分支：`resource.data.reservationId`（目前是 `RID_B`，因為 B 已接管）跟 `request.resource.data.reservationId`（A 送出的 `RID_A`）不相等 → **finalize 分支條件不成立**；也不符合 stale-takeover 分支（`status` 已經是 `uploading` 沒錯，但 A 送的是 `status:'ready'`，不符合 takeover 分支要求的「新資料 `status` 也要是 `uploading`」）→ **整個 update 被 Rules 拒絕**，A 的過期 finalize 不會覆蓋 B 的新 reservation |

**時序案例 2：B 接管後，A 的 cleanup 才晚到執行**

| 時間 | 事件 |
|---|---|
| t=0 | A 對 slot `3` 做初次 reservation：`reservationId=RID_A` |
| t=0~12min | A 的上傳失敗（例如網路斷線），A 的錯誤處理邏輯應該要清理這個 reservation，但因為某種原因（例如分頁被關掉、程式碼還沒執行到清理步驟）延遲到 t=12min 才真的觸發 |
| t=11min | B 接管（同案例 1），`reservationId` 變成 `RID_B` |
| t=12min | A 的延遲清理邏輯終於執行，走第 9 點的 transaction：`tx.get(slotRef)` 讀到目前的 `reservationId` 是 `RID_B`，跟 A 記得的 `RID_A` 不相符 → **transaction 判斷「no-op」，不執行 `tx.delete()`**，B 的新 reservation 完全不受影響 |

**時序案例 3：A 刪除 reservation 後，B 立即重用同一個 slot，A 的 Storage cleanup 晚到執行**
（第三輪新增——這是案例 2 的延伸，特別針對「Firestore 文件層面比對過了，但 Storage 物件
清理本身沒有事務保護」這個問題）

| 時間 | 事件 |
|---|---|
| t=0 | A 對 slot `3` 做初次 reservation：`reservationId=RID_A`，`storagePath=attachments/{requestId}/RID_A/report.pdf` |
| t=0~5s | A 已經把檔案上傳到 `attachments/{requestId}/RID_A/report.pdf`，但緊接著判斷這次上傳應該取消（例如使用者在上傳完成前按了取消），A 依第 9 點的 transaction 前置條件確認 `reservationId` 仍是 `RID_A`、確實是自己的 reservation，成功刪除 Firestore 文件——**但 A 對 Storage 物件的 `deleteObject('attachments/{requestId}/RID_A/report.pdf')` 因為網路問題還沒送出/還沒完成，停在佇列裡** |
| t=5s | B 立即查詢到 slot `3` 現在不存在(已被 A 刪除)，送出全新的初次 reservation：`reservationId=RID_B`，`storagePath=attachments/{requestId}/RID_B/report.pdf`——**注意路徑最後一段檔名恰好也叫 `report.pdf`（使用者剛好上傳同名檔案，這是完全合理、會發生的情況）**，但因為路徑包含 `reservationId`，跟 A 的路徑 `.../RID_A/...` 是完全不同的物件 |
| t=5s | B 上傳成功，Storage 上同時存在兩個物件：`.../RID_A/report.pdf`(A 的，即將被清掉的孤兒)跟 `.../RID_B/report.pdf`(B 的，有效) |
| t=8s | A 排隊中的 `deleteObject('attachments/{requestId}/RID_A/report.pdf')` 終於送達 Storage 並執行——**因為這個路徑跟 B 的 `.../RID_B/report.pdf` 是不同物件，這次刪除只會刪到 A 自己上傳、本來就該被清掉的那份，完全不會影響 B 剛上傳好的 `.../RID_B/report.pdf`** |

**為什麼「Storage path 對每個 reservation 全域唯一」能擋下這個問題**：案例 3 裡，即使 A 的
Storage 清理動作在時間上「晚到」、跟 B 的重用動作交錯，**兩者操作的根本就是不同的物理
路徑**——這不是靠時序運氣或額外的執行時檢查達成的安全，而是路徑設計本身讓「A 能刪到的
東西」跟「B 正在使用的東西」永遠不可能是同一個物件，即使兩者剛好選了同一個 `objectName`
（同名檔案）也一樣。這跟時序案例 1/2 的保護機制（transaction 內比對 `reservationId`）是
互補的兩層：文件層面靠 `reservationId` 比對，Storage 物件層面靠路徑本身天生不重疊。

三個案例都證明：**只要 finalize 明確帶上 `reservationId`、cleanup 一定經過「transaction 內
先比對 `reservationId` 再決定要不要動作」、且 Storage path 本身編入 `reservationId` 這三個
實作前提都成立，舊 uploader 晚到就不可能 finalize、覆蓋、刪除新的 Firestore reservation，
也不可能刪到新 reservation 已經上傳好的 Storage 物件**——這三個前提是這個設計唯一的正確性
基礎，必須在實作/程式碼審查階段明確驗收，不能只看 Rules 邏輯就假設一定安全。

## 8. 前端讀寫流程

- **建立需求**（`RequestNewPage.jsx`）：`addDoc` 建立文件（不需要 `attachments` 欄位，新
  文件直接是 `attachmentsSchemaVersion: 2`）→ 對每個要上傳的檔案走第 7 節的
  reservation → upload → finalize 流程。
- **讀取/顯示**（`RequestDetailModal.jsx`、`ReviewPage.jsx`、`RequestsTablePage.jsx`）：先
  讀 parent 文件的 `attachmentsSchemaVersion`，`1` 就讀舊陣列欄位，`2` 就對子集合下
  `onSnapshot`/`getDocs`（只顯示 `status == 'ready'` 的附件，`uploading` 的顯示為「上傳中」
  狀態），依 slot id 排序後組回陣列形狀（沿用現有的 `src/utils/attachmentUrl.js` 驗證邏輯，
  不需要改）。
- **刪除單筆「已完成」附件**（使用者主動點刪除一個 `status == 'ready'` 的附件）：直接
  `deleteDoc` 該 slot 文件 + `deleteObject` 對應的 Storage 物件（用 `storagePath` 定位，
  不是用 `name`）——這是使用者明確的操作，不涉及 reservation 競態，不需要走第 7 節第 9 點
  的 transaction 比對流程；不再需要「整個陣列重寫、少一筆」的做法。
- **清理自己失敗的 reservation**（`status == 'uploading'` 的半成品，因為自己上傳失敗要
  rollback）：**不是**直接 `deleteDoc`，必須走第 7 節第 9 點的 transaction 前置條件（先比對
  `reservationId` 是否還是自己記得的那個值，不符合就 no-op），避免刪到已經被別人接管的
  reservation。

## 9. Functions 如何取得附件

`functions/index.js` 目前讀 `after.attachments`（Firestore trigger 的文件快照）的地方：
`buildHtml`（通知信）、`previewFile`（下載代理）、`resolveAttachmentPath`。改成：

- 先讀 parent 文件（`event.data.after` 已經有）的 `attachmentsSchemaVersion`：`1` 就沿用
  現行邏輯讀 `after.attachments`；`2` 就額外查
  `db.collection('requests').doc(id).collection('attachments').where('status', '==', 'ready').get()`，
  組回陣列傳給 `buildHtml`（`buildHtml` 的簽名/驗證邏輯不必改，因為它接收的還是一個
  「附件物件陣列」，只是來源不同，且陣列裡的物件現在多了 `objectName`/`status` 欄位，
  `buildHtml` 目前只用 `name`/`url`，不受影響）。
- `previewFile`：`附件index` 直接對應新的子集合 slot id，改成
  `db.collection('requests').doc(docId).collection('attachments').doc(idxStr).get()`（先查
  parent 的 `attachmentsSchemaVersion` 決定要不要走這條路徑）。

## 10. 半成品文件的清理 / 回滾設計（方案比較，選定建議方案）

**背景限制**：Security Rules 的 `exists()` 只能檢查完整文件路徑是否存在，**不能**查詢
「整個 `attachments` 子集合是否為空」——沒有這種聚合查詢能力，不能寫成
`!exists(.../attachments)` 這種語法去代表「子集合沒有任何文件」。逐一檢查 0-9 十個 slot
的 `exists()`，再加上 `users`/`parent` 的 `get()`/`exists()`，即使每次呼叫成本不高，這麼
多次 document-access 呼叫累加起來，也可能逼近 Rules 的 document-access 呼叫次數上限（跟
expression 數量是不同的限制維度，但一樣是要小心的資源）。**不能把「查詢子集合是否為空」
這個 Rules 語言實際上沒有的能力寫進設計裡。**

比較兩個方案：

**方案 1：parent 維護 `attachmentCount` 欄位，Rules 用 `getAfter()` 驗證變化量**
- 概念：每次子集合寫入(reservation 建立/刪除/finalize)都同時用 transaction/batch 原子更新
  parent 的 `attachmentCount`，Rules 在 slot 的 `allow create/delete` 裡用
  `getAfter(/databases/$(database)/documents/requests/$(requestId)).data.attachmentCount`
  驗證這次操作有沒有把計數同步改對。
- 問題：**寫入子集合文件（`requests/{id}/attachments/{slot}`）跟寫入 parent 文件
  （`requests/{id}`）是兩個不同的文件路徑**，client SDK 沒辦法用單一 `setDoc`/`updateDoc`
  同時原子寫兩個路徑並讓 Rules 用 `getAfter()` 驗證——`getAfter()` 驗證的是「同一個
  transaction/batch 裡，其他文件寫入後的狀態」，這要求 client 端呼叫**必須**是同一個
  `writeBatch`/`runTransaction`，任何一次獨立的 `setDoc(slot)` 呼叫都無法滿足，等於強迫
  前端所有附件操作都要包成 batch，複雜度高、且容易因為前端 bug 漏包而讓計數跟實際
  slot 數量不一致（一旦不一致，`getAfter()` 驗證會一直擋住後續操作，需要額外的修復流程）。
  這個方案把「計數一致性」這個脆弱點從 Rules 層搬到「前端有沒有正確包 batch」，並沒有
  真正變簡單。

**方案 2：半成品清理改成受保護的 callable Cloud Function**
- 概念：不在 Rules 層判斷「子集合是否為空」，改成前端呼叫一個 `onCall` function（例如
  `cleanupIncompleteRequest`），由 Admin SDK（不受 Rules 限制）查詢子集合實際內容後決定
  能不能刪。
- Function 必須驗證（逐項對應需求）：
  - **App Check**：`onCall` 的 `enforceAppCheck: true`，拒絕沒有合法 App Check token 的
    呼叫。
  - **caller 已登入且啟用**：`context.auth` 存在，且對應的 `users/{email}` 文件
    `active != false`。
  - **caller 是 request submitter 或 manager**：讀 parent 文件的 `submittedBy` 比對，或
    `users/{email}.role == 'manager'`。
  - **status 是 pending**：parent 文件 `status == 'pending'`，已經核准的需求一律拒絕。
  - **沒有 ready/uploading attachment**：查子集合，只要有任何一筆 `status` 是 `ready` 或
    `uploading`，就拒絕刪除（這才是「半成品」的精確定義：真的沒有任何附件正在處理或已完成）。
  - **操作冪等**：文件已經被刪過（`get()` 不到）直接視為成功返回，不噴錯，允許前端重試。
  - **不得刪除已審核需求**：跟「status 是 pending」是同一個檢查，這裡重申一次避免遺漏。
- 優點：Admin SDK 查詢子集合是一次真正的「這個子集合有沒有文件」查詢（`.limit(1).get()`
  就能判斷非空），不需要繞過 Rules 語言做不到的事，也不需要前端小心翼翼地把每個操作包
  成 batch 來維護一個計數欄位。

**選定建議方案：方案 2**。理由：方案 1 把問題從「Rules 語言做不到子集合空判斷」轉移成
「前端必須完美維護一個跨文件計數」，本質上只是把脆弱點搬位置，沒有真正解決；方案 2 直接
用 Admin SDK 做它本來就能做、Rules 語言做不到的查詢，且把「刪除半成品」這種本來就需要
可信第三方仲裁的操作放進一個明確、可稽核、可加驗證的 Cloud Function 裡，符合現有
`resolveActivePlannerCcEmails`/`renameUserLogin` 這類「敏感操作收斂進 callable function」
的既有架構慣例。

**額外補充（Firestore 刪除 parent 不會自動刪 subcollection）**：
- Firestore 刪除一個文件**不會**自動刪除它的 subcollection——`deleteDoc(requests/{id})`
  之後，`requests/{id}/attachments/*` 底下的文件依然存在（變成沒有 parent 的孤兒子集合）。
- 需要一個 `onDocumentDeleted('requests/{id}')` 的 Cloud Function（`cleanupOnDelete`）：
  1. 查詢 `requests/{id}/attachments` 底下所有文件。
  2. 對每一筆先刪除對應的 Storage 物件（用 `storagePath`），再刪除該 Firestore 子文件。
  3. **清理必須可重試、能處理部分失敗**：用 `Promise.allSettled` 逐筆處理，不因為某一筆
     Storage 刪除失敗就整批放棄；失敗的筆數記錄下來（`logger.error`），交由排程 function
     （第 7 節第 8 點提到的孤兒清理排程）之後重新掃描補clean。
  4. **順序與失敗策略**：先刪 Storage 物件、成功後再刪 Firestore 子文件（不是反過來）——
     如果反過來先刪 Firestore 子文件、Storage 刪除又失敗，會留下「沒有任何 Firestore 紀錄
     指向、但實際存在」的孤兒 Storage 物件，且因為 Firestore 紀錄已經沒了，之後的排程
     清理邏輯不容易找到它（除非額外去列舉整個 `attachments/` bucket 前綴，比對哪些路徑
     沒有對應的 Firestore 文件——這是可行的，但成本比「Firestore 文件還在、只是 Storage
     沒刪乾淨」的情況高，所以選擇先刪 Storage、Firestore 紀錄留到最後一步才刪，讓「有
     紀錄但清理未完成」是唯一需要重試處理的中間狀態）。

## 11. 遷移批次與可重試設計（Storage copy migration）

**修正(第四輪)：原草稿自相矛盾**——新 schema 要求 `storagePath` 是四段
（`attachments/{requestId}/{reservationId}/{objectName}`），但原本第 11、13 節說遷移只是
「直接複製舊 `storagePath`/`url`，新舊完全相同」，而舊資料的 `storagePath` 實際上是三段
（`attachments/{requestId}/{objectName}`，沒有 `reservationId` 這一段）。這兩件事不可能
同時成立——不能一邊要求新 schema 是四段路徑，一邊又說「新舊 storagePath/url 相同」。
修正方向：**遷移時真的把 Storage object 複製到新的四段路徑**，而不是讓舊三段路徑掛著不變、
只在 Firestore 裡假裝套用新 schema。這裡刻意不引入「永久 legacy Rules 分支」（例如讓 Rules
同時接受三段或四段兩種 `storagePath` 格式）——那樣會讓第 2 節的驗證函式永遠多一條分支、
永久墊高 expression 成本，且會讓「這個系統的 storagePath 到底該長怎樣」變成一個沒有終點的
問題。統一 schema（遷移時就把舊物件複製過去，之後全部都是四段格式）雖然遷移當下比較貴
（要真的複製檔案），但換來的是 Rules 永遠只需要驗證一種格式，長期複雜度更低。

**流程：source 解析 → 產生穩定的 migration reservationId → destination 存在性/一致性
檢查 → Storage copy → 新 URL → 寫入 ready 子文件**

1. **Source path 解析**（每筆舊附件）：
   - 若舊附件有 `storagePath`：直接當作 source path，驗證必須精確符合三段格式
     `attachments/{requestId}/{filename}`（`split('/').length === 3`、
     `parts[0] === 'attachments'`、`parts[1] === requestId`）。
   - 若沒有 `storagePath`：從 `url` 反解——**不能用前端 `RequestNewPage.jsx` 那個寬鬆的
     `derivePathFromUrl()`**（那個只用 `/o/([^?]+)/` 抓字串、不驗證 host/bucket，是給
     UI 顯示用的寬鬆備援，不適合當遷移腳本的正確性依據）。遷移腳本必須用
     `functions/index.js` 現有的、已驗證過的
     `parseAttachmentUrl`/`parseAttachmentStoragePath` 同等邏輯（https-only、host 必須是
     `firebasestorage.googleapis.com`、bucket 必須符合本專案、解碼後路徑必須落在
     `attachments/` 底下），解出的路徑一樣要通過上面的三段格式 + `requestId` 綁定驗證。
   - **source path、bucket、requestId 任一項不合法 → 這筆附件的遷移直接失敗**，記錄
     文件 id + slot + 失敗原因，**這份 request 文件不設定 `attachmentsSchemaVersion: 2`**
     （只要有任何一筆附件遷移失敗，整份文件都不能標記完成——不能「部分附件遷移成功就切
     版本」，那樣會讓 schemaVersion:2 卻讀不到某筆附件）。

2. **穩定、可重試的 migration reservationId(不是一般上傳用的隨機 UUID v4)**：
   - 一般新上傳的 reservation（第 7 節）用 `crypto.randomUUID()`(UUID v4，隨機、不可預測)
     ——這對「一次性、不會重跑」的操作是對的，但**遷移腳本會被重跑**(中斷、部分失敗、
     重新執行)，如果每次重跑都對同一筆舊附件重新產生一個新的隨機 UUID，會導致
     destination path 每次都不一樣，**在 Storage 上留下重複的物件**(舊的那次複製留下的
     物件沒有任何機制知道該不該刪，因為每次重跑都覺得自己是第一次)。
   - 修正：遷移用的 `reservationId` 改用**確定性(deterministic)**的 UUID v5（或等效的
     hash），輸入至少包含 `requestId`、`slot`、`source storagePath` 這三個值：
     ```js
     import { v5 as uuidv5 } from 'uuid'
     // 固定的 namespace UUID，遷移腳本專用，寫死在程式碼裡、不可變更(一旦變更，所有
     // 舊附件重跑時算出的 destination path 會全部改變，等於失去「確定性」這個屬性)
     const MIGRATION_NAMESPACE = '6f1b1c1e-6f2a-4b6e-9f2d-3c9a2b7d4e10'
     const migrationReservationId = uuidv5(`${requestId}:${slot}:${sourcePath}`, MIGRATION_NAMESPACE)
     ```
   - **同一筆舊附件不管重跑幾次，算出來的 `migrationReservationId` 跟 destination path
     都完全一樣**——這是「可安全重試」的核心前提，沒有這個前提，任何部分失敗後的重跑都會
     製造孤兒物件。

3. **Destination path**：
   ```
   attachments/{requestId}/{migrationReservationId}/{objectName}
   ```
   `objectName` 是 source path 最後一段(檔名)，**重新驗證**必須符合 ASCII 安全格式
   `^[A-Za-z0-9._-]{1,200}$`（既有的合法上傳檔名理論上都已經是這個格式，因為當初上傳時
   就是用 `safeFileName()` 產生的；但遷移腳本不能「假設」這件事一定成立，必須實際驗證——
   如果驗證失敗，這筆附件的遷移失敗，不嘗試自動改寫成別的檔名，避免產生「migration 自己
   決定的檔名」跟原始資料對不上的疑慮）。

4. **Destination 存在性與一致性檢查(冪等的關鍵)**：
   - 複製前先檢查 destination path 是否已存在(對應「這是不是重跑」的情況)。
   - **不存在** → 執行第 5 點的複製。
   - **已存在** → **不可盲目覆蓋**，必須驗證 destination object 的 `size` 與
     `md5Hash`/`generation`(或等效的內容指紋 metadata)跟 source object 完全一致：
     - 一致 → 視為「上次已經複製成功，這次重跑不用重新複製」，跳過複製，直接進入第 6 點
       (取得/確認下載 URL)。
     - **不一致 → 停止這筆附件的遷移並回報**(可能是 hash 碰撞、或曾經被別的東西寫過這個
       路徑這種不應該發生的情況)，不能因為路徑存在就假設內容一定對，更不能覆蓋掉一個
       來源不明的物件。
5. **Storage copy**：用**已核准的一次性 Admin migration function/script**（Admin SDK，
   例如 `bucket.file(sourcePath).copy(bucket.file(destinationPath))`）把 source object
   複製到 destination path——**這一步是實際的正式資料操作，執行前必須另外取得明確核准**
   （見第 15 節），本文件本身不構成這個核准。
6. **新的下載 URL/token**：複製完成後，在 destination object 上設定新的
   `firebaseStorageDownloadTokens` metadata(產生一個新 token，不是沿用 source 的
   token)，組出新的下載 URL(`https://firebasestorage.googleapis.com/v0/b/{bucket}/o/
   {encodeURIComponent(destinationPath)}?alt=media&token={newToken}`)——**新舊
   `storagePath`/`url` 不會相同，也不應該要求它們相同**，這正是本輪要修正的錯誤預期。
7. **寫入子集合 `ready` 文件**，欄位對應第 1 節的 schema：
   ```js
   {
     name: oldAttachment.name,              // 沿用舊資料的顯示名稱
     objectName,                             // 從 source path 重新驗證取得(見第 3 點)
     storagePath: destinationPath,           // 新的四段路徑
     url: newDownloadUrl,                    // 新的下載網址(見第 6 點)
     size: destinationObjectMetadata.size,   // 用 destination object 實際的 size(已在
                                              // 第 4 點驗證跟 source 一致)，不是照抄舊
                                              // Firestore 資料裡可能過時的 size 欄位
     reservationId: migrationReservationId,  // 第 2 點的確定性 migration ID
     createdAt: <遷移執行當下的時間戳>,        // 定義：這個 ready 文件是「遷移這次執行」
                                              // 才產生的，語意上代表這份 Firestore 文件
                                              // (reservation)本身的建立時間，不是沿用
                                              // parent 原始建立時間(parent.createdAt 代表
                                              // 的是「這個 request」的建立時間，不是「這筆
                                              // 附件 reservation 文件」的建立時間，兩者是
                                              // 不同的時間點，不應該混用)
     createdBy: parentRequest.submittedBy,   // 定義：沿用 parent 的提交人 email，代表
                                              // 「這筆附件原本歸屬於誰」，而不是遷移腳本
                                              // 自己的服務身分——這樣 canEditRequestAttachments
                                              // (第 4 節，檢查 parent.submittedBy == e)在
                                              // 提交人之後編輯附件時，行為才會跟遷移前一致
     status: 'ready',
   }
   ```
   **Admin SDK 寫入不受 Rules 限制，但寫出來的資料仍必須完整符合第 2 節
   `isValidReadyAttachment` 的新版 schema**（`objectName` 格式、`storagePath` 精確等於
   `'attachments/' + requestId + '/' + reservationId + '/' + objectName`、`url`/`size`
   型別範圍、`status == 'ready'`）——不是「反正 Admin SDK 不受 Rules 限制就可以隨便寫」，
   因為切到 `schemaVersion: 2` 之後，這筆資料未來會被**一般 client**(受 Rules 限制)讀取、
   甚至編輯(例如提交人在 pending 狀態下修改附件)，如果遷移寫出的資料本身不符合 schema，
   會變成「切版本後這筆附件變成事實上讀得到但改不動」的壞資料。
- 用 `attachmentsSchemaVersion`（不是額外的 `attachmentsMigrated` 布林欄位——兩者擇一，
  這裡統一用前者）當作 checkpoint：整個遷移可以中斷、重跑，只會重複處理「還不是版本 2」
  的文件，不會對已完成的文件重複寫入造成副作用（因為第 4 點的存在性/一致性檢查讓
  Storage copy 本身也是幂等的，不只是 Firestore 寫入幂等）。
- 每批之間有明確的成功/失敗計數回報，失敗的文件 id 記錄下來，方便針對性重跑，不需要整批
  重來。

## 12. Rollback 方法（整體遷移層級）

- 因為遷移階段全程保留舊 `attachments` 陣列欄位**跟舊的三段 Storage object**（都不會因為
  遷移完成就刪除/搬移——遷移是「複製」不是「搬移」，source object 遷移完成後依然原封不動
  留在原本的三段路徑上），rollback 只需要：
  1. 把已遷移文件的 `attachmentsSchemaVersion` 寫回 `1`（見第 6 節「Rollback 時如何恢復
     讀取來源」——前端/Functions 的讀取邏輯看到 `1` 就自動切回讀舊陣列/舊三段
     `storagePath`/`url`，不需要搬任何資料，舊資料完整未動）。
  2. 保留（不刪除）已寫入的四段路徑 Storage object 跟子集合 `ready` 文件，之後要重新
     遷移時，靠第 11 節第 2/4 點的確定性 ID + 存在性/一致性檢查，可以直接偵測到「這筆已經
     複製過」而跳過重複複製，不用重新處理。
- 只有在**確認新流程穩定運作一段時間、且不再需要回退之後**，才會有**額外一次**、
  **另外核准**的清理步驟去：
  1. 移除 `attachments` 陣列欄位。
  2. 刪除**舊的三段路徑** Storage object（新的四段路徑物件是唯一保留的正式版本）。
  - 這個清理步驟執行前，**必須重新跑一次第 13 節的唯讀稽核**，確認所有文件的新舊資料
    仍然一致，才能進行。
- **部分失敗重跑的安全性**：如果某一批遷移「Storage copy 已經成功，但 Firestore 的
  `ready` 文件寫入失敗」(例如腳本在兩步之間當掉)，重跑時：第 11 節第 4 點的「destination
  已存在」分支會被觸發，驗證內容一致後跳過重新複製，直接補寫 Firestore 文件——不需要
  額外的復原邏輯，這正是「確定性 ID + 存在性檢查」這個設計要達成的效果。
- **孤兒 destination object 的偵測**：如果腳本在「複製成功」之後、「寫入 Firestore 之前」
  就徹底中止且從未重跑（不是上面「有重跑」的情況），會留下一個有 Storage object、但沒有
  對應 Firestore `ready` 文件的孤兒。因為 `migrationReservationId` 是從
  `requestId`/`slot`/`source path` 確定性推算出來的，稽核腳本可以對每一筆舊附件重新算出
  「預期的 destination path」，檢查該路徑是否存在 Storage object、但子集合裡沒有對應的
  `ready` 文件——找到就代表是這種孤兒，可以安全地重新觸發「補寫 Firestore」這個步驟(冪等)，
  不需要用「列舉整個 bucket 前綴、看哪些路徑沒有 Firestore 紀錄」這種更貴的方式去猜。

## 13. 遷移前後資料一致性檢查

**修正(第四輪)：只有以下條件全部成立，才能設定 `attachmentsSchemaVersion: 2`**（取代
原本「所有 10 個 slot 都已寫入」這個錯誤敘述——正確條件是「跟舊陣列長度一致」，不是
「固定寫滿 10 個」）：

1. 新子集合裡 `status == 'ready'` 的文件數，**精確等於**舊 `attachments` 陣列的長度
   （範圍 0-10，不是固定 10）。
2. 用到的 slot id 集合，**精確是** `0` 到 `oldAttachments.length - 1`（例如舊陣列有 3 筆，
   slot 就必須精確是 `'0'`、`'1'`、`'2'`，不可以多、不可以少，也不可以跳號）。
3. **不可以為了「湊滿 10 個 slot」而建立空的 slot 文件**——沒有對應舊附件的 slot 就是不
   存在，不是存在但內容為空。
4. 每一筆逐項比對：`name`、`size` 跟來源附件（`attachments` 陣列裡對應 index 的物件）
   完全一致。
5. Destination Storage object 必須存在（不是只檢查 Firestore 文件寫了就好）。
6. Destination object 的 `size`/`md5Hash`(或等效內容指紋) 跟 source object 完全一致
   （見第 11 節第 4 點——這一步在遷移當下已經驗證過一次，這裡的一致性檢查是**獨立
   再驗證一次**，確保沒有在複製之後、切版本之前的空窗期被意外改動過）。
7. `storagePath` 精確符合新的四段格式（`attachments/{requestId}/{reservationId}/
   {objectName}`），且 `reservationId`/`objectName` 分別對應到 `storagePath` 的正確段落。
8. **URL 解出的 path 必須與(新的)`storagePath` 一致**——這裡驗證的是新 `url`/新
   `storagePath` 這一組，不是新舊之間的比對（本輪修正前的敘述誤把這件事跟「新舊
   storagePath 必須相同」混為一談）。
9. **舊陣列是空的（0 筆附件）這個邊界情況**：確認子集合裡**完全沒有** `ready` 或
   `uploading` 狀態的文件之後，才能設定 `attachmentsSchemaVersion: 2`（空陣列對應到「這份
   request 沒有附件」，子集合也必須是真的空的，不是「因為沒有東西要比對就跳過檢查」）。

**全部比對通過才設定 `attachmentsSchemaVersion: 2`**——這是這個欄位唯一的寫入時機，
見第 6 節。

- 額外提供一個唯讀的稽核腳本（不寫入，只讀取+比對+回報），可以在遷移完成後、雙軌並存的
  任何時間點重新執行，找出「陣列與子集合不一致」的文件 id 清單，以及第 12 節提到的孤兒
  destination object 清單。
- 稽核腳本的執行本身（即使是唯讀）如果要對接正式 Firebase 專案，同樣需要另外核准。

## 14. 舊版前端與新版資料的相容性

如果部署後有使用者還在跑舊版前端（快取的 SPA bundle 還沒更新）：

- 舊版前端不認得 `attachmentsSchemaVersion` 欄位，會直接讀 `attachments` 陣列——只要遷移
  階段全程保留、同步維護這個陣列欄位（見第 11 節「遷移批次」只是「寫入子集合」，不代表
  停止維護舊陣列；若後續有人在版本 2 的文件上新增/刪除附件，舊陣列要不要繼續同步是產品
  決策，最簡單的作法是版本 2 之後舊陣列欄位凍結不再更新，並在舊版前端明顯位置有「請更新
  頁面」的提示，這部分屬於實作階段的產品決策，本文件只標注需要決定，不代替決定）。
- 舊版前端在「凍結」之後只會顯示遷移當下的陣列快照，不會顯示錯誤的資料，只是新增/刪除的
  附件不會反映上去，直到使用者重新整理拿到新版 bundle。

## 15. 正式資料操作核准要求

以下任何一項都必須先取得明確的、針對這一項的核准，本文件不構成核准：

- 對正式 Firebase 專案套用新的 `firestore.rules`（子集合驗證規則）
- 部署新的 Cloud Functions（`cleanupIncompleteRequest`、`cleanupOnDelete`、遷移用的
  一次性 function/script、孤兒 Storage 物件清理排程）
- 執行遷移腳本（不管是完整批次或單筆測試），**包含把正式 Storage object 從舊三段路徑
  複製到新四段路徑這個操作本身**（第 11 節）
- 執行任何會寫入正式 `requests` 或其子集合的操作
- 執行唯讀稽核腳本對接正式專案
- 執行清理步驟（移除舊 `attachments` 陣列欄位，以及第 12 節提到的「刪除舊三段路徑
  Storage object」——這是遷移完成、穩定觀察期過後的**另一次**、**獨立**核准，不能沿用
  遷移本身的核准）

本次 PR **不**包含以上任何一項，也不包含前端/Functions 的對應程式碼改動 —— 僅有這份
設計文件。
