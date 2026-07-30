# 設計文件：附件搬到子集合（方案 A）— 僅設計，不實作

**狀態：設計草案，尚未實作、未部署、未遷移任何資料。所有正式資料操作（含遷移）都必須
另外取得明確核准後才能執行，本文件本身不構成核准。**

## 為什麼選方案 A

見 `docs/firestore-rules-expression-limit.md` 的完整最小重現：Firestore Rules 的
1000-expression 上限是 **per allow 子句**獨立計算，不是 pooled、也不是拆 match block
就能繞過的。真正的成本驅動是「附件陣列展開驗證最多 10 筆」這個 pattern 本身——即使每筆
只驗證最基本的 3 個欄位，10 筆展開就已經逼近上限，沒有餘裕再驗證 `storagePath` 綁定。

把附件搬到子集合後，**每次寫入只需要驗證「一筆」附件**，不再需要「10 筆展開」這個 pattern，
`requestId` 也直接來自路徑變數（不需要 `split()` 解析字串比對），從根源消除成本驅動因子，
而不是像目前這樣在「附件驗證完整度」跟「1000 上限」之間做取捨。

其餘方案（B/C/D）的比較與why-not，已經在對話中列出，此處不重複；長期方向排序為：
A（本文件）→ 只有 A 完成後 update 仍超限才評估 B → C 不採用（claims 有 token refresh 延遲，
安全撤銷不即時）→ D 不採用（跨 collection 搬移與查詢重寫風險過高）。

## 1. 新資料結構

```
requests/{requestId}                     ← 既有文件，attachments 欄位最終會移除(遷移完成後)
requests/{requestId}/attachments/{slot}  ← 新子集合，slot 只允許 '0' ~ '9'(字串)
```

每個 slot 文件的欄位（對應現有 attachment 物件，逐一驗證變成單一文件驗證）：

```
{
  name: string,          // 檔名，1-300 字元
  url: string,            // Firebase Storage download URL，1-2000 字元
  size: number,           // bytes，0 < size <= 10485760 (10MB)
  storagePath: string,    // 選填；若存在必須是合理長度的字串
  createdAt: Timestamp,   // 該筆附件寫入時間
}
```

`slot` 是文件 id（不是欄位），直接對應目前陣列的 index（0-9）。沒有附件的 slot 不建立
文件（不是建立空文件），所以「目前有幾筆附件」= 該子集合底下實際存在的文件數。

## 2. slot 0-9 的 Rules 驗證方式

```
match /requests/{requestId} {
  // ...既有的 read/create/update/delete，attachments 欄位驗證移除...
}

match /requests/{requestId}/attachments/{slot} {
  allow read: if canReadRequest();  // 沿用 parent 的讀取授權(見下方第 4 點)

  allow create, update: if
    slot in ['0','1','2','3','4','5','6','7','8','9']
    && canEditRequestAttachments(requestId)
    && isValidSingleAttachment(request.resource.data);

  allow delete: if canEditRequestAttachments(requestId);
}

function isValidSingleAttachment(a) {
  return a.name is string && a.name.size() > 0 && a.name.size() <= 300
    && a.url is string && a.url.size() > 0 && a.url.size() <= 2000
    && a.size is number && a.size > 0 && a.size <= 10485760
    && (!('storagePath' in a) || (a.storagePath is string && a.storagePath.size() > 0 && a.storagePath.size() <= 500))
    && a.createdAt == request.time;
}
```

因為每次只驗證一筆（沒有「10 筆展開」的 unrolled pattern），`storagePath` 的
`requestId` 綁定驗證可以直接用路徑變數 `requestId`（來自 `match` 路徑，不是欄位），完全
不需要 `split()`：

```
&& (!('storagePath' in a) || a.storagePath == 'attachments/' + requestId + '/' + a.name)
```

這樣連「storagePath↔requestId 綁定」這項目前在 Rules 層被迫放棄的驗證都可以完整保留，
且成本遠低於現在的 10x-unrolled + 3x `split()` 版本。

## 3. 如何避免超過 10 筆

- Rules 層：`slot` 只允許 `'0'`~`'9'` 這 10 個字串值（above），寫入任何其他 slot id
  一律被拒——這是**結構性**上限，不需要額外的 `count()` 查詢或 `size()` 檢查。
