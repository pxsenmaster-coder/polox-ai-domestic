import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canvasLayerStateSchema, canvasPatchSchema } from '../shared/types/canvas.ts'

const state = {
  schemaVersion: 1,
  layers: [
    { id: 'agent_task:layer:1', hidden: true, dx: 12, dy: -8, scaleX: 1.1, scaleY: 0.9, zIndex: 2 },
  ],
}

test('canvas layer state accepts bounded visibility, transform, and order edits', () => {
  assert.equal(canvasLayerStateSchema.safeParse(state).success, true)
  assert.equal(canvasPatchSchema.safeParse({
    nodes: [{ id: 'agent_task:0', x: 0, y: 0, width: 500, height: 700, layerState: state }],
    version: 1,
  }).success, true)
})


test('canvas layer state rejects oversized or unsafe edits', () => {
  assert.equal(canvasLayerStateSchema.safeParse({
    schemaVersion: 1,
    layers: Array.from({ length: 18 }, (_, index) => ({ id: `layer-${index}` })),
  }).success, false)
  assert.equal(canvasLayerStateSchema.safeParse({
    schemaVersion: 1,
    layers: [{ id: 'layer', scaleX: 0 }],
  }).success, false)
})
