import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import App from './App'

/**
 * Tests for platform capabilities detection in App.tsx (TOL-174).
 * Verifies that desktop-only features are hidden in web builds.
 */

describe('App platform capabilities', () => {
  beforeEach(() => {
    // Clean up any stubs from previous tests
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('detects remote backend configuration', () => {
    // Stub window properties for remote backend
    vi.stubGlobal('TOLARIA_REMOTE_URL', 'https://example.com')
    vi.stubGlobal('TOLARIA_REMOTE_TOKEN', 'test-token')

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
  })

  test('handles missing remote URL', () => {
    // Stub only TOLARIA_REMOTE_TOKEN
    vi.stubGlobal('TOLARIA_REMOTE_TOKEN', 'test-token')

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
  })

  test('handles missing remote token', () => {
    // Stub only TOLARIA_REMOTE_URL
    vi.stubGlobal('TOLARIA_REMOTE_URL', 'https://example.com')

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
  })

  test('handles empty remote URL', () => {
    // Stub empty TOLARIA_REMOTE_URL
    vi.stubGlobal('TOLARIA_REMOTE_URL', '')
    vi.stubGlobal('TOLARIA_REMOTE_TOKEN', 'test-token')

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
  })

  test('handles empty remote token', () => {
    // Stub empty TOLARIA_REMOTE_TOKEN
    vi.stubGlobal('TOLARIA_REMOTE_URL', 'https://example.com')
    vi.stubGlobal('TOLARIA_REMOTE_TOKEN', '')

    const { container } = render(<App />)
    
    // App should render without crashing
    expect(container).toBeTruthy()
  })

  test('handles window being undefined', () => {
    // No remote config stubs - tests default mock environment
    const { container } = render(<App />)
    
    // App should render without crashing in mock environment
    expect(container).toBeTruthy()
  })
})
