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

```
{
  name: string,            // 原始顯示名稱(使用者上傳時的檔名，可能含中文/空格)，僅供 UI 顯示
  objectName: string,      // Storage 實際檔名(safeFileName 產生的 ASCII 安全名稱)，
                            // 唯一可以拿來組 storagePath 的欄位
  url: string,              // Firebase Storage download URL，1-2000 字元
  size: number,             // bytes，0 < size <= 10485760 (10MB)
  storagePath: string,      // attachments/{requestId}/{objectName}，寫入時就是這個格式，
                            // 不是「選填、可能跟 objectName 對不上」的欄位
  createdAt: Timestamp,     // reservation 建立時間(見第 6 節)
  createdBy: string,        // reservation 建立者 email，供除錯/稽核用
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

```
match /requests/{requestId} {
  // ...既有的 read/create/update/delete，attachments 欄位驗證移除...
}

match /requests/{requestId}/attachments/{slot} {
  allow read: if canReadRequest();  // 沿用 parent 的讀取授權(見下方第 5 節)

  // create：這個 slot 目前不存在(reservation 的第一步，見第 6 節)，只能建立 status:'uploading'
  allow create: if
    slot in ['0','1','2','3','4','5','6','7','8','9']
    && canEditRequestAttachments(requestId)
    && request.resource.data.status == 'uploading'
    && isValidSingleAttachment(request.resource.data, requestId);

  // update：只允許「uploading → ready」這個 finalize 動作(見第 6 節第 3 點)。
  // 已經是 ready 的 slot 不可被一般 client 覆蓋——要換附件必須先 delete 再走一次完整
  // 的 create(reservation) 流程，不能直接 update 一個 ready 的文件。
  allow update: if
    canEditRequestAttachments(requestId)
    && resource.data.status == 'uploading'
    && request.resource.data.status == 'ready'
    && isValidSingleAttachment(request.resource.data, requestId);
    // 實作時要照 docs/firestore-rules-expression-limit.md 的方法論，用真實 Emulator
    // 對這兩條子句實測運算式成本，不能只憑閱讀規則推論「單一 slot 一定遠低於 1000」。

  allow delete: if canEditRequestAttachments(requestId);
}

