import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { Buffer } from 'node:buffer'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { ARK_SEEDREAM_LAYER_MODEL, arkRequestModel, DEFAULT_ARK_BASE_URL, isArkGenerateModel } from '~~/shared/utils/arkSeedream'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { toUpstreamApiError } from './httpError'
import { readLayerResult } from './imageLayerSplitter'
import { readStoredMedia } from './localMedia'
import { readServiceSettings } from './serviceSettings'

const MAX_INPUT_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_LAYER_INPUT_IMAGE_BYTES = 30 * 1024 * 1024
const ARK_REQUEST_TIMEOUT_MS = 120_000
const ARK_STATUS_TIMEOUT_MS = 30_000
const ARK_POLL_INTERVAL_MS = 2_000
const ARK_POLL_TIMEOUT_MS = 8 * 60 * 1000
const ARK_TRANSIENT_RETRIES = 2

export type ArkTaskState = 'complete' | 'pending'

export interface ArkTaskResult {
  requestId: string
  urls: string[]
  payload: Record<string, unknown>
  requestBody: Record<string, unknown>
  state: ArkTaskState
  statusUrl?: string
  diagnostics: Record<string, unknown>
}

class ArkResponseError extends Error {
  statusCode: number
  retryable: boolean
  code: string
  data?: Record<string, unknown>

  constructor(message: string, options: { statusCode?: number, retryable?: boolean, code?: string, data?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'ArkResponseError'
    this.statusCode = options.statusCode || 502
    this.retryable = options.retryable === true
    this.code = options.code || 'ARK_UPSTREAM_ERROR'
    this.data = options.data
  }
}

export function isArkModel(model: string) {
  return isArkGenerateModel(model)
}

function baseUrl(value: string) {
  const raw = value.trim() || DEFAULT_ARK_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Ark base URL is invalid' })
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.volces.com'))
    throw createError({ statusCode: 400, statusMessage: 'Ark base URL must be an HTTPS volcengine endpoint' })
  return url.href.replace(/\/$/, '')
}

function arkCredentials() {
  const settings = readServiceSettings()
  if (!settings.arkApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ark API key is not configured',
    })
  }
  return {
    apiKey: settings.arkApiKey,
    baseUrl: baseUrl(settings.arkBaseUrl),
    model: settings.arkModel,
  }
}

async function arkReadableUrl(url: string, maxBytes = MAX_INPUT_IMAGE_BYTES) {
  const local = await readStoredMedia(url, maxBytes)
  if (!local)
    return url
  return `data:${local.mime};base64,${Buffer.from(local.bytes).toString('base64')}`
}

async function prepareArkInput(input: Record<string, unknown>) {
  const output = { ...input }
  const value = input.image_urls
  if (Array.isArray(value))
    output.image_urls = await Promise.all(value.map(item => typeof item === 'string' ? arkReadableUrl(item) : item))
  return output
}

function readPayload(text: string) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

function arkErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim())
      return message.trim()
  }
  return readErrorMessage(payload, fallback)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function imageResultUrl(value: unknown) {
  const url = stringValue(value)
  return /^https?:\/\//i.test(url) ? url : ''
}

/**
 * Ark has kept the normal `data[].url` response for Seedream, but gateways and
 * compatible endpoints sometimes wrap the same rows in `images`, `result`, or
 * `output`. Walk only response-shaped containers so an error/status URL is not
 * accidentally presented as an output image.
 */
export function resultUrls(payload: Record<string, unknown>) {
  const urls: string[] = []
  const seen = new Set<string>()
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || value == null)
      return
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = imageResultUrl(item)
        if (url && !seen.has(url)) {
          seen.add(url)
          urls.push(url)
        }
        else {
          visit(item, depth + 1)
        }
      }
      return
    }
    const row = recordValue(value)
    if (!row)
      return
    for (const key of ['url', 'image_url', 'imageUrl']) {
      const url = imageResultUrl(row[key])
      if (url && !seen.has(url)) {
        seen.add(url)
        urls.push(url)
      }
    }
    for (const key of ['data', 'images', 'layers', 'image', 'result', 'results', 'output', 'outputs', 'urls', 'image_urls', 'imageUrls'])
      visit(row[key], depth + 1)
  }
  visit(payload)
  return urls
}

