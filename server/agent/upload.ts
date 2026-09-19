import { uploadFalFile } from '../utils/falFiles'
import { saveMediaFile } from '../utils/localMedia'
import { readServiceSettings } from '../utils/serviceSettings'

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
}
export async function uploadAgentImage(sessionId: string, file: {
  bytes: Uint8Array
  mime: string
}) {
  const extension = IMAGE_EXTENSIONS[file.mime]
  if (!extension)
    throw new Error('This image type is not supported')
  if (!file.bytes.byteLength || file.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error('Each image must be between 1 byte and 10MB')
  if (!sessionId)
    throw new Error('A session is required')
  const key = `agent-lab/${encodeURIComponent(sessionId)}/${crypto.randomUUID()}.${extension}`
  const localUrl = await saveMediaFile(key, file.bytes, file.mime)
  // Local media is the canonical upload destination. Fal is optional and is
  // only needed as a CDN bridge for legacy fal-hosted models. Ark can consume
  // the local URL server-side, so an absent or unavailable fal key must not
  // make an otherwise valid upload fail.
  if (!readServiceSettings().falKey)
    return localUrl
  try {
    return await uploadFalFile(file.bytes, file.mime, `upload.${extension}`)
  }
  catch (error) {
    console.warn('[agent-upload] fal upload unavailable; using local media URL', error)
    return localUrl
  }
}
