export const EXCEL_PREVIEW_MAX_ROWS = 500
export const EXCEL_PREVIEW_MAX_COLUMNS = 100

// 只取有限範圍供畫面預覽，避免大型或惡意活頁簿把瀏覽器記憶體耗盡。
// raw:false 只取儲存格顯示文字，不執行公式；React 顯示時也會自動逸出文字。
export function buildWorksheetPreview(XLSX, worksheet) {
  const ref = worksheet?.['!ref']
  if (!ref) return { rows: [], startRow: 0, totalRows: 0, totalColumns: 0, truncated: false }

  const original = XLSX.utils.decode_range(ref)
  const totalRows = original.e.r - original.s.r + 1
  const totalColumns = original.e.c - original.s.c + 1
  const range = {
    s: original.s,
    e: {
      r: Math.min(original.e.r, original.s.r + EXCEL_PREVIEW_MAX_ROWS - 1),
      c: Math.min(original.e.c, original.s.c + EXCEL_PREVIEW_MAX_COLUMNS - 1),
    },
  }
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    range,
  }).map(row => row.map(value => String(value ?? '')))

  return {
    rows,
    startRow: original.s.r,
    totalRows,
    totalColumns,
    truncated: totalRows > EXCEL_PREVIEW_MAX_ROWS || totalColumns > EXCEL_PREVIEW_MAX_COLUMNS,
  }
}
