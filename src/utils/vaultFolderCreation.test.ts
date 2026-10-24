import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri, mockInvoke } from '../mock-tauri'
import { createVaultFolder, vaultFolderCreationArgs } from './vaultFolderCreation'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

describe('vaultFolderCreationArgs', () => {
  it('creates top-level folders in the default vault', () => {
    expect(vaultFolderCreationArgs({ name: 'Projects', defaultVaultPath: '/vault' })).toEqual({
      vaultPath: '/vault',
      folderName: 'Projects',
      parentPath: null,
    })
  })

  it('creates nested folders in the parent workspace root', () => {
    expect(vaultFolderCreationArgs({ name: 'Drafts', parent: { path: 'notes', rootPath: '/work' }, defaultVaultPath: '/vault' })).toEqual({
      vaultPath: '/work',
      folderName: 'Drafts',
      parentPath: 'notes',
    })
  })

  it('falls back to the default vault for a blank root and an empty parent path', () => {
    expect(vaultFolderCreationArgs({ name: 'Drafts', parent: { path: '', rootPath: '  ' }, defaultVaultPath: '/vault' })).toEqual({
      vaultPath: '/vault',
      folderName: 'Drafts',
      parentPath: null,
    })
  })
})

describe('vaultFolderCreationArgs validation', () => {
  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', '../escape', '...', '.. ', '. .', '.. .'])('rejects the folder name %j', (name) => {
    expect(() => vaultFolderCreationArgs({ name, defaultVaultPath: '/vault' })).toThrow('Invalid folder name')
  })

  it.each(['/etc', '\\server', 'C:/Users', '../outside', 'notes/../../outside', 'notes/.. /outside', 'notes/.../outside', './notes'])('rejects the parent path %j', (path) => {
    expect(() => vaultFolderCreationArgs({ name: 'Drafts', parent: { path }, defaultVaultPath: '/vault' })).toThrow('Invalid folder path')
  })

  it('accepts nested relative parent paths', () => {
    expect(vaultFolderCreationArgs({ name: 'Drafts', parent: { path: 'notes/2026' }, defaultVaultPath: '/vault' }).parentPath).toBe('notes/2026')
  })
})

describe('createVaultFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the native command in the desktop app', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await createVaultFolder({ name: 'Projects', defaultVaultPath: '/vault' })

    expect(invoke).toHaveBeenCalledWith('create_vault_folder', { vaultPath: '/vault', folderName: 'Projects', parentPath: null })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('does not reach the native command with an unsafe folder name', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await expect(createVaultFolder({ name: '../escape', defaultVaultPath: '/vault' })).rejects.toThrow('Invalid folder name')

    expect(invoke).not.toHaveBeenCalled()
  })

  it('uses the browser mock outside the desktop app', async () => {
    vi.mocked(isTauri).mockReturnValue(false)

    await createVaultFolder({ name: 'Projects', parent: { path: 'notes' }, defaultVaultPath: '/vault' })

    expect(mockInvoke).toHaveBeenCalledWith('create_vault_folder', { vaultPath: '/vault', folderName: 'Projects', parentPath: 'notes' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
