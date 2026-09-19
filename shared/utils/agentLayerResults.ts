import type { ImageLayerPublic } from '../types/generation'
import { isImageLayerSplitterModel } from './imageLayerSplitter'

interface LayerJob {
  model: string
  state: string
  resultUrls: string[]
  taskId?: string
  layers?: ImageLayerPublic[]
}

export function completedLayerResults<T extends { id: string }>(image: T, job: LayerJob) {
  if (!isImageLayerSplitterModel(job.model) || job.state !== 'success' || !job.resultUrls.length)
    return []
  return job.resultUrls.map((url, index) => ({
    ...image,
    id: index ? `${image.id}_${index}` : image.id,
    name: job.layers?.[index]?.name || (index ? `Layer ${index}` : 'Background'),
    status: 'success' as const,
    url,
    error: '',
    layerGroupId: job.taskId || image.id,
    layerId: job.layers?.[index]?.id || `${job.taskId || image.id}:layer:${index}`,
    layerIndex: index,
    layer: job.layers?.[index],
  }))
}
