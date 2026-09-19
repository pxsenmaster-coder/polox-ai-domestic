import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  layerRectFromBoundingBox,
  layerRenderMode,
  normalizeLayerBoundingBox,
  orderedImageLayers,
} from '../shared/utils/imageLayerComposition.ts'

const canvas = { width: 1200, height: 1600 }

test('normalizes provider bounding boxes into 0-1000 coordinates', () => {
  assert.deepEqual(normalizeLayerBoundingBox({ normalized: [100, 200, 900, 300] }, canvas), [100, 200, 900, 300])
  assert.deepEqual(normalizeLayerBoundingBox({ absolute: [120, 320, 1080, 480] }, canvas), [100, 200, 900, 300])
  assert.deepEqual(normalizeLayerBoundingBox({ x: 0.1, y: 0.2, width: 0.8, height: 0.1 }, canvas), [100, 200, 900, 300])
  assert.equal(normalizeLayerBoundingBox({ normalized: [900, 300, 100, 200] }, canvas), undefined)
})

test('detects full-canvas, cropped, and unplaced layers', () => {
  assert.equal(layerRenderMode({ role: 'base' }, canvas), 'full-canvas')
  assert.equal(layerRenderMode({ role: 'foreground', imageWidth: 1200, imageHeight: 1600 }, canvas), 'full-canvas')
  assert.equal(layerRenderMode({ role: 'foreground', boundingBox: [100, 200, 900, 300], imageWidth: 700, imageHeight: 180 }, canvas), 'cropped')
  assert.equal(layerRenderMode({ role: 'foreground', imageWidth: 700, imageHeight: 180 }, canvas), 'unplaced')
})

test('maps normalized boxes to display rectangles', () => {
  assert.deepEqual(layerRectFromBoundingBox([100, 200, 900, 300], { width: 600, height: 800 }), {
    left: 60,
    top: 160,
    width: 480,
    height: 80,
  })
})

test('orders layers by z-index and keeps deterministic ties', () => {
  const layers = [
    { id: 'b', zIndex: 2 },
    { id: 'a', zIndex: 1 },
    { id: 'c', zIndex: 2 },
  ]
  assert.deepEqual(orderedImageLayers(layers).map(layer => layer.id), ['a', 'b', 'c'])
})