function requestId(payload: Record<string, unknown>, fallback = ''): string {
  for (const key of ['id', 'request_id', 'requestId', 'task_id', 'taskId']) {
    const value = stringValue(payload[key])
    if (value)
      return value
  }
  for (const key of ['data', 'result', 'output']) {
    const row = recordValue(payload[key])
    if (row) {
      const value: string = requestId(row)
      if (value)
        return value
    }
  }
  return fallback
}

function responseStatus(payload: Record<string, unknown>) {
  const candidates: unknown[] = [payload.status, payload.state, payload.phase]
  for (const key of ['data', 'result', 'output']) {
    const row = recordValue(payload[key])
    if (row)
      candidates.push(row.status, row.state, row.phase)
  }
  return candidates.map(stringValue).find(Boolean)?.toLowerCase() || ''
}

function responseStatusUrl(payload: Record<string, unknown>) {
  const keys = ['status_url', 'statusUrl', 'poll_url', 'pollUrl', 'result_url', 'resultUrl']
  const read = (row: Record<string, unknown>) => keys.map(key => stringValue(row[key])).find(Boolean) || ''
  const direct = read(payload)
  if (direct)
    return direct
  for (const key of ['data', 'result', 'output']) {
    const row = recordValue(payload[key])
    const nested = row ? read(row) : ''
    if (nested)
      return nested
  }
  return ''
}

function isPendingStatus(status: string) {
  return ['queued', 'pending', 'in_queue', 'generating', 'processing', 'running', 'in_progress'].includes(status)
}

function isFailedStatus(status: string) {
  return ['failed', 'fail', 'error', 'cancelled', 'canceled', 'expired', 'not_found'].includes(status)
}

function responseDiagnostics(payload: Record<string, unknown>, urls: string[], id: string, status: string) {
  const data = Array.isArray(payload.data) ? payload.data : undefined
  const images = Array.isArray(payload.images) ? payload.images : undefined
  return {
    keys: Object.keys(payload).slice(0, 40),
    requestId: id,
    status,
    resultUrlCount: urls.length,
    dataCount: data?.length ?? 0,
    imageCount: images?.length ?? 0,
    hasStatusUrl: Boolean(responseStatusUrl(payload)),
    hasBase64: Boolean(payload.binary_data_base64 || payload.b64_json || payload.base64),
  }
}

