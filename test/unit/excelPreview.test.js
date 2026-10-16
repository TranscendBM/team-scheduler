import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import {
  buildWorksheetPreview,
  EXCEL_PREVIEW_MAX_COLUMNS,
  EXCEL_PREVIEW_MAX_ROWS,
} from '../../src/utils/excelPreview.js'

describe('buildWorksheetPreview', () => {
  it('returns displayed cell text without evaluating formulas or emitting HTML', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['名稱', '數量', '內容'],
      ['<img onerror=alert(1)>', 12, '安全文字'],
    ])
    sheet.C2 = { t: 'n', v: 2, f: '1+1', w: '2' }

    const result = buildWorksheetPreview(XLSX, sheet)
    expect(result.rows).toEqual([
      ['名稱', '數量', '內容'],
      ['<img onerror=alert(1)>', '12', '2'],
    ])
    expect(result.truncated).toBe(false)
  })

  it('handles an empty worksheet', () => {
    expect(buildWorksheetPreview(XLSX, {})).toEqual({
      rows: [], startRow: 0, totalRows: 0, totalColumns: 0, truncated: false,
    })
  })

  it('caps oversized worksheets to the preview row and column limits', () => {
    const sheet = { '!ref': `A1:${XLSX.utils.encode_col(EXCEL_PREVIEW_MAX_COLUMNS)}${EXCEL_PREVIEW_MAX_ROWS + 1}` }
    sheet.A1 = { t: 's', v: 'first' }

    const result = buildWorksheetPreview(XLSX, sheet)
    expect(result.rows).toHaveLength(EXCEL_PREVIEW_MAX_ROWS)
    expect(result.rows[0]).toHaveLength(EXCEL_PREVIEW_MAX_COLUMNS)
    expect(result.totalRows).toBe(EXCEL_PREVIEW_MAX_ROWS + 1)
    expect(result.totalColumns).toBe(EXCEL_PREVIEW_MAX_COLUMNS + 1)
    expect(result.truncated).toBe(true)
  })
})
