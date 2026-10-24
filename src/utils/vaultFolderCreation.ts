import { invoke } from '@tauri-apps/api/core'
import type { FolderCreationParent } from '../types'
import { isTauri, mockInvoke } from '../mock-tauri'

const PATH_SEPARATOR = /[/\\]/

/** Windows drops trailing dots and spaces, so `.. ` or `...` resolve like `..` there. */
function isDotOnlySegment(segment: string) {
  return /^[. ]*$/.test(segment) && segment.includes('.')
}

function isSinglePathSegment(name: string) {
  return name.trim().length > 0 && !isDotOnlySegment(name) && !PATH_SEPARATOR.test(name)
}

function isSafeRelativeFolderPath(path: string) {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false
  return path.split(PATH_SEPARATOR).every((segment) => !isDotOnlySegment(segment))
}

export interface VaultFolderCreationRequest {
  name: string
  parent?: FolderCreationParent
  defaultVaultPath: string
}

function folderVaultPath({ parent, defaultVaultPath }: VaultFolderCreationRequest) {
  return parent?.rootPath?.trim() ? parent.rootPath : defaultVaultPath
}

function folderParentPath(parent: FolderCreationParent | undefined) {
  const parentPath = parent?.path && parent.path.length > 0 ? parent.path : null
  if (parentPath && !isSafeRelativeFolderPath(parentPath)) throw new Error('Invalid folder path')
  return parentPath
}

export function vaultFolderCreationArgs(request: VaultFolderCreationRequest) {
  if (!isSinglePathSegment(request.name)) throw new Error('Invalid folder name')
  return { vaultPath: folderVaultPath(request), folderName: request.name, parentPath: folderParentPath(request.parent) }
}

/**
 * Creates a folder in the vault through the native command, or the browser mock outside Tauri.
 * The native command re-validates the name and keeps the path inside the vault boundary.
 */
export async function createVaultFolder(request: VaultFolderCreationRequest) {
  const args = vaultFolderCreationArgs(request)
  if (isTauri()) {
    await invoke('create_vault_folder', args)
  } else {
    await mockInvoke('create_vault_folder', args)
  }
}