// 驗證單一附件物件：objectName 才是唯一可以拿來組 storagePath 的欄位，
// name 只驗證型別/長度，不參與任何路徑比對。
function isValidSingleAttachment(a, requestId) {
  return a.name is string && a.name.size() > 0 && a.name.size() <= 300
    && a.objectName is string && a.objectName.size() > 0 && a.objectName.size() <= 200
    && a.objectName.matches('^[A-Za-z0-9._-]{1,200}$')
    && a.url is string && a.url.size() > 0 && a.url.size() <= 2000
    && a.size is number && a.size > 0 && a.size <= 10485760
    && a.storagePath is string
    && a.storagePath == 'attachments/' + requestId + '/' + a.objectName
    && a.status in ['uploading', 'ready'];
}
```

因為每次只驗證一筆（沒有「10 筆展開」的 unrolled pattern），`storagePath` 的
`requestId` 綁定驗證可以直接用路徑變數 `requestId`（來自 `match` 路徑，不是欄位），完全
不需要 `split()`，也不需要在「驗證完整度」跟「1000 上限」之間取捨。

**驗證清單（對應需求逐項確認）**：
- `objectName` 是 1-200 字元、只允許 `[A-Za-z0-9._-]`。
- `name` 只供顯示，Rules 完全不用它組任何路徑。
- `storagePath` 必須精確等於 `'attachments/' + requestId + '/' + objectName`（`objectName`
  必須等於 `storagePath` 最後一段——這裡直接用字串相等表達，不需要額外 `split()` 反查）。
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

**修正設計：reservation → upload → finalize 三階段**

1. **Reservation（Firestore transaction）**：在 transaction 內先 `get` 該 slot 文件，確認
   不存在（或存在但 `status == 'uploading'` 且已經 stale，見下方第 8 點），transaction 內
   `create`：
   ```
   { objectName, createdAt: serverTimestamp(), createdBy: email(), status: 'uploading' }
   ```
   （這時還沒有 `url`/`size`/`storagePath`，因為檔案還沒上傳。）
2. **Transaction 成功後才上傳 Storage**——reservation 失敗（slot 已被別人搶走）就換下一個
   slot 重試，不會上傳到會變成孤兒的路徑。
3. **上傳成功後**，用 `update`（不是 `set` 整份覆蓋）把 `url`/`size`/`storagePath` 補上，
   `status` 改成 `'ready'`。
4. **上傳失敗時**：刪除該 slot 的 reservation 文件（釋出這個 slot），並清除已經上傳成功
   的 Storage 物件（如果上傳有部分成功，例如 resumable upload 中斷）。
5. **已經是 `ready` 的 slot，不允許一般 client 任意覆蓋**——第 2 節的 Rules 已經示意這點，
   `ready` 之後要換掉這個附件，必須先 `delete` 再走一次完整的 reservation 流程，不能直接
   `update` 一個 `ready` 的文件。
6. **同一個 slot 的並行 reservation 只能有一個成功**：靠 Firestore transaction 的 `create`
   語意本身保證——transaction 讀到「不存在」才能 `create`，兩個並行 transaction 對同一個
   不存在的文件都想 `create` 時，Firestore 會讓其中一個因為版本衝突而重試/失敗，不是
   應用層邏輯自己判斷。
7. **stale `uploading` reservation 的清理策略與逾時**：如果客戶端在上傳中途斷線/關閉分頁，
   會留下一個永遠停在 `status: 'uploading'` 的 slot，永久佔用。策略：
   - reservation 文件的 `createdAt` 超過某個逾時（例如 10 分鐘）且仍是 `uploading`，視為
     stale。
   - 由前端在「查詢可用 slot」時順便判斷：查到的 slot 是 `uploading` 且已超時，就先嘗試
     用 transaction 把它「接管」（同樣的 create-if-checked 邏輯，只是條件從「不存在」放寬
     成「不存在，或存在但 uploading 且已超時」），成功就可以使用這個 slot；也可以額外用
     一個排程 Cloud Function 定期清理過期的 `uploading` reservation（不依賴前端一定會
     碰到才清理）。
8. **Firestore transaction 跟 Storage upload 沒辦法形成單一跨服務的原子交易**——這是
   Firestore/Storage 分屬不同服務的根本限制，不是這個設計的缺陷。因此失敗補償
   （第 4 點的「刪 reservation + 清 Storage 物件」）**必須是冪等、可重試的**：
   - 刪除一個不存在的 reservation 文件、或刪除一個不存在的 Storage 物件，都必須是
     no-op（不噴錯），這樣補償邏輧本身可以安全地重試任意次。
   - 補償邏輯本身失敗（例如刪除 Storage 物件時網路斷線）时，要能重新觸發（前端重試按鈕，
     或前面提到的排程清理 Function 一併處理「有孤兒 Storage 物件但沒有對應 reservation」
     的情況——這需要列出 `attachments/{requestId}/` 底下的 Storage 物件，比對 Firestore
     子集合，抓出不一致的孤兒物件並清除，是第 7 點排程清理 Function 的延伸工作項目）。

## 7. 前端讀寫流程

- **建立需求**（`RequestNewPage.jsx`）：`addDoc` 建立文件（不需要 `attachments` 欄位，新
  文件直接是 `attachmentsSchemaVersion: 2`）→ 對每個要上傳的檔案走第 6 節的
  reservation → upload → finalize 流程。
- **讀取/顯示**（`RequestDetailModal.jsx`、`ReviewPage.jsx`、`RequestsTablePage.jsx`）：先
  讀 parent 文件的 `attachmentsSchemaVersion`，`1` 就讀舊陣列欄位，`2` 就對子集合下
  `onSnapshot`/`getDocs`（只顯示 `status == 'ready'` 的附件，`uploading` 的顯示為「上傳中」
  狀態），依 slot id 排序後組回陣列形狀（沿用現有的 `src/utils/attachmentUrl.js` 驗證邏輯，
  不需要改）。
- **刪除單筆附件**：直接 `deleteDoc` 該 slot 文件 + `deleteObject` 對應的 Storage 物件（用
  `storagePath` 定位，不是用 `name`），不再需要「整個陣列重寫、少一筆」的做法。

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
     （第 6 節第 7 點提到的孤兒清理排程）之後重新掃描補clean。
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
