import { useEffect, useRef, useState } from 'react'

const LOAD_ERROR = 'PowerPoint 預覽載入失敗，請改用下載開啟。'
const DOWNLOAD_ERROR = '無法安全下載 PowerPoint 預覽資料，請改用下載開啟。'

export default function PowerPointPreview({ src, name }) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const presentationRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState(LOAD_ERROR)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const [response, core, viewerCore] = await Promise.all([
          fetch(src, { signal: controller.signal }),
          import('@web-ppt/core'),
          import('@web-ppt/viewer-core'),
        ])
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`)
          error.kind = 'download'
          throw error
        }

        const presentation = await core.parse(await response.blob())
        if (cancelled) {
          presentation.dispose?.()
          return
        }
        if (!presentation.slides.length) throw new Error('簡報沒有投影片')

        presentationRef.current = presentation
        const viewer = new viewerCore.Viewer(containerRef.current, presentation, {
          animate: false,
          skipHidden: true,
        })
        // 預覽器會自行處理簡報內部的投影片跳轉；其他連結一律攔截，
        // 避免不可信附件透過 javascript: 或外部網址導走使用者。
        viewer.onLinkClick = () => true
        viewer.onChange = index => setCurrent(index)
        viewerRef.current = viewer
        setCount(viewer.count)
        setCurrent(viewer.index)
        setStatus('ready')
      } catch (error) {
        if (error?.name === 'AbortError' || cancelled) return
        console.error('PowerPoint preview failed:', error)
        setErrorMessage(error?.kind === 'download' || error instanceof TypeError ? DOWNLOAD_ERROR : LOAD_ERROR)
        setStatus('error')
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
      viewerRef.current?.destroy()
      viewerRef.current = null
      presentationRef.current?.dispose?.()
      presentationRef.current = null
    }
  }, [src])

  function previous() {
    viewerRef.current?.prev()
  }

  function next() {
    viewerRef.current?.next()
  }

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-3" aria-label={`${name} PowerPoint 預覽`}>
      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-sm text-white">正在解析 PowerPoint…</div>
      )}
      {status === 'error' && (
        <div className="flex-1 flex items-center justify-center text-sm text-white">{errorMessage}</div>
      )}
      <div
        ref={containerRef}
        className={`${status === 'ready' ? 'flex' : 'hidden'} flex-1 min-h-0 overflow-auto bg-white rounded-lg shadow-2xl items-center justify-center`}
      />
      {status === 'ready' && (
        <div className="flex items-center justify-center gap-3 text-white">
          <button type="button" onClick={previous} disabled={current <= 0}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40">
            上一頁
          </button>
          <span className="min-w-20 text-center text-sm">{current + 1} / {count}</span>
          <button type="button" onClick={next} disabled={current >= count - 1}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40">
            下一頁
          </button>
        </div>
      )}
    </div>
  )
}
