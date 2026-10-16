import { useEffect, useRef, useState } from 'react'
import { buildWorksheetPreview } from '../utils/excelPreview'

const LOAD_ERROR = 'Excel 預覽載入失敗，請改用下載開啟。'
const DOWNLOAD_ERROR = '無法安全下載 Excel 預覽資料，請改用下載開啟。'

export default function ExcelPreview({ src, name }) {
  const workbookRef = useRef(null)
  const xlsxRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [sheetNames, setSheetNames] = useState([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [preview, setPreview] = useState(null)
  const [errorMessage, setErrorMessage] = useState(LOAD_ERROR)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const [response, XLSX] = await Promise.all([
          fetch(src, { signal: controller.signal }),
          import('@e965/xlsx'),
        ])
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`)
          error.kind = 'download'
          throw error
        }
        const workbook = XLSX.read(await response.arrayBuffer(), {
          type: 'array',
          cellDates: true,
          cellFormula: false,
          cellHTML: false,
          cellNF: false,
          cellStyles: false,
        })
        if (cancelled) return
        if (!workbook.SheetNames.length) throw new Error('活頁簿沒有工作表')

        workbookRef.current = workbook
        xlsxRef.current = XLSX
        setSheetNames(workbook.SheetNames)
        setPreview(buildWorksheetPreview(XLSX, workbook.Sheets[workbook.SheetNames[0]]))
        setStatus('ready')
      } catch (error) {
        if (error?.name === 'AbortError' || cancelled) return
        console.error('Excel preview failed:', error)
        setErrorMessage(error?.kind === 'download' || error instanceof TypeError ? DOWNLOAD_ERROR : LOAD_ERROR)
        setStatus('error')
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
      workbookRef.current = null
      xlsxRef.current = null
    }
  }, [src])

  function selectSheet(index) {
    const workbook = workbookRef.current
    const XLSX = xlsxRef.current
    if (!workbook || !XLSX || index < 0 || index >= workbook.SheetNames.length) return
    setActiveSheet(index)
    setPreview(buildWorksheetPreview(XLSX, workbook.Sheets[workbook.SheetNames[index]]))
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-3" aria-label={`${name} Excel 預覽`}>
      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-sm text-white">正在解析 Excel…</div>
      )}
      {status === 'error' && (
        <div className="flex-1 flex items-center justify-center text-sm text-white">{errorMessage}</div>
      )}
      {status === 'ready' && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sheetNames.map((sheetName, index) => (
              <button key={`${sheetName}-${index}`} type="button" onClick={() => selectSheet(index)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${index === activeSheet ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                {sheetName}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto rounded-lg bg-white shadow-2xl">
            {preview?.rows.length ? (
              <table className="min-w-full border-collapse text-xs text-gray-800">
                <tbody>
                  {preview.rows.map((row, rowIndex) => (
                    <tr key={preview.startRow + rowIndex}>
                      <th className="sticky left-0 z-10 border border-gray-200 bg-gray-100 px-2 py-1 text-right font-normal text-gray-500">
                        {preview.startRow + rowIndex + 1}
                      </th>
                      {row.map((cell, columnIndex) => (
                        <td key={columnIndex} className="max-w-80 whitespace-pre-wrap break-words border border-gray-200 px-2 py-1 align-top">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">這個工作表沒有內容</div>
            )}
          </div>
          {preview?.truncated && (
            <div className="text-center text-xs text-amber-200">
              預覽僅顯示前 500 列、100 欄；完整內容請下載檔案查看。
            </div>
          )}
        </>
      )}
    </div>
  )
}
