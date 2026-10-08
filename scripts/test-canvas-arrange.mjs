import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARRANGE_CELL_HEIGHT, ARRANGE_CELL_WIDTH, ARRANGE_COLUMN_GAP, ARRANGE_COLUMNS, ARRANGE_ROW_GAP, arrangeCanvasItems } from '../shared/utils/canvasArrange.ts'

const rect = (width = 280, height = 282) => ({ x: 999, y: 777, width, height })
const item = (id, createdAt, extra = {}) => ({ id, createdAt, rect: rect(), ...extra })

test('arrange order is deterministic and supports oldest, newest and media type modes', () => {
  const items = [
    item('old', '2025-01-01'),
    item('new', '2026-01-01'),
    item('video', '2025-02-01', { video: true }),
    item('audio', '2025-03-01', { audio: true }),
  ]
  assert.deepEqual([...arrangeCanvasItems(items, 'oldest').keys()], ['old', 'video', 'audio', 'new'])
  assert.deepEqual([...arrangeCanvasItems(items, 'newest').keys()], ['new', 'audio', 'video', 'old'])
  assert.deepEqual([...arrangeCanvasItems(items, 'type').keys()], ['old', 'new', 'video', 'audio'])
  assert.deepEqual([...arrangeCanvasItems([...items].reverse(), 'oldest')], [...arrangeCanvasItems(items, 'oldest')])
})

test('arrangement uses ten fixed columns and wraps to the next row', () => {
  const items = Array.from({ length: 11 }, (_, index) => item(`asset:${index}`, `2026-01-${String(index + 1).padStart(2, '0')}`))
  const result = arrangeCanvasItems(items)
  for (const [index, point] of [...result.values()].entries()) {
    assert.equal(point.x, (index % ARRANGE_COLUMNS) * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
    assert.equal(point.y, Math.floor(index / ARRANGE_COLUMNS) * (ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP))
  }
})

test('results from one generation stay together and source-derived assets stay adjacent', () => {
  const items = [
    item('source', '2026-01-01', { url: 'https://local/source.png', taskId: 'source-task' }),
    item('unrelated', '2026-01-02', { taskId: 'other-task' }),
    item('derived-a', '2026-01-03', { taskId: 'derived-task', resultIndex: 0, sourceUrls: ['https://local/source.png'] }),
    item('derived-b', '2026-01-03', { taskId: 'derived-task', resultIndex: 1, sourceUrls: ['https://local/source.png'] }),
  ]
  const result = arrangeCanvasItems(items)
  assert.equal(result.get('derived-a').x, result.get('source').x + ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP)
  assert.equal(result.get('derived-b').x, result.get('derived-a').x + ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP)
  assert.equal(result.get('derived-a').y, result.get('source').y)
  assert.equal(result.get('derived-b').y, result.get('source').y)
})

test('hidden items are not moved by a canvas reflow', () => {
  const result = arrangeCanvasItems([
    item('visible', '2026-01-01'),
    { ...item('hidden', '2026-01-02'), rect: { ...rect(), hidden: true } },
  ])
  assert.deepEqual([...result.keys()], ['visible'])
})
