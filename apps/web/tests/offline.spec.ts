/**
 * Offline mode tests: service worker caching, offline state visibility,
 * and read-only editor behavior when the network is unavailable.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const TEST_VAULT_URL = process.env.TEST_VAULT_URL || 'http://localhost:5201';

async function waitForAppReady(page: Page) {
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
  // Wait a bit for the service worker to register
  await page.waitForTimeout(1000);
}

async function openNote(page: Page, noteTitle: string) {
  // Click on note list
  await page.click('[data-testid="note-list"]');
  await page.waitForTimeout(200);
  
  // Search for the note
  await page.keyboard.type(noteTitle);
  await page.waitForTimeout(300);
  
  // Click the first result
  const firstNote = page.locator('[data-testid^="note-item-"]').first();
  await firstNote.click();
  await page.waitForTimeout(500);
}

test.describe('Offline mode', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto(TEST_VAULT_URL);
    await waitForAppReady(page);
  });

  test('service worker registers successfully in web build', async ({ page }) => {
    // Check that service worker is registered
    const registration = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration().then((reg) => ({
        hasRegistration: !!reg,
        active: reg?.active?.state,
      }));
    });

    expect(registration.hasRegistration).toBe(true);
    expect(registration.active).toBe('activated');
  });

  test('shows offline badge when network is unavailable', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Check for offline badge in status bar
    const offlineBadge = page.locator('[data-testid="status-offline"]');
    await expect(offlineBadge).toBeVisible();
    
    // Check that it says "Offline"
    await expect(offlineBadge).toContainText('Offline');
  });

  test('opens previously cached notes when offline', async ({ page, context }) => {
    // First, open a note while online to cache it
    await openNote(page, 'Getting Started');
    await page.waitForTimeout(1000);

    // Verify the note is open
    const editorTitle = page.locator('[data-testid="editor-breadcrumb-title"]');
    await expect(editorTitle).toContainText('Getting Started');

    // Now go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Reload the page (simulating app restart)
    await page.reload();
    await waitForAppReady(page);

    // Try to open the same note again
    await openNote(page, 'Getting Started');
    
    // The note should still open from cache
    await expect(editorTitle).toContainText('Getting Started');
    
    // Offline badge should be visible
    const offlineBadge = page.locator('[data-testid="status-offline"]');
    await expect(offlineBadge).toBeVisible();
  });

  test('editor is read-only when offline', async ({ page, context }) => {
    // Open a note while online
    await openNote(page, 'Getting Started');
    await page.waitForTimeout(1000);

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Try to edit the note
    const editor = page.locator('[data-content-type]').first();
    
    // Click into the editor
    await editor.click();
    await page.waitForTimeout(200);

    // Try to type - should not work because editor is read-only
    await page.keyboard.type('This should not appear');
    await page.waitForTimeout(300);

    // The text should not have been added (editor is read-only)
    const editorContent = await editor.textContent();
    expect(editorContent).not.toContain('This should not appear');
  });

  test('sync status shows offline state', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Check that sync badge or offline indicator is visible
    const offlineBadge = page.locator('[data-testid="status-offline"]');
    await expect(offlineBadge).toBeVisible();

    // The sync badge should not be spinning or showing "syncing"
    const syncBadge = page.locator('[data-testid="status-sync"]');
    if (await syncBadge.isVisible()) {
      const syncText = await syncBadge.textContent();
      expect(syncText?.toLowerCase()).not.toContain('syncing');
    }
  });

  test('no spinner blocks note list or editor when offline', async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Reload to test offline startup
    await page.reload();
    await waitForAppReady(page);

    // Check that there's no blocking spinner over the note list
    const noteList = page.locator('[data-testid="note-list"]');
    await expect(noteList).toBeVisible();
    
    // Check that note list is interactive (not blocked by a spinner)
    const firstNote = page.locator('[data-testid^="note-item-"]').first();
    if (await firstNote.isVisible()) {
      await expect(firstNote).toBeEnabled();
    }

    // Check that there's no blocking spinner over the editor
    const editor = page.locator('.app__editor');
    await expect(editor).toBeVisible();
    
    // Offline badge should be present
    const offlineBadge = page.locator('[data-testid="status-offline"]');
    await expect(offlineBadge).toBeVisible();
  });

  test('entries list loads from cache when offline', async ({ page, context }) => {
    // First visit while online to populate cache
    await page.waitForTimeout(2000);
    
    // Count entries while online
    const onlineEntryCount = await page.locator('[data-testid^="note-item-"]').count();
    expect(onlineEntryCount).toBeGreaterThan(0);

    // Go offline and reload
    await context.setOffline(true);
    await page.reload();
    await waitForAppReady(page);

    // Entries should still be visible from cache
    const offlineEntryCount = await page.locator('[data-testid^="note-item-"]').count();
    expect(offlineEntryCount).toBeGreaterThan(0);
    
    // Should have similar count (allowing for some variance)
    expect(Math.abs(offlineEntryCount - onlineEntryCount)).toBeLessThan(5);
  });

  test('returns to editable mode when back online', async ({ page, context }) => {
    // Start offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Open a note
    await openNote(page, 'Getting Started');
    
    // Verify offline badge is visible
    const offlineBadge = page.locator('[data-testid="status-offline"]');
    await expect(offlineBadge).toBeVisible();

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(2000);

    // Offline badge should disappear
    await expect(offlineBadge).not.toBeVisible();

    // Editor should now be editable
    const editor = page.locator('[data-content-type]').first();
    await editor.click();
    await page.waitForTimeout(200);

    // Should be able to type
    await page.keyboard.type('Online edit test');
    await page.waitForTimeout(300);

    // The text should appear (editor is now editable)
    const editorContent = await editor.textContent();
    expect(editorContent).toContain('Online edit test');
  });
});
