// 把表格複製到剪貼簿，貼到 Word / Outlook 會是有框線的表格，貼到記事本/試算表是以 Tab 分隔的文字。
// 表格資料格式：{ title, headers: [string], rows: [[cell]], foot: [[cell]], note }
// cell = 字串，或 { text, sub, tone }：sub 是跟在主數字後面的小字(例如「急件 1」)，tone='red' 用紅字。
import { statusMeta } from './requestConstants'
import { URGENT_LEAD_DAYS, toLocalDateStr, urgentInfo } from './requestUrgency'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cellText = (c) => (c && typeof c === 'object' ? `${c.text ?? ''}${c.sub ? `(${c.sub})` : ''}` : String(c ?? ''))

const TD = 'border:1px solid #bfbfbf;padding:4px 8px;font-size:12px;font-family:Arial,"Microsoft JhengHei",sans-serif;'

function cellHtml(c, tag, extra = '') {
  const isObj = c && typeof c === 'object'
  const color = isObj && c.tone === 'red' ? 'color:#dc2626;' : ''
  const sub = isObj && c.sub ? ` <span style="color:#dc2626;font-size:11px;">(${esc(c.sub)})</span>` : ''
  return `<${tag} style="${TD}${extra}${color}">${esc(isObj ? c.text : c)}${sub}</${tag}>`
}

export function tableToHtml({ title, headers = [], rows = [], foot = [], note = '' }) {
  const head = `<tr>${headers.map((h, i) => cellHtml(h, 'th', `background:#f2f2f2;${i === 0 ? 'text-align:left;' : 'text-align:center;'}`)).join('')}</tr>`
  const body = rows.map(r => `<tr>${r.map((c, i) => cellHtml(c, 'td', i === 0 ? 'text-align:left;' : 'text-align:center;')).join('')}</tr>`).join('')
  const tfoot = foot.map(r => `<tr>${r.map((c, i) => cellHtml(c, 'td', `font-weight:bold;background:#f2f2f2;${i === 0 ? 'text-align:left;' : 'text-align:center;'}`)).join('')}</tr>`).join('')
  return `${title ? `<p style="font-size:14px;font-weight:bold;font-family:Arial,'Microsoft JhengHei',sans-serif;">${esc(title)}</p>` : ''}`
    + `<table style="border-collapse:collapse;">${head}${body}${tfoot}</table>`
    + `${note ? `<p style="font-size:11px;color:#666;font-family:Arial,'Microsoft JhengHei',sans-serif;">${esc(note)}</p>` : ''}`
}

export function tableToText({ title, headers = [], rows = [], foot = [], note = '' }) {
  const line = (r) => r.map(cellText).join('\t')
  return [title, headers.join('\t'), ...rows.map(line), ...foot.map(line), note].filter(x => x !== '' && x != null).join('\n')
}

// 寫進剪貼簿(同時帶 HTML 與純文字)。新瀏覽器用 Clipboard API；不支援時退回選取後 execCommand。
export async function copyTable(table) {
  const html = tableToHtml(table)
  const text = tableToText(table)
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })])
    return
  }
  const box = document.createElement('div')
  box.contentEditable = 'true'
  box.style.cssText = 'position:fixed;left:-9999px;top:0;'
  box.innerHTML = html
  document.body.appendChild(box)
  const range = document.createRange()
  range.selectNodeContents(box)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  const ok = document.execCommand('copy')
  sel.removeAllRanges()
  document.body.removeChild(box)
  if (!ok) throw new Error('瀏覽器不允許複製')
}

// ── 發稿統計 → 表格資料 ──
const num = (c) => (c && c.total ? { text: String(c.total), sub: c.urgent ? `急件 ${c.urgent}` : '' } : '-')

export function statsToTable(stats, year) {
  const rows = stats.months.map(m => [
    `${Number(m.month.slice(5))} 月`,
    ...stats.regions.map(r => num(m.byRegion[r])),
    m.total ? String(m.total) : '-',
    m.urgent ? { text: String(m.urgent), tone: 'red' } : '-',
  ])
  const t = stats.totals
  return {
    title: `${year} 年每月各地區發稿統計`,
    headers: ['月份', ...stats.regions, '合計', '急件'],
    rows,
    foot: [[
      '全年',
      ...stats.regions.map(r => num(t.byRegion[r])),
      String(t.total),
      { text: String(t.urgent), tone: 'red' },
    ]],
    note: `以需求提交日為發稿日；已駁回不計。急件 = 發稿日到交期不滿 ${URGENT_LEAD_DAYS} 天，或送件時手動標示。括號內為急件數。`,
  }
}

// 某個月(可限定地區)的需求明細 → 表格資料
export function requestsToTable(list, title) {
  return {
    title,
    headers: ['專案名稱', '地區', '發稿日', '交期', '間隔(天)', '急件', '狀態'],
    rows: list.map(r => {
      const u = urgentInfo(r)
      return [
        r.projectName || r.title || '',
        r.region || '未填',
        toLocalDateStr(r.createdAt),
        r.dueDate || '',
        u.days === null ? '' : String(u.days),
        u.urgent ? { text: u.auto ? '是' : '是(手動)', tone: 'red' } : '',
        statusMeta(r.status).label,
      ]
    }),
  }
}
