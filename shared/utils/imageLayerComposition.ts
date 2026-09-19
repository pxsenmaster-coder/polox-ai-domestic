import type { ImageLayerBoundingBox, ImageLayerCanvas, ImageLayerPublic, ImageLayerRenderMode } from '../types/generation'

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validCanvas(canvas?: ImageLayerCanvas) {
  return Boolean(canvas && finite(canvas.width) && finite(canvas.height) && canvas.width > 0 && canvas.height > 0)
}

function canonicalBox(values: unknown, mode: 'normalized' | 'absolute', canvas?: ImageLayerCanvas): ImageLayerBoundingBox | undefined {
  if (!Array.isArray(values) || values.length !== 4 || values.some(value => !finite(value)))
    return undefined
  const numbers = values.map(value => Number(value))
  const normalized = mode === 'normalized'
    ? numbers
    : validCanvas(canvas)
      ? [numbers[0]! / canvas!.width * 1000, numbers[1]! / canvas!.height * 1000, numbers[2]! / canvas!.width * 1000, numbers[3]! / canvas!.height * 1000]
      : undefined
  if (!normalized)
    return undefined
  const clamped = normalized.map(value => Math.max(0, Math.min(1000, Math.round(value)))) as ImageLayerBoundingBox
  if (clamped[0] >= clamped[2] || clamped[1] >= clamped[3])
    return undefined
  return clamped
}

/** Convert provider-specific layer boxes to the app's normalized 0–1000 space. */
export function normalizeLayerBoundingBox(value: unknown, canvas?: ImageLayerCanvas): ImageLayerBoundingBox | undefined {
  if (Array.isArray(value))
    return canonicalBox(value, 'normalized', canvas)
  if (!value || typeof value !== 'object')
    return undefined
  const row = value as Record<string, unknown>
  for (const key of ['normalized', 'normalised']) {
    const box = canonicalBox(row[key], 'normalized', canvas)
    if (box)
      return box
  }
  const absolute = canonicalBox(row.absolute, 'absolute', canvas)
  if (absolute)
    return absolute
  const x = row.x
  const y = row.y
  const width = row.width
  const height = row.height
  if (finite(x) && finite(y) && finite(width) && finite(height)) {
    const box = validCanvas(canvas) && (Number(x) > 1 || Number(y) > 1 || Number(width) > 1 || Number(height) > 1)
      ? canonicalBox([Number(x), Number(y), Number(x) + Number(width), Number(y) + Number(height)], 'absolute', canvas)
      : canonicalBox([Number(x) * 1000, Number(y) * 1000, (Number(x) + Number(width)) * 1000, (Number(y) + Number(height)) * 1000], 'normalized', canvas)
    if (box)
      return box
  }
  return undefined
}

export function layerRenderMode(layer: Pick<ImageLayerPublic, 'role' | 'boundingBox' | 'imageWidth' | 'imageHeight'>, canvas?: ImageLayerCanvas): ImageLayerRenderMode {
  if (layer.role === 'base') {
    return 'full-canvas'
  }
  if (validCanvas(canvas) && finite(layer.imageWidth) && finite(layer.imageHeight)
    && Math.abs(Number(layer.imageWidth) - canvas!.width) <= 1
    && Math.abs(Number(layer.imageHeight) - canvas!.height) <= 1) {
    return 'full-canvas'
  }
  return layer.boundingBox ? 'cropped' : 'unplaced'
}

export function layerRectFromBoundingBox(box: ImageLayerBoundingBox, display: { width: number, height: number }) {
  return {
    left: box[0] / 1000 * display.width,
    top: box[1] / 1000 * display.height,
    width: (box[2] - box[0]) / 1000 * display.width,
    height: (box[3] - box[1]) / 1000 * display.height,
  }
}

export function orderedImageLayers(layers: ImageLayerPublic[]) {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
}
