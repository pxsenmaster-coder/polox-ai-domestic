import { z } from 'zod'

export const CANVAS_BATCH_SIZE = 100
export const canvasAssetIdSchema = z.string().min(1).max(200).regex(/^[\w.:-]+$/).refine(value => value !== '__viewport__')
const coordinate = z.number().finite().min(-1e7).max(1e7)
const layerScale = z.number().finite().min(0.01).max(100)
const canvasLayerEditSchema = z.object({
  id: z.string().min(1).max(200),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  dx: coordinate.optional(),
  dy: coordinate.optional(),
  scaleX: layerScale.optional(),
  scaleY: layerScale.optional(),
  zIndex: z.number().int().min(-100000).max(100000).optional(),
})
export const canvasLayerStateSchema = z.object({
  schemaVersion: z.literal(1),
  layers: z.array(canvasLayerEditSchema).max(17),
})
export const canvasRectSchema = z.object({
  hidden: z.boolean().optional(),
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(200).max(1600),
  height: z.number().finite().min(2).max(100000),
  layerState: canvasLayerStateSchema.optional(),
})
export const canvasCameraSchema = z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.12).max(3) })
export const canvasNodeSchema = canvasRectSchema.extend({ id: canvasAssetIdSchema })
export const canvasReadSchema = z.object({ ids: z.array(canvasAssetIdSchema).max(CANVAS_BATCH_SIZE) })
export const canvasPatchSchema = z.object({
  nodes: z.array(canvasNodeSchema).max(CANVAS_BATCH_SIZE),
  camera: canvasCameraSchema.optional(),
  nextSlot: z.number().int().min(0).max(1000000).optional(),
  version: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
})
export type CanvasRect = z.infer<typeof canvasRectSchema>
export type CanvasLayerState = z.infer<typeof canvasLayerStateSchema>
export type CanvasNode = z.infer<typeof canvasNodeSchema>
export type CanvasCamera = z.infer<typeof canvasCameraSchema>
export type CanvasPatch = z.infer<typeof canvasPatchSchema>
export interface CanvasLayoutResponse {
  nodes: CanvasNode[]
  camera: CanvasCamera | null
  nextSlot: number
  version: number
}
