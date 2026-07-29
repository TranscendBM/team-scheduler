// 編輯需求時，既有附件「移除」的草稿狀態管理 —— 純函式，不碰 Firestore/Storage。
// 設計原則：使用者點「移除」只改畫面上的草稿狀態(removedKeys)，不會立刻刪檔；
// 真正刪除 Storage 檔案的時機交給呼叫端(RequestNewPage)在 Firestore 更新成功「之後」才執行。
//
// 用 storagePath(沒有的話退回 url)當穩定識別值，不用檔名 —— 檔名可能重複，
// 但同一個 request 底下每個附件的 storagePath 一定是唯一的（上傳時就帶了時間戳後綴）。
export function attachmentKey(att) {
  return att?.storagePath || att?.url || att?.name || ''
}

// 標記為移除：使用者點「移除」
export function markRemoved(removedKeys, att) {
  const key = attachmentKey(att)
  if (!key || removedKeys.includes(key)) return removedKeys
  return [...removedKeys, key]
}

// 取消移除：使用者對已標記移除的附件按「復原」
export function unmarkRemoved(removedKeys, att) {
  const key = attachmentKey(att)
  return removedKeys.filter((k) => k !== key)
}

// 送出時應該保留(寫回 Firestore attachments 欄位)的附件
export function keptAttachments(existingAtts, removedKeys) {
  return existingAtts.filter((a) => !removedKeys.includes(attachmentKey(a)))
}

// 送出成功後應該真的從 Storage 刪除的附件
export function removedAttachments(existingAtts, removedKeys) {
  return existingAtts.filter((a) => removedKeys.includes(attachmentKey(a)))
}

// 送出流程的刪檔順序保證：只有在 writeFn()(Firestore 更新)成功之後，才會呼叫 deleteFn()
// (真的刪除 Storage 上標記移除的檔案)；writeFn 失敗時 deleteFn 完全不會被呼叫，
// 因為這時 Firestore 還在引用那些檔案，刪了就是資料損失。
// 抽成這個小型協調函式，讓「順序保證」本身可以獨立單元測試，不用真的接 Firestore/Storage。
export async function commitWithDeferredDeletion(writeFn, deleteFn) {
  await writeFn()
  await deleteFn()
}
