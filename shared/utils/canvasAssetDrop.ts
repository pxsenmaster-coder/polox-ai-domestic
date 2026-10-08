import type { AssetLibraryAssetPublic } from '../types/assetLibrary'

export interface CanvasDroppedAsset {
  id: string
  url: string
  name: string
  kind: 'image' | 'video' | 'audio'
}

export function canvasDropUploadCounts(totalFiles: number, acceptedFiles: number, attemptedFiles: number, uploadedFiles: number) {
  const total = Math.max(0, Math.floor(totalFiles))
  const accepted = Math.min(total, Math.max(0, Math.floor(acceptedFiles)))
  const attempted = Math.min(accepted, Math.max(0, Math.floor(attemptedFiles)))
  const uploaded = Math.min(attempted, Math.max(0, Math.floor(uploadedFiles)))
  return { uploaded, failed: attempted - uploaded, skipped: total - attempted }
}

export function parseCanvasLibraryAsset(value: string): CanvasDroppedAsset | null {
  try {
    const asset = JSON.parse(value) as Partial<AssetLibraryAssetPublic>
    if (!asset.id || typeof asset.url !== 'string' || !asset.url || typeof asset.name !== 'string')
      return null
    if (!/^(?:https?:\/\/|\/(?!\/))/i.test(asset.url))
      return null
    const knownKind = asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio'
      ? asset.kind
      : null
    const mime = String(asset.mimeType || '').toLowerCase()
    const extension = asset.name.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|bmp|mp4|mov|mkv|mp3|wav|aac|ogg|m4a)$/)?.[1]
    const kind = knownKind
      || (mime.startsWith('image/') || /^(?:jpe?g|png|webp|gif|avif|bmp)$/.test(extension || '') ? 'image' : null)
      || (mime.startsWith('video/') || /^(?:mp4|mov|mkv)$/.test(extension || '') ? 'video' : null)
      || (mime.startsWith('audio/') || /^(?:mp3|wav|aac|ogg|m4a)$/.test(extension || '') ? 'audio' : null)
    if (!kind)
      return null
    return { id: asset.id, url: asset.url, name: asset.name, kind }
  }
  catch {
    return null
  }
}

export function canvasDropPoint(
  clientX: number,
  clientY: number,
  bounds: { left: number, top: number },
  camera: { x: number, y: number, zoom: number },
) {
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1
  return {
    x: (clientX - bounds.left - camera.x) / zoom,
    y: (clientY - bounds.top - camera.y) / zoom,
  }
}
