import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { layerSelectionOverlaySvg } from '~~/shared/utils/agentLayerSelection'
import { saveMediaFile } from '../utils/localMedia'

async function fetchImageBytes(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  if (!response.ok || !response.body)
    throw new Error('Could not load the source image for layer preview.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      size += value.byteLength
      if (size > 30 * 1024 * 1024)
        throw new Error('Source images must be 30MB or smaller.')
      chunks.push(value)
    }
  }
  finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

/** Render numbered boxes locally so the LLM can inspect the same regions the user drew. */
export async function renderLayerSelectionOverlay(
  imageUrl: string,
  regions: Array<readonly [number, number, number, number] | number[]>,
  sessionId: string,
  signal?: AbortSignal,
) {
  const source = await fetchImageBytes(imageUrl, signal)
  const { data, info } = await sharp(source, { limitInputPixels: 64_000_000 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  const overlay = Buffer.from(layerSelectionOverlaySvg(regions, info.width, info.height))
  const bytes = await sharp(data).composite([{ input: overlay }]).png().toBuffer()
  const key = `agent-lab/${encodeURIComponent(sessionId)}/layer-boxes-${crypto.randomUUID()}.png`
  return saveMediaFile(key, bytes, 'image/png')
}
