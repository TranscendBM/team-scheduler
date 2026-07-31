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
（`'attachments/' + requestId + '/' + objectName`，只跟 `requestId`/`objectName` 有關，
不需要等實際上傳完成），所以不必留到 finalize 才寫入——這樣 reservation 文件本身就能被
Rules 完整驗證路徑綁定，不用等 finalize 那一刻。真正只有上傳完成後才知道的欄位只有
`url`(下載網址，Storage 產生時才有)跟 `size`(要實際讀到檔案才知道)。另外新增
`reservationId`（見第 6 節的競態修正——每次「建立新 reservation」或「接管一個逾時的舊
reservation」都要產生一個全新、不可預測的值，finalize/delete 都要比對這個欄位，防止舊
uploader 晚到時搞壞新的 reservation）：

```
{
  name: string,             // 原始顯示名稱(使用者上傳時的檔名，可能含中文/空格)，僅供 UI 顯示，
                            // reservation 建立當下就知道(來自 File 物件)，不是 finalize 才有
  objectName: string,      // Storage 實際檔名(safeFileName 產生的 ASCII 安全名稱)，
                            // 唯一可以拿來組 storagePath 的欄位；reservation 建立當下就決定
  storagePath: string,      // attachments/{requestId}/{objectName}，reservation 建立當下就
                            // 完整寫入(見上方說明)，不是選填、也不是 finalize 才補上的欄位
  url: string,              // Firebase Storage download URL，1-2000 字元；只有 finalize
                            // (uploading -> ready)這一步才會出現
  size: number,             // bytes，0 < size <= 10485760 (10MB)；只有 finalize 才會出現
  createdAt: Timestamp,     // reservation 建立時間(見第 6 節)
  createdBy: string,        // reservation 建立者 email
  reservationId: string,    // 每次 create(初次保留)或 update(逾時接管)都要換成全新、不可
                            // 預測的值(例如前端產生的 UUID)，finalize/delete/cleanup 都要
                            // 比對這個欄位是否跟自己記得的一致，見第 6 節
  status: 'uploading' | 'ready', // 見第 6 節的 reservation 流程
}
```

**`name` 絕對不可以用來組 Storage path**——它只是顯示用的原始檔名，Rules 驗證
`storagePath`/`objectName` 的一致性時完全不看 `name` 欄位。

