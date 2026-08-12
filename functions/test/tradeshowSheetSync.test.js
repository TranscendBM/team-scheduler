// 純函式測試，不連任何 Firebase 服務、不打真的網路請求。
// 涵蓋秀展 Google Sheet 同步的 CSV 解析／日期解析／表頭防呆／欄位對應邏輯。
// 部分測試用例直接取自對正式 Sheet 實測 curl 抓到的真實資料格式(見開發時的 curl 紀錄)，
// 不是憑空捏造的邊界案例。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  looksLikeTradeshowHeader,
  parseSheetDateRange,
  mapSheetRowToProject,
} from '../index.js'

test('parseCsv：一般欄位用逗號分隔，欄位內含逗號用引號包住不會被拆開', () => {
  const rows = parseCsv('a,b,c\n"6,300,000",x,y')
  assert.deepEqual(rows, [['a', 'b', 'c'], ['6,300,000', 'x', 'y']])
})

test('parseCsv：欄位內有換行(Sheet 表頭真實情況)仍算同一個欄位，不會多切一列', () => {
  const rows = parseCsv('"Office\nin charge","Date"\n"US","1/11~1/13"')
  assert.deepEqual(rows, [['Office\nin charge', 'Date'], ['US', '1/11~1/13']])
})

test('parseCsv：引號內的雙引號用 "" 跳脫', () => {
  const rows = parseCsv('"say ""hi""",b')
  assert.deepEqual(rows[0], ['say "hi"', 'b'])
})

test('parseCsv：CRLF 換行不會多算出一列空白', () => {
  const rows = parseCsv('a,b\r\nc,d\r\n')
  assert.deepEqual(rows, [['a', 'b'], ['c', 'd']])
})

test('parseCsv：空字串回傳空陣列，不會噴錯', () => {
  assert.deepEqual(parseCsv(''), [])
})

test('parseCsv：最後一行沒有結尾換行也會被收進去', () => {
  const rows = parseCsv('a,b\nc,d')
  assert.deepEqual(rows, [['a', 'b'], ['c', 'd']])
})

test('looksLikeTradeshowHeader：正常表頭(第二欄 Status、第三欄 Date)通過', () => {
  assert.equal(looksLikeTradeshowHeader(['', 'Status', 'Date', 'Office']), true)
})

test('looksLikeTradeshowHeader：分頁不存在時 Google 端 fallback 回別的分頁內容，表頭對不上要擋下來', () => {
  // 實測「TS Attend 2099」(不存在)會 fallback 回「秀展數量與目標」分頁，表頭長這樣：
  assert.equal(
    looksLikeTradeshowHeader(['', '', 'HQ\nCOMPUTEX ', '分公司 TW', 'US']),
    false,
  )
})

test('looksLikeTradeshowHeader：表頭是 undefined/空陣列也安全回傳 false，不會噴錯', () => {
  assert.equal(looksLikeTradeshowHeader(undefined), false)
  assert.equal(looksLikeTradeshowHeader([]), false)
})

test('parseSheetDateRange：波浪號分隔(1/11~1/13)', () => {
  assert.deepEqual(parseSheetDateRange('1/11~1/13', 2026), { startDate: '2026-01-11', endDate: '2026-01-13' })
})

test('parseSheetDateRange：連字號分隔(10/1-10/2，正式 Sheet 實測兩種分隔符都有出現)', () => {
  assert.deepEqual(parseSheetDateRange('10/1-10/2', 2026), { startDate: '2026-10-01', endDate: '2026-10-02' })
})

test('parseSheetDateRange：全形波浪號也接受', () => {
  assert.deepEqual(parseSheetDateRange('3/10～3/12', 2026), { startDate: '2026-03-10', endDate: '2026-03-12' })
})

test('parseSheetDateRange：單一日期(沒有範圍)，起訖日相同', () => {
  assert.deepEqual(parseSheetDateRange('5/1', 2026), { startDate: '2026-05-01', endDate: '2026-05-01' })
})

test('parseSheetDateRange：跨年(結束月份小於起始月份)，結束日期算下一年', () => {
  assert.deepEqual(parseSheetDateRange('12/30~1/2', 2026), { startDate: '2026-12-30', endDate: '2027-01-02' })
})

test('parseSheetDateRange：格式不符/空字串一律回傳 null，不會噴錯', () => {
  assert.equal(parseSheetDateRange('', 2026), null)
  assert.equal(parseSheetDateRange(undefined, 2026), null)
  assert.equal(parseSheetDateRange('目標', 2026), null) // 表頭防呆失效時可能混進來的髒資料
  assert.equal(parseSheetDateRange('1', 2026), null)
  assert.equal(parseSheetDateRange('13/1~13/5', 2026), null) // 月份不合法
})

test('parseSheetDateRange：容忍分隔符前後有空白', () => {
  assert.deepEqual(parseSheetDateRange(' 1/11 ~ 1/13 ', 2026), { startDate: '2026-01-11', endDate: '2026-01-13' })
})

test('parseSheetDateRange：結束日只有「日」沒有「月」的簡寫，沿用起始月份(正式 Sheet 2025 分頁有實際案例)', () => {
  assert.deepEqual(parseSheetDateRange('4/23~24', 2025), { startDate: '2025-04-23', endDate: '2025-04-24' })
  assert.deepEqual(parseSheetDateRange('5/13-15', 2025), { startDate: '2025-05-13', endDate: '2025-05-15' })
})

