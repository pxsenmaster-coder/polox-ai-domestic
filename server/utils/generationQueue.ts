import type { IGenerationJob } from '../models/generationJob'
import type { GenerationProviderQueue } from './generationConcurrency'
import type { StoredDocument } from './sqlite'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { createArkLayerTask, createArkTask } from './arkGenerate'
import { createFalTask } from './falGenerate'
import { generationConcurrency } from './generationConcurrency'
import { isProviderStarted } from './generationJobs'

type GenerationJobDocument = StoredDocument<IGenerationJob>
let dispatching: Promise<void> | undefined
let dispatchAgain = false
function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
function errorCode(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : ''
  return typeof code === 'string' ? code.slice(0, 80) : ''
}
function errorDiagnostics(error: unknown) {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null
  const diagnostics = asRecord(data)?.diagnostics
  return diagnostics ? { arkDiagnostics: diagnostics } : undefined
}
export function newLocalTaskId() {
  return `job_${crypto.randomUUID()}`
}
export async function countActiveGenerationJobs(queue?: GenerationProviderQueue) {
  const filter: Record<string, unknown> = {
    deleted: { $ne: true },
    state: { $in: [...GENERATION_ACTIVE_STATES] },
  }
  if (queue === 'ark' || queue === 'fal')
    filter.provider = queue
  else if (queue === 'unassigned')
    filter.$or = [{ provider: { $exists: false } }, { provider: '' }, { provider: null }]
  return GenerationJob.countDocuments(filter)
}
async function failUnstartedJob(job: GenerationJobDocument, error: unknown) {
  const message = readErrorMessage(error, 'Generation failed')
  job.state = 'fail'
  job.failCode = errorCode(error)
  job.failMsg = message
  const diagnostics = errorDiagnostics(error)
  if (diagnostics)
    job.resultJson = JSON.stringify(diagnostics)
  await job.save()
  return job
}
async function startProviderTask(job: GenerationJobDocument) {
  if (job.provider && job.provider !== 'fal' && job.provider !== 'ark')
    return failUnstartedJob(job, new Error('This task belongs to a retired provider. Please generate again.'))
  const original = asRecord(job.originalRequest)
  if (original?.source === 'agent' && original?.holdSlot === true) {
    if (job.state === 'queued' || job.state === 'waiting' || job.state === 'queuing') {
      job.state = 'generating'
      job.lastSyncAt = new Date()
      await job.save()
    }
    return job
  }
  if (isProviderStarted(job))
    return job
  const requestBody = asRecord(job.requestBody) || {}
  // Ignore legacy text-compositing metadata on already persisted jobs.
  const { _textEdit, ...input } = job.input && typeof job.input === 'object' ? job.input : {}
  if (job.provider === 'ark') {
    const arkTask = isImageLayerSplitterModel(job.model)
      ? await createArkLayerTask(input)
      : await createArkTask(String(job.model || '').trim(), input)
    job.providerTaskId = arkTask.requestId
    job.requestBody = {
      ...requestBody,
      ...arkTask.requestBody,
      ...(arkTask.statusUrl ? { statusUrl: arkTask.statusUrl } : {}),
    }
    job.resultJson = JSON.stringify(arkTask.payload)
    job.resultUrls = arkTask.urls
    job.sourceUrls = arkTask.urls
    job.state = arkTask.state === 'pending' ? 'waiting' : 'archiving'
    job.failCode = ''
    job.failMsg = ''
    job.lastSyncAt = new Date()
    await job.save()
    return job
  }
  {
    const falModel = String(requestBody.model || job.model || '').trim()
    const falTask = await createFalTask(falModel, input)
    job.providerTaskId = falTask.requestId
    job.requestBody = {
      ...requestBody,
      statusUrl: falTask.statusUrl,
      responseUrl: falTask.responseUrl,
    }
    job.state = 'waiting'
    job.lastSyncAt = new Date()
    await job.save()
    return job
  }
}
function providerFilter(queue: GenerationProviderQueue) {
  if (queue === 'ark' || queue === 'fal')
    return { provider: queue }
  return { $or: [{ provider: { $exists: false } }, { provider: '' }, { provider: null }] }
}

async function dispatchProvider(queue: GenerationProviderQueue, globalLimit: number) {
  const limit = await generationConcurrency(queue)
  for (let i = 0; i < limit + 2; i++) {
    const active = await countActiveGenerationJobs(queue)
    const globalActive = await countActiveGenerationJobs()
    if (active >= limit || globalActive >= globalLimit)
      return
    const claimed = await GenerationJob.findOneAndUpdate({
      deleted: { $ne: true },
      state: 'queued',
      ...providerFilter(queue),
    }, {
      $set: {
        state: 'waiting',
        lastSyncAt: new Date(),
      },
    }, {
      sort: { createdAt: 1 },
      new: true,
    })
    if (!claimed)
      return
    const activeAfter = await countActiveGenerationJobs(queue)
    const globalAfter = await countActiveGenerationJobs()
    if (activeAfter > limit || globalAfter > globalLimit) {
      if (!isProviderStarted(claimed)) {
        claimed.state = 'queued'
        await claimed.save()
      }
      return
    }
    try {
      await startProviderTask(claimed)
    }
    catch (error) {
      console.error('[generation queue start]', claimed.taskId, error)
      await failUnstartedJob(claimed, error)
    }
  }
}
async function dispatchOnce() {
  const globalLimit = await generationConcurrency()
  for (const queue of ['ark', 'fal', 'unassigned'] as const)
    await dispatchProvider(queue, globalLimit)
}
export function dispatchQueuedJobs(): Promise<void> {
  dispatchAgain = true
  if (dispatching)
    return dispatching
  dispatching = (async () => {
    try {
      do {
        dispatchAgain = false
        await dispatchOnce()
      } while (dispatchAgain)
    }
    catch (error) {
      console.error('[generation queue]', error)
    }
    finally {
      dispatching = undefined
    }
  })()
  return dispatching
}

export async function startPendingProviderJob(job: GenerationJobDocument) {
  if (job.state === 'queued') {
    await dispatchQueuedJobs()
    return (await GenerationJob.findById(job._id)) || job
  }
  if ((job.state === 'waiting' || job.state === 'queuing' || job.state === 'generating') && !isProviderStarted(job)) {
    try {
      return await startProviderTask(job)
    }
    catch (error) {
      console.error('[generation queue retry]', job.taskId, error)
      return failUnstartedJob(job, error)
    }
  }
  return job
}
