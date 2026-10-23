import { test, expect, type Page } from '@playwright/test'

/**
 * Cache-first startup test (TOL-173): verifies that the web app renders from
 * IndexedDB cache instantly on reload, then revalidates in the background without
 * blocking screens or long main-thread tasks.
 */

async function measurePaintTime(page: Page): Promise<number> {
  return page.evaluate(() => {
    const paint = performance.getEntriesByType('paint').find(
      (e) => e.name === 'first-contentful-paint'
    )
    return paint ? paint.startTime : 0
  })
}

async function checkForLongTasks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const observer = new PerformanceObserver(() => {})
    observer.observe({ entryTypes: ['longtask'] })
    const longTasks = performance.getEntriesByType('longtask') as PerformanceEntry[]
    return Math.max(...longTasks.map((t) => t.duration), 0)
  })
}

async function waitForNoteList(page: Page): Promise<void> {
  await expect(page.getByText('Demo Note 0')).toBeVisible({ timeout: 10_000 })
}

test('cache-first startup paints under 1s on 4G, no blocking screens', async ({ context, page }) => {
  // First visit: populate the cache
  await page.goto('/', { waitUntil: 'networkidle' })
  await waitForNoteList(page)
  
  // Verify cache was written
  const cacheWritten = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('tolaria-entries', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    })
    if (!db) return false
    
    const hasCached = await new Promise<boolean>((resolve) => {
      const tx = db.transaction('entries', 'readonly')
      const store = tx.objectStore('entries')
      const req = store.get('snapshot')
      req.onsuccess = () => resolve(req.result !== undefined)
      req.onerror = () => resolve(false)
    })
    db.close()
    return hasCached
  })
  
  expect(cacheWritten).toBe(true)
  
  // Second visit with 4G throttling: measure cached paint
  const client = await context.newCDPSession(page)
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
    uploadThroughput: (3 * 1024 * 1024) / 8,   // 3 Mbps
    latency: 20, // 20ms
  })
  
  await page.reload({ waitUntil: 'domcontentloaded' })
  
  // Check that notes render from cache
  await waitForNoteList(page)
  const paintTime = await measurePaintTime(page)
  
  // Cached paint should be under 1 second
  expect(paintTime).toBeLessThan(1000)
  
  // No blocking or reloading screens should appear
  await expect(page.getByTestId('vault-loading-skeleton')).not.toBeVisible()
  await expect(page.getByTestId('status-vault-reloading')).not.toBeVisible()
  
  // Wait for background revalidation to complete
  await page.waitForTimeout(2000)
  
  // Check for long tasks during revalidation
  const maxTaskDuration = await checkForLongTasks(page)
  expect(maxTaskDuration).toBeLessThan(200)
})

test('first-ever load under 2s with 6k notes on 4G', async ({ context, page }) => {
  // Clear any existing cache
  await page.goto('/')
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('tolaria-entries')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  })
  
  // Close and reopen to ensure clean state
  await page.close()
  const newPage = await context.newPage()
  
  // Apply 4G throttling
  const client = await context.newCDPSession(newPage)
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
    latency: 20,
  })
  
  const startTime = Date.now()
  await newPage.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForNoteList(newPage)
  const loadTime = Date.now() - startTime
  
  // First-ever load should be under 2 seconds
  // Note: this assumes the test server is seeded with ~6000 notes
  expect(loadTime).toBeLessThan(2000)
  
  await newPage.close()
})

test('graceful fallback when IndexedDB unavailable', async ({ page }) => {
  // Simulate IndexedDB being unavailable
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      value: undefined,
      configurable: true,
    })
  })
  
  await page.goto('/')
  
  // App should still load, just without caching
  await waitForNoteList(page)
  await expect(page.getByText('Demo Note 0')).toBeVisible()
})