- 前端：建立/新增附件時，先查詢子集合現有文件數，找出第一個空缺的 slot 再寫入；達到
  10 筆時 UI 直接停用上傳按鈕（跟現在的行為一致，只是計數來源從陣列長度改成子集合大小）。
- 因為 slot 上限本身就是 Rules 強制的邊界，即使前端邏輯有 bug 想塞第 11 筆，也會在
  `allow create` 就被擋下（沒有合法的 slot id 可以用）。

## 4. parent request 的讀寫授權

子集合文件的讀取/編輯授權沿用 parent 文件的授權判斷（不重新定義一套邏輯）：

```
function canEditRequestAttachments(requestId) {
  let e = email();
  let parentExists = exists(/databases/$(database)/documents/requests/$(requestId));
  return signedIn() && e != '' && parentExists
    && let parent = get(/databases/$(database)/documents/requests/$(requestId)).data
    && (
      // 提交人：需求仍在 pending 時可以編輯附件(對應現行 update 規則的提交人分支)
      (parent.submittedBy == e && parent.status == 'pending')
      // manager 事後編輯已審核需求時，附件不可變(現行規則本來就沒開放這條路徑改附件，維持一致)
    );
}
```

（實際實作時要注意 Rules 語言 `let` 的用法限制，上面是示意；真正落地時要重新驗證運算式
成本，但因為只涉及一次 `get()` + 幾個欄位比對，預期遠低於 1000。）

`canReadRequest()` 直接沿用既有函式（parent 文件能讀，子集合就能讀）。

## 5. 前端讀寫流程

- **建立需求**（`RequestNewPage.jsx`）：目前流程是 `addDoc` 建立 `attachments: []` 的
  文件 → 上傳檔案到 Storage → `updateDoc` 寫回完整 `attachments` 陣列。改成：`addDoc`
  建立文件（不再需要 `attachments` 欄位）→ 上傳檔案到 Storage（路徑不變：
  `attachments/{requestId}/{safeFileName}`）→ 對每個上傳成功的檔案各自
  `setDoc(doc(db, 'requests', requestId, 'attachments', String(slotIndex)), {...})`。
- **讀取/顯示**（`RequestDetailModal.jsx`、`ReviewPage.jsx`、`RequestsTablePage.jsx`）：
  改成對子集合下 `onSnapshot`/`getDocs`，依 slot id 排序後組回陣列形狀（沿用現有的
  `src/utils/attachmentUrl.js` 驗證邏輯，不需要改）。
- **刪除單筆附件**：直接 `deleteDoc` 該 slot 文件 + `deleteObject` 對應的 Storage 物件，
  不再需要「整個陣列重寫、少一筆」的做法。
- **回滾（建立失敗時）**：現行 `canDeleteRequestAs` 用 `attachments.size() == 0` 判斷
  「這是半成品」，改成子集合底下沒有任何文件（用 `!exists()` 檢查任一 slot，或維持一個
  額外的 `attachmentCount` 欄位由 Cloud Function 或 client 同步維護，需在實作階段決定）。

## 6. Functions 如何取得附件

`functions/index.js` 目前讀 `after.attachments`（Firestore trigger 的文件快照）的地方：
`buildHtml`（通知信）、`previewFile`（下載代理）、`resolveAttachmentPath`。這些都是在
文件 **update 事件**觸發時才需要附件清單，改成：

- `notifyOnAssign`/`notifyOnReassign`：在拿到 `event.params.id` 後，額外
  `db.collection('requests').doc(id).collection('attachments').get()`，組回陣列傳給
  `buildHtml`（`buildHtml` 的簽名/驗證邏輯不必改，因為它接收的還是一個「附件物件陣列」，
  只是來源從 `after.attachments` 換成子集合查詢結果）。
- `previewFile`：目前用 `req.path` 帶的 `docId/附件index/token前12碼` 找到附件，
  `附件index` 直接對應新的子集合 slot id，改成 `db.collection('requests').doc(docId)
  .collection('attachments').doc(idxStr).get()` 取代原本 `snap.data().attachments[idx]`。

## 7. 舊 attachments array 與新 subcollection 雙讀期間

遷移不能是「一次切換」，需要一段雙讀期間：