// 對應正式 Sheet「TS Attend 2026」實測抓到的第一列真實資料
const REAL_ROW = [
  'NRF Retail’s Big Show 2026 ', '已結束', '1/11~1/13', 'US', 'New York ,US', 'Retail',
  'Show Kit', '3m x 3m', '9', '1',
  '7,800', '7,800', '2,500', '2,500', '19,800', '19,800', '40,000', '1,000',
]

test('mapSheetRowToProject：正常一列資料完整對應到 App 既有的 project schema 欄位名稱', () => {
  const data = mapSheetRowToProject(REAL_ROW, 2026)
  assert.equal(data.name, 'NRF Retail’s Big Show 2026') // 前後空白已清掉
  assert.equal(data.type, 'tradeshow')
  assert.equal(data.startDate, '2026-01-11')
  assert.equal(data.endDate, '2026-01-13')
  assert.equal(data.office, 'US')
  assert.equal(data.location, 'New York ,US')
  assert.equal(data.showType, 'Retail')
  assert.equal(data.boothFormat, 'Show Kit')
  assert.equal(data.boothDimensions, '3m x 3m')
  assert.equal(data.boothSqm, 9)
  assert.equal(data.year, 2026)
  assert.equal(data.status, '已結束')
  assert.equal(data.currency, 'USD') // office=US 對應 OFFICE_CURRENCY
  assert.equal(data.rentLocal, 7800)
  assert.equal(data.rentUSD, 7800)
  assert.equal(data.decorLocal, 2500)
  assert.equal(data.decorUSD, 2500)
  assert.equal(data.prLocal, 19800)
  assert.equal(data.prUSD, 19800)
  assert.equal(data.visitors, 40000)
  assert.equal(data.exhibitors, 1000)
  // 明確不該出現的欄位(App 專屬、Sheet 沒有對應資料)
  assert.equal('assignments' in data, false)
  assert.equal('artworkDone' in data, false)
})

test('mapSheetRowToProject：沒有名稱的列回傳 null，不會產生沒有名字的秀展', () => {
  assert.equal(mapSheetRowToProject(['', '已結束', '1/11~1/13', 'US'], 2026), null)
  assert.equal(mapSheetRowToProject([undefined, '已結束', '1/11~1/13'], 2026), null)
})

test('mapSheetRowToProject：日期格式不合法的列回傳 null(例如表頭防呆失效時混進來的髒資料列)', () => {
  assert.equal(mapSheetRowToProject(['某秀展', '目標', '1', '4'], 2026), null)
})

test('mapSheetRowToProject：數字欄位是空字串時該欄位直接不寫入，不會變成 0 或 NaN(正式 Sheet 有實際案例)', () => {
  // 對應「EE intelligent Tech Con 2026」實測資料：rentUSD/decorUSD 欄位是空字串
  const row = [
    'EE intelligent Tech Con 2026', '進行中', '10/1-10/2', 'TW', 'Taipei, TW', 'Forum',
    'Counter Booth', '3m*1m', '3', '2',
    '136,773', '', '0', '', '160,000', '', '2,000 ', '100 ',
  ]
  const data = mapSheetRowToProject(row, 2026)
  assert.equal(data.rentLocal, 136773)
  assert.equal('rentUSD' in data, false) // 空字串 -> 不寫入這個欄位
  assert.equal(data.decorLocal, 0)
  assert.equal('decorUSD' in data, false)
  assert.equal(data.visitors, 2000) // 數字帶千分位逗號 + 尾端空白都要正確解析
  assert.equal(data.exhibitors, 100)
})

test('mapSheetRowToProject：地點欄位內有換行(正式 Sheet 有實際案例)會清成單行文字', () => {
  // 對應「SECON 2026」實測資料
  const row = ['SECON 2026', '已結束', '3/18~3/20', 'KR', 'Gyeonggi-do\n, KR', 'Security']
  const data = mapSheetRowToProject(row, 2026)
  assert.equal(data.location, 'Gyeonggi-do , KR')
})

test('mapSheetRowToProject：狀態欄位不限於 App 下拉選單的三個固定值，原樣保留(正式 Sheet 有 "PR Approved" 這種英文值)', () => {
  const row = ['embedded world 2027', 'PR Approved', '3/16-3/18', 'GM', 'Nuremberg, GM', 'Embedded']
  const data = mapSheetRowToProject(row, 2027)
  assert.equal(data.status, 'PR Approved')
})

test('mapSheetRowToProject：office 不在 OFFICE_CURRENCY 對照表裡(或空白)時，不寫入 currency 欄位，不會寫入 undefined', () => {
  const row = ['某秀展', '進行中', '1/1~1/2', '', '某地']
  const data = mapSheetRowToProject(row, 2026)
  assert.equal('currency' in data, false)
})

test('mapSheetRowToProject：跨年秀展(12月開始隔年1月結束)日期正確跨到隔年', () => {
  const row = ['跨年展', '進行中', '12/30~1/2', 'TW', '台北']
  const data = mapSheetRowToProject(row, 2026)
  assert.equal(data.startDate, '2026-12-30')
  assert.equal(data.endDate, '2027-01-02')
})
