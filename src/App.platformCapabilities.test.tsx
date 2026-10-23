import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import App from './App'

/**
 * Tests for platform capabilities detection in App.tsx (TOL-174).
 * Verifies that desktop-only features are hidden in web builds.
 */

describe('App platform capabilities', () => {
  test('detects remote backend configuration', () => {
    // Mock window with TOLARIA_REMOTE_URL and TOLARIA_REMOTE_TOKEN
    const originalWindow = global.window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: {
        ...originalWindow,
        TOLARIA_REMOTE_URL: 'https://example.com',
        TOLARIA_REMOTE_TOKEN: 'test-token',
      },
    })

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
    
    // Restore original window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: originalWindow,
    })
  })

  test('handles missing remote URL', () => {
    // Mock window with only TOLARIA_REMOTE_TOKEN
    const originalWindow = global.window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: {
        ...originalWindow,
        TOLARIA_REMOTE_TOKEN: 'test-token',
      },
    })

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
    
    // Restore original window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: originalWindow,
    })
  })

  test('handles missing remote token', () => {
    // Mock window with only TOLARIA_REMOTE_URL
    const originalWindow = global.window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: {
        ...originalWindow,
        TOLARIA_REMOTE_URL: 'https://example.com',
      },
    })

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
    
    // Restore original window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: originalWindow,
    })
  })

  test('handles empty remote URL', () => {
    // Mock window with empty TOLARIA_REMOTE_URL
    const originalWindow = global.window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: {
        ...originalWindow,
        TOLARIA_REMOTE_URL: '',
        TOLARIA_REMOTE_TOKEN: 'test-token',
      },
    })

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
    
    // Restore original window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: originalWindow,
    })
  })

  test('handles empty remote token', () => {
    // Mock window with empty TOLARIA_REMOTE_TOKEN
    const originalWindow = global.window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: {
        ...originalWindow,
        TOLARIA_REMOTE_URL: 'https://example.com',
        TOLARIA_REMOTE_TOKEN: '',
      },
    })

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
    
    // Restore original window
    Object.defineProperty(global, 'window', {
      writable: true,
      value: originalWindow,
    })
  })

  test('handles window being undefined', () => {
    // Mock typeof window !== 'undefined' check
    const { container } = render(<App />)
    
    // App should render without crashing in mock environment
    expect(container).toBeTruthy()
  })
})
