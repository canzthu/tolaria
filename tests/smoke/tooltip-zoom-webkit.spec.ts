import { expect, test } from '@playwright/test'
import { openFixtureVaultDesktopHarness } from '../helpers/fixtureVault'

test.describe('Tooltip positioning at zoom @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await openFixtureVaultDesktopHarness(page)
  })

  const zoomLevels = [80, 90, 100, 110, 125, 150]

  for (const zoom of zoomLevels) {
    test(`toolbar tooltip is centered on trigger at ${zoom}% zoom`, async ({ page }) => {
      // Set document zoom
      await page.evaluate((z) => {
        document.documentElement.style.setProperty('zoom', `${z}%`)
        document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', String(z / 100))
      }, zoom)

      // Find TOC button in toolbar (has tooltip "Open table of contents")
      const tocButton = page.getByRole('button', { name: /table of contents/i })
      await expect(tocButton).toBeVisible()

      // Hover to show tooltip
      await tocButton.hover()
      
      // Wait for tooltip to appear
      const tooltip = page.locator('[data-slot="tooltip-content"]')
      await expect(tooltip).toBeVisible({ timeout: 3000 })

      // Get positions
      const buttonBox = await tocButton.boundingBox()
      const tooltipBox = await tooltip.boundingBox()
      
      expect(buttonBox).not.toBeNull()
      expect(tooltipBox).not.toBeNull()
      
      if (!buttonBox || !tooltipBox) return

      // Tooltip should be horizontally centered on the button (with small tolerance)
      const buttonCenterX = buttonBox.x + buttonBox.width / 2
      const tooltipCenterX = tooltipBox.x + tooltipBox.width / 2
      const horizontalOffset = Math.abs(buttonCenterX - tooltipCenterX)
      
      // Allow up to 5px offset for rounding/arrow positioning
      expect(horizontalOffset).toBeLessThan(5)

      // Tooltip should be below the button
      expect(tooltipBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height)
      
      // Tooltip should be reasonably close vertically
      const verticalGap = tooltipBox.y - (buttonBox.y + buttonBox.height)
      expect(verticalGap).toBeLessThan(20)
    })
  }

  test('sidebar tooltip is centered at 125% zoom', async ({ page }) => {
    // Set zoom
    await page.evaluate(() => {
      document.documentElement.style.setProperty('zoom', '125%')
      document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', '1.25')
    })

    // Find a sidebar button with tooltip
    const newNoteButton = page.getByRole('button', { name: /new note/i }).first()
    await expect(newNoteButton).toBeVisible()

    await newNoteButton.hover()
    
    const tooltip = page.locator('[data-slot="tooltip-content"]')
    await expect(tooltip).toBeVisible({ timeout: 3000 })

    const buttonBox = await newNoteButton.boundingBox()
    const tooltipBox = await tooltip.boundingBox()
    
    expect(buttonBox).not.toBeNull()
    expect(tooltipBox).not.toBeNull()
    
    if (!buttonBox || !tooltipBox) return

    // Should be horizontally aligned (tooltip appears to the side in sidebar)
    const verticalOffset = Math.abs(
      (buttonBox.y + buttonBox.height / 2) - 
      (tooltipBox.y + tooltipBox.height / 2)
    )
    expect(verticalOffset).toBeLessThan(10)
  })
})
