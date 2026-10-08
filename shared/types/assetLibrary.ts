export const DEFAULT_NEW_ASSET_LIBRARY_NAME = 'Untitled'
export const SAMPLE_BRAND_KIT_NAME = 'Sample Brand Kit'
export const ASSET_LIBRARY_NAME_MAX = 60
export const ASSET_LIBRARY_DESCRIPTION_MAX = 280
export const ASSET_LIBRARY_DELETE_CONFIRMATION = 'DELETE'

/** Same media families the project canvas can show / accept via upload. */
export const ASSET_LIBRARY_ACCEPT = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/x-ms-bmp',
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aac',
  'audio/ogg',
  'audio/mp4',
] as const

export const ASSET_LIBRARY_ACCEPT_ATTR = ASSET_LIBRARY_ACCEPT.join(',')

export const ASSET_LIBRARY_EXTENSION_RE = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|mov|mkv|mp3|wav|aac|ogg|m4a)$/i

export type AssetLibraryMediaKind = 'image' | 'video' | 'audio'

const ASSET_LIBRARY_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}
const ASSET_LIBRARY_MIME_ALIASES: Record<string, string> = {
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-bmp': 'image/bmp',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'application/x-m4a': 'audio/mp4',
}

/** Resolve browser MIME gaps from the same allowlisted extensions used by uploads. */
export function assetLibraryMimeType(mimeType: string, fileName = ''): string | null {
  const declaredType = String(mimeType || '').split(';', 1)[0]!.trim().toLowerCase()
  const type = ASSET_LIBRARY_MIME_ALIASES[declaredType] || declaredType
  if ((ASSET_LIBRARY_ACCEPT as readonly string[]).includes(type))
    return type
  if (/^(?:image|video|audio)\//.test(declaredType))
    return null
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== 'binary/octet-stream')
    return null
  const extension = String(fileName || '').toLowerCase().match(/\.[^.]+$/)?.[0]
  return extension ? ASSET_LIBRARY_MIME_BY_EXTENSION[extension] || null : null
}

export function nextAssetLibraryTitle(existingNames: string[]) {
  const names = new Set(existingNames.map(name => name.trim()).filter(Boolean))
  if (!names.has(DEFAULT_NEW_ASSET_LIBRARY_NAME))
    return DEFAULT_NEW_ASSET_LIBRARY_NAME

  let index = 2
  while (names.has(`${DEFAULT_NEW_ASSET_LIBRARY_NAME} ${index}`))
    index += 1
  return `${DEFAULT_NEW_ASSET_LIBRARY_NAME} ${index}`
}

export function assetLibraryMediaKind(mimeType: string, fileName = ''): AssetLibraryMediaKind | null {
  const type = assetLibraryMimeType(mimeType, fileName) || ''
  if (type.startsWith('image/'))
    return 'image'
  if (type.startsWith('video/'))
    return 'video'
  if (type.startsWith('audio/'))
    return 'audio'
  return null
}

export function isAssetLibraryAcceptFile(file: { type?: string, name?: string }) {
  return assetLibraryMimeType(file.type || '', file.name || '') !== null
}

export interface AssetLibraryPublic {
  id: string
  name: string
  description: string
  assetCount: number
  coverUrl: string
  createdAt: string
  updatedAt: string
}

export interface AssetLibraryList {
  items: AssetLibraryPublic[]
}

export interface AssetLibraryAssetPublic {
  id: string
  libraryId: string
  name: string
  kind: AssetLibraryMediaKind
  mimeType: string
  url: string
  size: number
  duration?: number
  createdAt: string
  updatedAt: string
}

export interface AssetLibraryAssetList {
  items: AssetLibraryAssetPublic[]
}

export interface AssetLibraryAssetSearchItem extends AssetLibraryAssetPublic {
  libraryName: string
}

export interface AssetLibraryAssetSearchList {
  items: AssetLibraryAssetSearchItem[]
}
