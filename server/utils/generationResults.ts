import type { GenerationJobPublic, ImageLayerCanvas, ImageLayerPublic } from '../../shared/types/generation'
import type { IGenerationJob, IResultAsset } from '../models/generationJob'
import { layerRenderMode, normalizeLayerBoundingBox } from '~~/shared/utils/imageLayerComposition'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'

export function parseResultUrls(resultJson?: string) {
  if (!resultJson)
    return []

  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>
    const lists = [parsed.resultUrls, parsed.result_urls, parsed.urls, parsed.originUrls]
    for (const list of lists) {
      if (!Array.isArray(list))
        continue
      const urls = list.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
      if (urls.length)
        return urls
    }
    for (const key of ['resultUrl', 'video_url', 'image_url', 'url']) {
      const value = parsed[key]
      if (typeof value === 'string' && /^https?:\/\//.test(value))
        return [value]
    }
    return []
  }
  catch {
    return []
  }
}

function toCompletedAt(job: IGenerationJob) {
  if (job.state !== 'success' && job.state !== 'fail')
    return ''

  if (typeof job.completeTime === 'number' && Number.isFinite(job.completeTime) && job.completeTime > 0) {
    const ms = job.completeTime < 1e12 ? job.completeTime * 1000 : job.completeTime
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime()))
      return date.toISOString()
  }

  return job.updatedAt.toISOString()
}

function httpJobUrls(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(url => /^https?:\/\//i.test(url))
  }
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? [url] : []
}

function inputUrlSet(job: IGenerationJob) {
  const input = job.input && typeof job.input === 'object' ? job.input : {}
  return new Set([
    ...httpJobUrls(input.reference_image_urls),
    ...httpJobUrls(input.reference_video_urls),
    ...httpJobUrls(input.first_frame_url),
    ...httpJobUrls(input.last_frame_url),
    ...httpJobUrls(input.input_urls),
    ...['image_urls', 'video_urls', 'audio_urls', 'image_url', 'start_image_url', 'end_image_url'].flatMap(key => httpJobUrls(input[key])),
  ])
}

function publicResultUrls(job: IGenerationJob) {
  if (job.state === 'fail')
    return []
  if (job.resultUrls?.length)
    return job.resultUrls
  if (job.state !== 'success' && job.state !== 'archiving' && job.state !== 'moderating')
    return []
  const inputs = inputUrlSet(job)
  const fromAssets = (job.resultAssets || [])
    .map(asset => String(asset.localUrl || asset.sourceUrl || '').trim())
    .filter(url => /^https?:\/\//i.test(url) && !inputs.has(url))
  if (fromAssets.length)
    return fromAssets
  return (job.sourceUrls || []).filter(url => /^https?:\/\//i.test(url) && !inputs.has(url))
}

interface RawLayerResult {
  image?: { url?: unknown, width?: unknown, height?: unknown }
  z_index?: unknown
  name?: unknown
  description?: unknown
  bounding_box?: unknown
}

function readLayerPayload(job: IGenerationJob) {
  try {
    const result = JSON.parse(job.resultJson || '') as Record<string, unknown>
    return result
  }
  catch {
    return undefined
  }
}

function publicImageLayerData(job: IGenerationJob): { layers?: ImageLayerPublic[], canvas?: ImageLayerCanvas } {
  if (!isImageLayerSplitterModel(job.model) || job.state !== 'success')
    return {}
  const result = readLayerPayload(job)
  const rawLayers = Array.isArray(result?.layers) ? result.layers as RawLayerResult[] : []
  if (!rawLayers.length)
    return {}
  const rawWidth = Number(result?.baseWidth)
  const rawHeight = Number(result?.baseHeight)
  const canvas = Number.isFinite(rawWidth) && rawWidth > 0 && Number.isFinite(rawHeight) && rawHeight > 0
    ? { width: rawWidth, height: rawHeight }
    : undefined
  const urls = publicResultUrls(job)
  const layers = rawLayers.map((layer, index): ImageLayerPublic | null => {
    const image = layer.image || {}
    const url = String(urls[index] || image.url || '').trim()
    const zIndex = Number(layer.z_index)
    if (!/^https?:\/\//i.test(url) || !Number.isInteger(zIndex))
      return null
    const imageWidth = Number(image.width)
    const imageHeight = Number(image.height)
    const dimensions = {
      ...(Number.isFinite(imageWidth) && imageWidth > 0 ? { imageWidth } : {}),
      ...(Number.isFinite(imageHeight) && imageHeight > 0 ? { imageHeight } : {}),
    }
    const role = index === 0 ? 'base' as const : 'foreground' as const
    const boundingBox = normalizeLayerBoundingBox(layer.bounding_box, canvas)
    const renderMode = layerRenderMode({ role, boundingBox, ...dimensions }, canvas)
    return {
      id: `${job.taskId}:layer:${index}`,
      url,
      name: String(layer.name || (index === 0 ? 'Background' : `Layer ${zIndex}`)),
      description: String(layer.description || ''),
      zIndex,
      role,
      renderMode,
      ...(boundingBox ? { boundingBox } : {}),
      ...dimensions,
    }
  }).filter((layer): layer is ImageLayerPublic => Boolean(layer))
  return {
    ...(layers.length ? { layers } : {}),
    ...(canvas ? { canvas } : {}),
  }
}

export function toPublicJob(job: IGenerationJob): GenerationJobPublic {
  const prompt = typeof job.input?.prompt === 'string' ? job.input.prompt : ''
  const layerData = isImageLayerSplitterModel(job.model) ? publicImageLayerData(job) : {}
  return {
    taskId: job.taskId,
    projectId: job.projectId || '',
    model: job.model,
    category: job.category || '',
    task: job.task || '',
    prompt,
    input: job.input && typeof job.input === 'object' ? job.input : {},
    state: job.state,
    ...(job.archiveProgress ? { archiveProgress: job.archiveProgress } : {}),
    resultUrls: publicResultUrls(job),
    ...(layerData.layers ? { layers: layerData.layers } : {}),
    ...(layerData.canvas ? { layerCanvas: layerData.canvas } : {}),
    failCode: job.failCode || '',
    failMsg: job.failMsg || '',
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: toCompletedAt(job),

  }
}

function emptyAsset(sourceUrl: string): IResultAsset {
  return {
    sourceUrl,
    localUrl: '',
    localKey: '',
    contentType: '',
    status: 'pending',
    error: '',
  }
}

export function mergeSourceUrls(job: IGenerationJob, urls: string[]) {
  job.sourceUrls = urls
  const existing = new Map((job.resultAssets || []).map(asset => [asset.sourceUrl, asset]))
  job.resultAssets = urls.map(sourceUrl => existing.get(sourceUrl) || emptyAsset(sourceUrl))
}
