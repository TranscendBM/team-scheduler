const OFFICE_VIEWER = 'https://view.officeapps.live.com/op/embed.aspx'
const PREVIEW_PROXY = 'https://asia-east1-team-scheduler-dc7ce.cloudfunctions.net/previewFile'
const TOKEN_PREFIX_LENGTH = 12

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

export function buildOfficeProxyUrl(safeUrl, requestId, idx, fileName) {
  let url
  try {
    url = new URL(safeUrl)
  } catch {
    return null
  }
  const token = url.searchParams.get('token') || ''
  if (!requestId || !Number.isInteger(idx) || idx < 0 || token.length < TOKEN_PREFIX_LENGTH) return null
  const extension = fileExtension(fileName)
  const suffix = extension ? `file.${extension}` : 'file'
  return `${PREVIEW_PROXY}/${encodeURIComponent(requestId)}/${idx}/${token.slice(0, TOKEN_PREFIX_LENGTH)}/${suffix}`
}

export function buildOfficeViewerUrl(safeUrl, requestId, idx, fileName) {
  const source = buildOfficeProxyUrl(safeUrl, requestId, idx, fileName)
  return source ? `${OFFICE_VIEWER}?src=${encodeURIComponent(source)}` : null
}
