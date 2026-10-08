import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canvasDropPoint, canvasDropUploadCounts, parseCanvasLibraryAsset } from '../shared/utils/canvasAssetDrop.ts'
import { assetLibraryMediaKind, assetLibraryMimeType, isAssetLibraryAcceptFile } from '../shared/types/assetLibrary.ts'

test('upload media types resolve common blank and generic browser MIME values from safe extensions', () => {
  assert.equal(assetLibraryMimeType('', 'portrait.JPG'), 'image/jpeg')
  assert.equal(assetLibraryMimeType('application/octet-stream', 'voice.m4a'), 'audio/mp4')
  assert.equal(assetLibraryMimeType('audio/x-m4a', 'voice.m4a'), 'audio/mp4')
  assert.equal(assetLibraryMimeType('image/heic', 'portrait.jpg'), null)
  assert.equal(isAssetLibraryAcceptFile({ type: '', name: 'portrait.jpg' }), true)
  assert.equal(assetLibraryMediaKind('', 'voice.m4a'), 'audio')
  assert.equal(assetLibraryMediaKind('', 'notes.txt'), null)
})

test('drop upload summaries distinguish success, failed uploads, and skipped files', () => {
  assert.deepEqual(canvasDropUploadCounts(3, 2, 2, 1), { uploaded: 1, failed: 1, skipped: 1 })
  assert.deepEqual(canvasDropUploadCounts(13, 13, 12, 12), { uploaded: 12, failed: 0, skipped: 1 })
  assert.deepEqual(canvasDropUploadCounts(2, 2, 2, 2), { uploaded: 2, failed: 0, skipped: 0 })
})

test('library drag payload accepts supported media and preserves asset identity', () => {
  assert.deepEqual(parseCanvasLibraryAsset(JSON.stringify({ id: 'asset-1', url: 'https://cdn.example/photo.webp', name: 'Cover', kind: 'image' })), {
    id: 'asset-1',
    url: 'https://cdn.example/photo.webp',
    name: 'Cover',
    kind: 'image',
  })
  assert.equal(parseCanvasLibraryAsset(JSON.stringify({ id: 'asset-2', url: '/media/audio.mp3', name: 'Track', mimeType: 'audio/mpeg' }))?.kind, 'audio')
})

test('library drag payload rejects unsafe or incomplete URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,abc', '//outside.example/image.png', '']) {
    assert.equal(parseCanvasLibraryAsset(JSON.stringify({ id: 'asset', url, name: 'Unsafe', kind: 'image' })), null)
  }
  assert.equal(parseCanvasLibraryAsset('{broken json'), null)
  assert.equal(parseCanvasLibraryAsset(JSON.stringify({ id: 'asset', url: '/media/unknown', name: 'Unknown' })), null)
})

test('drop coordinates map the pointer through camera offset and zoom', () => {
  assert.deepEqual(canvasDropPoint(320, 260, { left: 20, top: 10 }, { x: 100, y: 50, zoom: 2 }), { x: 100, y: 100 })
  assert.deepEqual(canvasDropPoint(20, 10, { left: 20, top: 10 }, { x: 0, y: 0, zoom: 0 }), { x: 0, y: 0 })
})