function normalizePayload(payload: Record<string, unknown>, fallbackRequestId = '') {
  const urls = resultUrls(payload)
  const id = requestId(payload, fallbackRequestId)
  const status = responseStatus(payload)
  const statusUrl = responseStatusUrl(payload)
  const diagnostics = responseDiagnostics(payload, urls, id, status)
  return {
    requestId: id,
    urls,
    status,
    statusUrl,
    pending: isPendingStatus(status) || Boolean(statusUrl && !urls.length),
    failed: isFailedStatus(status),
    diagnostics,
  }
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function safeArkUrl(value: string, base: string) {
  let url: URL
  try {
    url = new URL(value, base)
  }
  catch {
    throw new ArkResponseError('Ark returned an invalid task status URL', { code: 'ARK_INVALID_STATUS_URL' })
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.volces.com'))
    throw new ArkResponseError('Ark returned an unsafe task status URL', { code: 'ARK_INVALID_STATUS_URL' })
  return url.href
}

async function readArkResponse(url: string, credentials: ReturnType<typeof arkCredentials>, init: RequestInit = {}, timeoutMs = ARK_REQUEST_TIMEOUT_MS) {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch (error) {
    const message = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'Ark request timed out'
      : 'Ark request could not be reached'
    throw new ArkResponseError(message, { code: message.includes('timed out') ? 'ARK_TIMEOUT' : 'ARK_NETWORK_ERROR', retryable: !message.includes('timed out') })
  }
  const text = await response.text()
  const payload = readPayload(text)
  if (!response.ok) {
    throw new ArkResponseError(arkErrorMessage(payload, `Ark generation failed (${response.status})`), {
      statusCode: response.status,
      retryable: retryableStatus(response.status),
      code: response.status === 429 ? 'ARK_RATE_LIMITED' : 'ARK_HTTP_ERROR',
      data: responseDiagnostics(payload, [], requestId(payload), responseStatus(payload)),
    })
  }
  return { payload, status: response.status }
}

function attachDiagnostics(error: unknown, diagnostics: Record<string, unknown>, code = '') {
  if (!error || typeof error !== 'object')
    return error
  const target = error as { data?: Record<string, unknown>, code?: string }
  target.data = { ...(target.data || {}), diagnostics, ...(code ? { code } : {}) }
  if (code)
    target.code = code
  return error
}

async function createArkResponse(credentials: ReturnType<typeof arkCredentials>, body: Record<string, unknown>) {
  let lastError: unknown
  for (let attempt = 0; attempt <= ARK_TRANSIENT_RETRIES; attempt++) {
    try {
      const result = await readArkResponse(`${credentials.baseUrl}/images/generations`, credentials, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const normalized = normalizePayload(result.payload)
      if (normalized.urls.length || normalized.pending || normalized.failed)
        return { ...result, normalized }
      const emptyError = new ArkResponseError('Ark returned no result URLs', {
        code: 'ARK_EMPTY_RESULT',
        retryable: !normalized.requestId && attempt < ARK_TRANSIENT_RETRIES,
        data: normalized.diagnostics,
      })
      if (!emptyError.retryable)
        throw emptyError
      lastError = emptyError
    }
    catch (error) {
      lastError = error
      if (!(error instanceof ArkResponseError) || !error.retryable || attempt >= ARK_TRANSIENT_RETRIES)
        throw error
    }
    await wait(400 * 2 ** attempt)
  }
  throw lastError instanceof Error ? lastError : new ArkResponseError('Ark generation failed')
}

export async function createArkTask(model: string, input: Record<string, unknown>) {
  if (!isArkGenerateModel(model))
    throw createError({ statusCode: 400, statusMessage: 'Unknown Ark model' })
  const credentials = arkCredentials()
  const prepared = await prepareArkInput(input)
  const images = Array.isArray(prepared.image_urls)
    ? prepared.image_urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const body: Record<string, unknown> = {
    model: arkRequestModel(model, credentials.model),
    prompt: String(prepared.prompt || '').trim(),
    response_format: 'url',
    stream: false,
    size: String(prepared.size || '2K'),
    watermark: prepared.watermark === true,
  }
  if (images.length)
    body.image = images
  try {
    const result = await createArkResponse(credentials, body)
    const normalized = result.normalized
    if (normalized.failed)
      throw new ArkResponseError(arkErrorMessage(result.payload, 'Ark generation failed'), { code: 'ARK_TASK_FAILED', data: normalized.diagnostics })
    if (normalized.pending && !normalized.statusUrl)
      throw new ArkResponseError('Ark returned a pending task without a status URL', { code: 'ARK_MISSING_STATUS_URL', data: normalized.diagnostics })
    return {
      requestId: normalized.requestId || `ark_${crypto.randomUUID()}`,
      urls: normalized.urls,
      payload: result.payload,
      requestBody: body,
      state: normalized.urls.length ? 'complete' as const : 'pending' as const,
      ...(normalized.statusUrl ? { statusUrl: safeArkUrl(normalized.statusUrl, credentials.baseUrl) } : {}),
      diagnostics: normalized.diagnostics,
    }
  }
  catch (error) {
    const upstream = toUpstreamApiError(error, 'Failed to create Ark Seedream task')
    if (error instanceof ArkResponseError)
      attachDiagnostics(upstream, error.data || {}, error.code)
    throw upstream
  }
}

interface ArkPollOptions {
  statusUrl: string
  timeoutMs?: number
  waitForResult?: boolean
}

async function readArkTaskStatus(credentials: ReturnType<typeof arkCredentials>, taskId: string, options: ArkPollOptions) {
  const statusUrl = safeArkUrl(options.statusUrl, credentials.baseUrl)
  const result = await readArkResponse(statusUrl, credentials, { method: 'GET' }, ARK_STATUS_TIMEOUT_MS)
  const normalized = normalizePayload(result.payload, taskId)
  if (normalized.failed)
    throw new ArkResponseError(arkErrorMessage(result.payload, 'Ark generation failed'), { code: 'ARK_TASK_FAILED', data: normalized.diagnostics })
  if (!normalized.urls.length && !normalized.pending)
    throw new ArkResponseError('Ark task completed without result URLs', { code: 'ARK_EMPTY_RESULT', data: normalized.diagnostics })
  return {
    requestId: normalized.requestId || taskId,
    urls: normalized.urls,
    payload: result.payload,
    state: normalized.urls.length ? 'complete' as const : 'pending' as const,
    statusUrl,
    diagnostics: normalized.diagnostics,
  }
}

/** Poll one provider status endpoint, or wait until it reaches a terminal state. */
export async function pollArkTask(taskId: string, options: ArkPollOptions) {
  const credentials = arkCredentials()
  const deadline = Date.now() + Math.max(ARK_POLL_INTERVAL_MS, options.timeoutMs || ARK_POLL_TIMEOUT_MS)
  let last: Awaited<ReturnType<typeof readArkTaskStatus>> | undefined
  while (Date.now() < deadline) {
    try {
      last = await readArkTaskStatus(credentials, taskId, options)
    }
    catch (error) {
      const upstream = toUpstreamApiError(error, 'Failed to poll Ark Seedream task')
      if (error instanceof ArkResponseError)
        attachDiagnostics(upstream, error.data || {}, error.code)
      throw upstream
    }
    if (last.state === 'complete' || options.waitForResult === false)
      return last
    await wait(ARK_POLL_INTERVAL_MS)
  }
  const timeout = new ArkResponseError('Ark generation timed out', { code: 'ARK_TIMEOUT', retryable: true, data: last?.diagnostics })
  const upstream = toUpstreamApiError(timeout, 'Failed to poll Ark Seedream task')
  attachDiagnostics(upstream, timeout.data || {}, timeout.code)
  throw upstream
}

function layerSize(value: unknown) {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === '1k' || raw === 'auto_1k' || raw === 'auto-1k')
    return '1K'
  if (raw === '1.5k' || raw === 'auto_1.5k' || raw === 'auto-1.5k')
    return '1.5K'
  if (raw === '2k' || raw === 'auto_2k' || raw === 'auto-2k')
    return '2K'
  return 'auto'
}

function layerDimensions(value: unknown) {
  const match = String(value || '').match(/^(\d+)x(\d+)$/i)
  if (!match)
    return {}
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

/**
 * Ark returns layer entries in `data`; the rest of the app consumes the
 * normalized `layers` shape used by the existing Fal layer splitter.
 */
async function normalizeArkLayerPayload(payload: Record<string, unknown>) {
  // Ark revisions have returned either a top-level `layers` array or layer
  // rows in `data`. Accept both shapes and normalize nested/flat image rows
  // before applying the same strict validation used by the Fal adapter.
  const rows = Array.isArray(payload.layers)
    ? payload.layers
    : Array.isArray(payload.data)
      ? payload.data
      : []
  if (!rows.length)
    throw new Error('Ark layer response did not contain editable layers')
  const layers = rows.map((item, index) => {
    if (!item || typeof item !== 'object')
      return null
    const row = item as Record<string, unknown>
    const image = row.image && typeof row.image === 'object' && !Array.isArray(row.image)
      ? row.image as Record<string, unknown>
      : row
    const url = typeof (row.url ?? image.url) === 'string' ? String(row.url ?? image.url).trim() : ''
    const rawZIndex = row.z_index ?? row.zIndex
    const zIndex = Number.isInteger(Number(rawZIndex)) ? Number(rawZIndex) : index
    const dimensions = {
      ...layerDimensions(row.size ?? image.size),
      ...(Number.isFinite(Number(row.width ?? image.width)) ? { width: Number(row.width ?? image.width) } : {}),
      ...(Number.isFinite(Number(row.height ?? image.height)) ? { height: Number(row.height ?? image.height) } : {}),
    }
    if (!/^https?:\/\//i.test(url) || !Number.isInteger(zIndex))
      return null
    return {
      image: { url, ...dimensions },
      z_index: zIndex,
      ...(typeof (row.name ?? image.name) === 'string' && String(row.name ?? image.name).trim() ? { name: String(row.name ?? image.name).trim() } : {}),
      ...(typeof (row.description ?? image.description) === 'string' && String(row.description ?? image.description).trim() ? { description: String(row.description ?? image.description).trim() } : {}),
      ...((row.bounding_box ?? image.bounding_box) !== undefined ? { bounding_box: row.bounding_box ?? image.bounding_box } : {}),
    }
  }).filter(item => item !== null)
  const checked = await readLayerResult({ layers })
  return {
    ...payload,
    resultUrls: checked.urls,
    layers: checked.layers,
    baseWidth: checked.width,
    baseHeight: checked.height,
  }
}

/** Seedream 5.0 Pro layer decomposition through the configured Ark endpoint. */
export async function createArkLayerTask(input: Record<string, unknown>) {
  const credentials = arkCredentials()
  const source = String(input.image_url || '').trim()
  if (!/^https?:\/\//i.test(source))
    throw createError({ statusCode: 400, statusMessage: 'Ark layer decomposition requires one HTTP image URL' })
  const prompt = String(input.prompt || '').trim()
  const preparedImage = await arkReadableUrl(source, MAX_LAYER_INPUT_IMAGE_BYTES)
  const body: Record<string, unknown> = {
    model: arkRequestModel(ARK_SEEDREAM_LAYER_MODEL, credentials.model),
    image: preparedImage,
    layer_decomposition: true,
    size: layerSize(input.image_size || input.size),
    output_format: 'png',
    response_format: 'url',
    stream: false,
    watermark: false,
  }
  if (prompt)
    body.prompt = prompt
  try {
    const result = await createArkResponse(credentials, body)
    if (result.normalized.failed)
      throw new ArkResponseError(arkErrorMessage(result.payload, 'Ark layer decomposition failed'), { code: 'ARK_LAYER_FAILED', data: result.normalized.diagnostics })
    if (result.normalized.pending) {
      if (!result.normalized.statusUrl)
        throw new ArkResponseError('Ark layer task is pending without a status URL', { code: 'ARK_MISSING_STATUS_URL', data: result.normalized.diagnostics })
      return {
        requestId: result.normalized.requestId || `ark_layer_${crypto.randomUUID()}`,
        urls: [],
        payload: result.payload,
        requestBody: body,
        state: 'pending' as const,
        statusUrl: safeArkUrl(result.normalized.statusUrl, credentials.baseUrl),
        diagnostics: result.normalized.diagnostics,
      }
    }
    const raw = result.payload
    const payload = await normalizeArkLayerPayload(raw)
    return {
      requestId: String(raw.id || result.normalized.requestId || `ark_layer_${crypto.randomUUID()}`).trim(),
      urls: payload.resultUrls as string[],
      payload,
      requestBody: body,
      state: 'complete' as const,
      diagnostics: result.normalized.diagnostics,
    }
  }
  catch (error) {
    const upstream = toUpstreamApiError(error, 'Failed to create Ark Seedream layer task')
    if (error instanceof ArkResponseError)
      attachDiagnostics(upstream, error.data || {}, error.code)
    throw upstream
  }
}

/** Refresh one Ark job without blocking the request for the full provider timeout. */
export async function syncJobFromArk(job: StoredDocument<IGenerationJob>) {
  if (job.provider !== 'ark')
    return job
  if (job.resultUrls.length || job.state === 'fail')
    return job
  const statusUrl = String(job.requestBody?.statusUrl || '').trim()
  if (!statusUrl) {
    job.state = 'fail'
    job.failCode = job.failCode || (job.providerTaskId ? 'ARK_MISSING_STATUS_URL' : 'ARK_EMPTY_RESULT')
    job.failMsg = job.failMsg || (job.providerTaskId
      ? 'Ark task is pending but no status URL was returned. Please retry.'
      : 'Ark returned no result URLs')
    await job.save()
    return job
  }
  try {
    const result = await pollArkTask(job.providerTaskId, { statusUrl, waitForResult: false })
    if (result.state === 'pending') {
      job.state = 'generating'
      job.resultJson = JSON.stringify(result.payload)
      job.lastSyncAt = new Date()
      await job.save()
      return job
    }
    let payload = result.payload
    let urls = result.urls
    if (isImageLayerSplitterModel(job.model)) {
      const layerPayload = await normalizeArkLayerPayload(result.payload)
      payload = layerPayload
      urls = layerPayload.resultUrls as string[]
    }
    job.resultJson = JSON.stringify(payload)
    job.resultUrls = urls
    job.sourceUrls = urls
    job.state = 'archiving'
    job.failCode = ''
    job.failMsg = ''
    job.lastSyncAt = new Date()
    await job.save()
  }
  catch (error) {
    job.state = 'fail'
    const errorData = error && typeof error === 'object' ? (error as { data?: unknown }).data : null
    const dataRecord = recordValue(errorData)
    job.failCode = String((error as { code?: unknown })?.code || dataRecord?.code || 'ARK_POLL_FAILED')
    job.failMsg = readErrorMessage(error, 'Failed to poll Ark Seedream task')
    if (dataRecord?.diagnostics)
      job.resultJson = JSON.stringify({ arkDiagnostics: dataRecord.diagnostics })
    job.lastSyncAt = new Date()
    await job.save()
  }
  return job
}
