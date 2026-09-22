import { describe, it, expect } from 'vitest'
import { tooltipPosition } from '../../src/utils/tooltipPosition.js'

// 甘特圖 tooltip：手機上點右半邊的工作條時，原本 x+14 的定位會整個掉出 viewport
describe('tooltipPosition', () => {
  it('空間夠時放在游標右下（維持原本的 x+14 / y-10 行為）', () => {
    const { left, top } = tooltipPosition({
      x: 100, y: 200, width: 260, height: 200, viewportWidth: 1440, viewportHeight: 900,
    })
    expect(left).toBe(114)
    expect(top).toBe(190)
  })

  it('右邊放不下時翻到游標左側，且不會超出右邊界', () => {
    const { left } = tooltipPosition({
      x: 360, y: 300, width: 260, height: 200, viewportWidth: 375, viewportHeight: 667,
    })
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + 260).toBeLessThanOrEqual(375)
  })

  it('靠近上下邊界時 top 會被夾住，不會是負數也不會超出底部', () => {
    const top1 = tooltipPosition({ x: 10, y: 0, width: 200, height: 200, viewportWidth: 375, viewportHeight: 667 }).top
    expect(top1).toBeGreaterThanOrEqual(8)

    const top2 = tooltipPosition({ x: 10, y: 660, width: 200, height: 200, viewportWidth: 375, viewportHeight: 667 }).top
    expect(top2 + 200).toBeLessThanOrEqual(667)
  })

  it('viewport 比 tooltip 還小時，至少會貼齊左上的安全邊距（不會變成負數）', () => {
    const { left, top } = tooltipPosition({
      x: 300, y: 300, width: 400, height: 800, viewportWidth: 320, viewportHeight: 568,
    })
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
  })
})