`slot` 是文件 id（不是欄位），直接對應目前陣列的 index（0-9）。沒有附件的 slot 不建立
文件（不是建立空文件）。**但「目前有幾筆附件」不能單純用「子集合底下有幾個文件」判斷**——
見第 6 節，`status: 'uploading'` 的 reservation 文件也會佔用一個 slot，計數時需要決定是否
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
  allow read: if canReadRequest();  // 沿用 parent 的讀取授權(見下方第 5 節)

  // create：這個 slot 目前不存在——初次 reservation，只能建立 status:'uploading'(見第 6 節)
  allow create: if
    slot in ['0','1','2','3','4','5','6','7','8','9']
    && canEditRequestAttachments(requestId)
    && isValidUploadingReservation(request.resource.data, requestId);

  // update：兩種情況(見第 6 節的完整時序)——
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

  // delete：見第 6 節——Rules 的 allow delete 沒有 request.resource 可以比對「呼叫端預期的
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
// name 只驗證型別/長度，不參與任何路徑比對。
function isValidAttachmentIdentity(a, requestId) {
  return a.name is string && a.name.size() > 0 && a.name.size() <= 300
    && a.objectName is string && a.objectName.size() > 0 && a.objectName.size() <= 200
    && a.objectName.matches('^[A-Za-z0-9._-]{1,200}$')
    && a.storagePath is string
    && a.storagePath == 'attachments/' + requestId + '/' + a.objectName
    && a.reservationId is string && a.reservationId.size() > 0 && a.reservationId.size() <= 100
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
- `storagePath` 必須精確等於 `'attachments/' + requestId + '/' + objectName`（`objectName`
  必須等於 `storagePath` 最後一段——這裡直接用字串相等表達，不需要額外 `split()` 反查）。
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
- 前端：計數時把 `status` 是 `'uploading'` 或 `'ready'` 的 slot 都算進「已佔用」（見第 6
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

`canReadRequest()` 直接沿用既有函式（parent 文件能讀，子集合就能讀）。

## 5. schemaVersion：明確版本旗標，取代「子集合是否為空」的判斷

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
- 這個欄位**只能在遷移腳本完成「所有 10 個 slot 都已寫入且跟舊陣列逐項比對一致」之後**才
  設定成 `2`（見第 11 節的一致性檢查）——不是遷移腳本開始處理就設，是驗證通過才設，這是
  這個欄位唯一的寫入時機。
- **Rollback 時如何恢復讀取來源**：把該文件的 `attachmentsSchemaVersion` 寫回 `1`（或整個
  刪除這個欄位）。因為遷移階段全程保留舊陣列欄位不刪除（見第 12 節），這個回退是單純的
  欄位寫入，不需要任何資料搬回去，前端/Functions 的讀取邏輯看到 `1` 就會自動切回讀舊陣列。
  子集合裡已經遷移好的文件不需要清掉，之後要重新切回版本 2 可以直接複用。

## 6. slot 的 reservation 流程（取代「先查空 slot 再 setDoc」的競態設計）

**原草稿的競態問題**：「前端查詢空 slot → 找第一個空位 → setDoc」——兩個並行的客戶端
（例如使用者連續點兩次上傳，或兩個分頁）可能查到同一個空 slot，後寫者會覆蓋前者的
`setDoc`，前者的 Storage 物件就變成沒有任何 Firestore 文件指向的孤兒物件。

**第一輪修正的殘留問題**：第一輪把「stale takeover」也寫成 transaction `create()`——但
`create()` 的語意是「這個文件目前不存在」，一個 stale 的 `uploading` reservation文件
**是存在的**（只是逾時），對已存在的文件呼叫 `create()` 會直接失敗，不會有任何「接管」
效果。這一輪修正：初次 reservation 用 `create()`，接管 stale reservation 必須用
`update()`，且兩者都要靠一個全新、不可預測的 `reservationId` 來防止「舊 uploader 晚到」
把新的 reservation 弄壞。

**修正設計：reservation → upload → finalize 三階段（貫穿 `reservationId`）**

1. **初次 Reservation（Firestore transaction，`create()`）**：在 transaction 內先 `get`
   該 slot 文件，確認不存在，`create()`：
   ```
   {
     objectName, name, storagePath,               // 見第 1 節，這些欄位建立當下就完整已知
     createdAt: serverTimestamp(), createdBy: email(),
     reservationId: crypto.randomUUID(),           // 前端產生，全新、不可預測
     status: 'uploading',
   }
   ```
   （這時還沒有 `url`/`size`，因為檔案還沒上傳；把這次產生的 `reservationId` 存在這個
   上傳流程的本地變數裡，後面 finalize/rollback 都要用它。）
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
   `create()` 語意本身保證——transaction 讀到「不存在」才能 `create()`，兩個並行
   transaction 對同一個不存在的文件都想 `create()` 時，Firestore 會讓其中一個因為版本
   衝突而重試/失敗，不是應用層邏輯自己判斷。
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
10. **Firestore transaction 跟 Storage upload 沒辦法形成單一跨服務的原子交易**——這是
    Firestore/Storage 分屬不同服務的根本限制，不是這個設計的缺陷。因此失敗補償
    **必須是冪等、可重試、且帶著 `reservationId` 一起判斷**：
    - 刪除一個不存在的 reservation 文件、或刪除一個不存在的 Storage 物件，都必須是
      no-op（不噴錯），這樣補償邏輯本身可以安全地重試任意次。
    - 補償邏輯本身失敗（例如刪除 Storage 物件時網路斷線）時，要能重新觸發（前端重試按鈕，
      或前面提到的排程清理 Function 一併處理「有孤兒 Storage 物件但沒有對應 reservation」
      的情況——這需要列出 `attachments/{requestId}/` 底下的 Storage 物件，比對 Firestore
      子集合，抓出不一致的孤兒物件並清除，是第 8 點排程清理 Function 的延伸工作項目）。
      每次重試補償都要重新用第 9 點的 transaction 前置條件確認 `reservationId` 仍然相符，
      不能假設「我第一次檢查過就永遠有效」。

**時序案例 1：uploader A 逾時，B 接管，A 晚到才 finalize**

| 時間 | 事件 |
|---|---|
| t=0 | A 對 slot `3` 做初次 reservation：`create()`，`reservationId=RID_A`，`status:'uploading'` |
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

兩個案例都證明：**只要 finalize 明確帶上 `reservationId`、cleanup 一定經過「transaction 內
先比對 `reservationId` 再決定要不要動作」這兩個實作前提成立，舊 uploader 晚到就不可能
finalize、覆蓋或刪除新的 reservation**——這兩個前提本身是這個設計唯一的正確性基礎，必須在
實作/程式碼審查階段明確驗收，不能只看 Rules 邏輯就假設一定安全。

## 7. 前端讀寫流程

- **建立需求**（`RequestNewPage.jsx`）：`addDoc` 建立文件（不需要 `attachments` 欄位，新
  文件直接是 `attachmentsSchemaVersion: 2`）→ 對每個要上傳的檔案走第 6 節的
  reservation → upload → finalize 流程。
- **讀取/顯示**（`RequestDetailModal.jsx`、`ReviewPage.jsx`、`RequestsTablePage.jsx`）：先
  讀 parent 文件的 `attachmentsSchemaVersion`，`1` 就讀舊陣列欄位，`2` 就對子集合下
  `onSnapshot`/`getDocs`（只顯示 `status == 'ready'` 的附件，`uploading` 的顯示為「上傳中」
  狀態），依 slot id 排序後組回陣列形狀（沿用現有的 `src/utils/attachmentUrl.js` 驗證邏輯，
  不需要改）。
- **刪除單筆「已完成」附件**（使用者主動點刪除一個 `status == 'ready'` 的附件）：直接
  `deleteDoc` 該 slot 文件 + `deleteObject` 對應的 Storage 物件（用 `storagePath` 定位，
  不是用 `name`）——這是使用者明確的操作，不涉及 reservation 競態，不需要走第 6 節第 9 點
  的 transaction 比對流程；不再需要「整個陣列重寫、少一筆」的做法。
- **清理自己失敗的 reservation**（`status == 'uploading'` 的半成品，因為自己上傳失敗要
  rollback）：**不是**直接 `deleteDoc`，必須走第 6 節第 9 點的 transaction 前置條件（先比對
  `reservationId` 是否還是自己記得的那個值，不符合就 no-op），避免刪到已經被別人接管的
  reservation。

## 8. Functions 如何取得附件

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

## 9. 半成品文件的清理 / 回滾設計（方案比較，選定建議方案）

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
     （第 6 節第 8 點提到的孤兒清理排程）之後重新掃描補clean。
  4. **順序與失敗策略**：先刪 Storage 物件、成功後再刪 Firestore 子文件（不是反過來）——
     如果反過來先刪 Firestore 子文件、Storage 刪除又失敗，會留下「沒有任何 Firestore 紀錄
     指向、但實際存在」的孤兒 Storage 物件，且因為 Firestore 紀錄已經沒了，之後的排程
     清理邏輯不容易找到它（除非額外去列舉整個 `attachments/` bucket 前綴，比對哪些路徑
     沒有對應的 Firestore 文件——這是可行的，但成本比「Firestore 文件還在、只是 Storage
     沒刪乾淨」的情況高，所以選擇先刪 Storage、Firestore 紀錄留到最後一步才刪，讓「有
     紀錄但清理未完成」是唯一需要重試處理的中間狀態）。

## 10. 遷移批次與可重試設計

- 用一次性 Cloud Function（`onCall`，manager-only，或一次性 script 透過 Admin SDK 執行，
  **需另外核准**）分批處理：每批用 Firestore 查詢抓 N 筆（例如 50 筆）
  `attachmentsSchemaVersion` 不是 `2` 的 `requests` 文件，對每一筆：
  1. 讀 `attachments` 陣列。
  2. 對每個 index 寫入對應 slot 子集合文件（`set`，非 `add`，天然幂等——同一個 slot
     重複寫入結果一致，可安全重試），`objectName` 從舊資料的 `storagePath` 反解最後一段
     （舊資料沒有獨立的 `objectName` 欄位，用 `storagePath.split('/')` 取最後一段；沒有
     `storagePath` 的舊資料用 `derivePathFromUrl` 同等邏輯反推，跟現行前端
     `RequestNewPage.jsx` 的既有備援邏輯一致）。
  3. 逐項比對子集合寫入結果跟原陣列是否一致（見第 11 節）。
  4. 全部一致後，才把該筆文件的 `attachmentsSchemaVersion` 設成 `2`。
- 用 `attachmentsSchemaVersion`（不是額外的 `attachmentsMigrated` 布林欄位——兩者擇一，
  這裡統一用前者）當作 checkpoint：整個遷移可以中斷、重跑，只會重複處理「還不是版本 2」
  的文件，不會對已完成的文件重複寫入造成副作用（因為子集合寫入是幂等的 `set`）。
- 每批之間有明確的成功/失敗計數回報，失敗的文件 id 記錄下來，方便針對性重跑，不需要整批
  重來。

## 11. Rollback 方法（整體遷移層級）

- 因為遷移階段全程保留舊 `attachments` 陣列欄位（不會因為遷移完成就刪除，刪除是額外一次
  核准的清理步驟，見第 14 節），rollback 只需要：
  1. 把已遷移文件的 `attachmentsSchemaVersion` 寫回 `1`（見第 5 節「Rollback 時如何恢復
     讀取來源」——前端/Functions 的讀取邏輯看到 `1` 就自動切回讀舊陣列，不需要搬任何資料）。
  2. 保留（不刪除）已寫入的子集合文件，之後要重新遷移可以直接複用，不用重新處理。
- 只有在確認新流程穩定運作一段時間、且不再需要回退之後，才會有**額外一次**、**另外核准**
  的清理步驟去移除 `attachments` 陣列欄位。

## 12. 遷移前後資料一致性檢查

- 遷移腳本每處理完一筆文件，立即比對：子集合的 `ready` 文件數是否等於原陣列長度；逐一
  比對 `name`/`url`/`size`/`storagePath` 欄位是否跟陣列裡對應 index 的物件完全一致
  （`objectName` 從 `storagePath`/`url` 反解，見第 10 節）。**全部比對通過才設定
  `attachmentsSchemaVersion: 2`**——這是這個欄位唯一的寫入時機，見第 5 節。
- 額外提供一個唯讀的稽核腳本（不寫入，只讀取+比對+回報），可以在遷移完成後、雙軌並存的
  任何時間點重新執行，找出「陣列與子集合不一致」的文件 id 清單。
- 稽核腳本的執行本身（即使是唯讀）如果要對接正式 Firebase 專案，同樣需要另外核准。

## 13. 舊版前端與新版資料的相容性

如果部署後有使用者還在跑舊版前端（快取的 SPA bundle 還沒更新）：

- 舊版前端不認得 `attachmentsSchemaVersion` 欄位，會直接讀 `attachments` 陣列——只要遷移
  階段全程保留、同步維護這個陣列欄位（見第 10 節「遷移批次」只是「寫入子集合」，不代表
  停止維護舊陣列；若後續有人在版本 2 的文件上新增/刪除附件，舊陣列要不要繼續同步是產品
  決策，最簡單的作法是版本 2 之後舊陣列欄位凍結不再更新，並在舊版前端明顯位置有「請更新
  頁面」的提示，這部分屬於實作階段的產品決策，本文件只標注需要決定，不代替決定）。
- 舊版前端在「凍結」之後只會顯示遷移當下的陣列快照，不會顯示錯誤的資料，只是新增/刪除的
  附件不會反映上去，直到使用者重新整理拿到新版 bundle。

## 14. 正式資料操作核准要求

以下任何一項都必須先取得明確的、針對這一項的核准，本文件不構成核准：

- 對正式 Firebase 專案套用新的 `firestore.rules`（子集合驗證規則）
- 部署新的 Cloud Functions（`cleanupIncompleteRequest`、`cleanupOnDelete`、遷移用的
  一次性 function/script、孤兒 Storage 物件清理排程）
- 執行遷移腳本（不管是完整批次或單筆測試）
- 執行任何會寫入正式 `requests` 或其子集合的操作
- 執行唯讀稽核腳本對接正式專案
- 執行清理步驟（移除舊 `attachments` 陣列欄位）

本次 PR **不**包含以上任何一項，也不包含前端/Functions 的對應程式碼改動 —— 僅有這份
設計文件。
