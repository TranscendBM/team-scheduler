import { describe, it, expect } from 'vitest'
import { splitLinkParts } from '../../src/utils/linkify.js'

describe('splitLinkParts', () => {
  it('沒有網址的純文字：整段回傳一個 text 片段', () => {
    expect(splitLinkParts('普通文字')).toEqual([{ type: 'text', value: '普通文字' }])
  })

  it('整段就是一個網址：回傳一個 url 片段', () => {
    expect(splitLinkParts('https://example.com')).toEqual([{ type: 'url', value: 'https://example.com' }])
  })

  it('文字夾網址：拆成 text/url/text 三段', () => {
    expect(splitLinkParts('請看 https://example.com/a 這份文件')).toEqual([
      { type: 'text', value: '請看 ' },
      { type: 'url', value: 'https://example.com/a' },
      { type: 'text', value: ' 這份文件' },
    ])
  })

  it('多個網址各自獨立成一段', () => {
    const parts = splitLinkParts('第一個 https://a.com 第二個 https://b.com')
    expect(parts.filter(p => p.type === 'url')).toEqual([
      { type: 'url', value: 'https://a.com' },
      { type: 'url', value: 'https://b.com' },
    ])
  })

  it('只認 http(s):// 開頭，javascript:/data: 不算網址', () => {
    const parts = splitLinkParts('javascript:alert(1) data:text/html,x')
    expect(parts.every(p => p.type === 'text')).toBe(true)
  })

  it('空字串/null/undefined 都回傳空陣列，不會噴錯', () => {
    expect(splitLinkParts('')).toEqual([])
    expect(splitLinkParts(null)).toEqual([])
    expect(splitLinkParts(undefined)).toEqual([])
  })
})