- **雙寫階段**：前端/Functions 同時寫入舊 `attachments` 陣列欄位跟新子集合（每次新增/刪除
  附件都寫兩份），確保這段期間不管讀哪一份都是最新資料。
- **讀取優先序**：讀取時優先讀子集合；子集合為空但 parent 文件的 `attachments` 陣列非空時，
  視為「尚未遷移的舊資料」，退回讀陣列（並可選擇性地 lazy-migrate：讀到的當下順便把陣列
  內容寫進子集合）。
- **Rules 雙軌**：過渡期間 `allow update` 對 parent 文件的 `attachments` 欄位驗證維持現狀
  （不能砍，否則舊資料/雙寫階段會被擋），子集合另外開一條新規則，兩者並存到遷移完成。

## 8. 遷移批次與可重試設計

- 用一次性 Cloud Function（`onCall`，manager-only，或一次性 script 透過 Admin SDK 執行，
  **需另外核准**）分批處理：每批用 Firestore 查詢抓 N 筆（例如 50 筆）尚未標記
  `attachmentsMigrated: true` 的 `requests` 文件，對每一筆：
  1. 讀 `attachments` 陣列
  2. 對每個 index 寫入對應 slot 子集合文件（`set`，非 `add`，天然幂等 —— 同一個 slot
     重複寫入結果一致，可安全重試）
  3. 成功後把該筆文件標記 `attachmentsMigrated: true`
- 用 `attachmentsMigrated` 欄位當作 checkpoint：整個遷移可以中斷、重跑，只會重複處理
  「還沒標記完成」的文件，不會對已完成的文件重複寫入造成副作用（因為是幂等的 `set`）。
- 每批之間有明確的成功/失敗計數回報，失敗的文件 id 記錄下來，方便針對性重跑，不需要整批
  重來。

## 9. Rollback 方法

- 因為遷移階段是「雙寫」而不是「搬移後刪除」，舊 `attachments` 陣列欄位在整個遷移期間
  （含遷移完成後的一段觀察期）都完整保留，不會被覆蓋或刪除。
- Rollback 只需要：(1) 前端/Functions 讀取邏輯切回只讀舊陣列欄位、只寫舊陣列欄位；
  (2) 保留（不刪除）已寫入的子集合文件，之後要重新遷移可以直接複用，不用重新處理。
- 只有在確認新流程穩定運作一段時間、且不再需要回退之後，才會有**額外一次**、**另外核准**
  的清理步驟去移除 `attachments` 陣列欄位跟過渡期的雙軌 Rules。

## 10. 遷移前後資料一致性檢查

- 遷移腳本每處理完一筆文件，立即比對：子集合的文件數是否等於原陣列長度；逐一比對
  `name`/`url`/`size`/`storagePath` 欄位是否跟陣列裡對應 index 的物件完全一致。
- 額外提供一個唯讀的稽核腳本（不寫入，只讀取+比對+回報），可以在遷移完成後、雙寫階段
  的任何時間點重新執行，找出「陣列與子集合不一致」的文件 id 清單。
- 稽核腳本的執行本身（即使是唯讀）如果要對接正式 Firebase 專案，同樣需要另外核准。

## 11. 舊版前端與新版資料的相容性

如果部署後有使用者還在跑舊版前端（快取的 SPA bundle 還沒更新）：

- 雙寫階段內，舊版前端讀寫的是 `attachments` 陣列欄位，因為雙寫機制仍然同步寫入陣列，
  舊版前端可以正常運作，不會看到資料缺漏。
- 雙寫階段結束、陣列欄位停止更新之後，舊版前端會讀到「凍結在遷移當下」的陣列快照（不會
  再更新），但不會顯示錯誤的資料 —— 只是新增/刪除的附件不會反映在舊版前端上，直到使用者
  重新整理拿到新版 bundle。

## 12. 正式資料操作核准要求

以下任何一項都必須先取得明確的、針對這一項的核准，本文件不構成核准：

- 對正式 Firebase 專案套用新的 `firestore.rules`（子集合驗證規則）
- 執行遷移腳本（不管是完整批次或單筆測試）
- 執行任何會寫入正式 `requests` 或其子集合的操作
- 執行清理步驟（移除舊 `attachments` 陣列欄位）

本次 PR **不**包含以上任何一項，也不包含前端/Functions 的對應程式碼改動 —— 僅有這份
設計文件。
