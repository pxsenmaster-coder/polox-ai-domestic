import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const canvas = await readFile(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
const preview = await readFile(new URL('../app/components/tools/ImageLayerStackPreview.vue', import.meta.url), 'utf8')

test('selecting a layer from the toolbar enters layer editing', () => {
  assert.match(canvas, /function selectLayerForEditing\(asset: Asset, layerId: string\)/)
  assert.match(canvas, /@click\.stop="selectLayerForEditing\(asset, layer\.id\)"/)
  assert.match(canvas, /editingLayerGroupId\.value = asset\.id/)
})

test('layer editing prevents the parent card from starting a drag', () => {
  assert.match(canvas, /const editorScope = computed<'canvas' \| 'layer'>/)
  assert.match(canvas, /selection\.size === 1 && selection\.has\(asset\.id\) && editorScope === 'canvas'/)
  assert.match(canvas, /if \(id && isLayerEditingAsset\(id\) && !hand\.value && !space\.value\)/)
  assert.match(canvas, /@pointerup="completePointer"/)
  assert.match(canvas, /@pointercancel="cancelPointer"/)
  assert.match(canvas, /@lostpointercapture="cancelPointer"/)
})

test('locked layers expose a non-draggable state and no resize handles', () => {
  assert.match(preview, /function isLocked\(layer: ImageLayerPublic\)/)
  assert.match(preview, /cursor-not-allowed opacity-80/)
  assert.match(preview, /props\.selectedLayerId === layer\.id && !isLocked\(layer\)/)
})

test('layer transforms use the local preview coordinate system', () => {
  assert.match(canvas, /function layerPreviewSize\(point: CanvasRect\)/)
  assert.match(canvas, /function layerDelta\(point: CanvasRect, startX: number, startY: number, currentX: number, currentY: number\)/)
  assert.match(canvas, /\(currentX - startX\) \/ camera\.zoom \/ preview\.width \* 1000/)
  assert.match(canvas, /point\.height - CARD_CHROME_HEIGHT/)
})

test('cancelled outer gestures restore their original canvas state', () => {
  assert.match(canvas, /if \(drag\?\.id\)[\s\S]*positions\.value = new Map\(positions\.value\)\.set\(drag\.id, \{ \.\.\.drag\.cardOrigin! \}\)/)
  assert.match(canvas, /if \(resize\)[\s\S]*positions\.value = new Map\(positions\.value\)\.set\(resize\.id, \{ \.\.\.resize\.origin \}\)/)
  assert.match(canvas, /if \(pinch\)[\s\S]*Object\.assign\(camera, pinch\.camera\)/)
  assert.match(canvas, /completedPointer === event\.pointerId/)
  assert.match(canvas, /synthetic loss so a completed drag is not rolled back/)
})

test('layer corner resize updates position and scale around the opposite anchor', () => {
  assert.match(canvas, /function layerBaseRect\(layer: ImageLayerPublic\)/)
  assert.match(canvas, /const current = layerCanvasRect\(layer, origin\)/)
  assert.match(canvas, /dx: left - base\.left/)
  assert.match(canvas, /dy: top - base\.top/)
  assert.match(canvas, /scaleX: Math\.max\(0\.01, Math\.min\(100, width \/ base\.width\)\)/)
})

test('layer editing scope validates that the selected layer belongs to the active asset', () => {
  assert.match(canvas, /const editingLayer = computed\(\(\) => \{/)
  assert.match(canvas, /asset\.job\?\.layers\?\.some\(layer => layer\.id === layerId\)/)
  assert.match(canvas, /const editorScope = computed<'canvas' \| 'layer'>\(\(\) => editingLayer\.value \? 'layer' : 'canvas'\)/)
})
