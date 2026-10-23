/**
 * Service worker registration for the Tolaria web build.
 * Only registers in the browser; never in the Tauri desktop app.
 */

function isTauriRuntime(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

function isWebBuild(): boolean {
  // Web build has remote backend configured
  return typeof window !== 'undefined' &&
    'TOLARIA_REMOTE_URL' in window &&
    !!(window as { TOLARIA_REMOTE_URL?: string }).TOLARIA_REMOTE_URL;
}

function isServiceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator;
}

/**
 * Registers the service worker for offline caching. Safe to call multiple times;
 * registration is idempotent. Only registers in the web build with remote backend,
 * never in Tauri desktop app or desktop browser harness.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isTauriRuntime()) {
    // Desktop app uses local files; service worker is not needed
    return null;
  }

  if (!isWebBuild()) {
    // Desktop browser harness or local development without remote backend
    return null;
  }

  if (!isServiceWorkerSupported()) {
    // Browser doesn't support service workers (unlikely in 2026)
    console.warn('Service workers are not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });

    // Check for updates immediately and then periodically
    registration.update();

    // Log registration for debugging
    if (registration.installing) {
      console.log('Service worker installing');
    } else if (registration.waiting) {
      console.log('Service worker installed, waiting to activate');
    } else if (registration.active) {
      console.log('Service worker active');
    }

    return registration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}

/**
 * Unregisters the service worker. Used for cleanup or testing.
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!isServiceWorkerSupported()) {
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (registration) {
    await registration.unregister();
    console.log('Service worker unregistered');
  }
}
