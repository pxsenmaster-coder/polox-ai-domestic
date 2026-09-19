<script setup lang="ts">
import type { CanvasLayerState } from '~~/shared/types/canvas'
import type { GenerationJobPublic, ImageLayerPublic } from '~~/shared/types/generation'
import { layerRectFromBoundingBox, orderedImageLayers } from '~~/shared/utils/imageLayerComposition'

type LayerCorner = 'nw' | 'ne' | 'sw' | 'se'

const props = withDefaults(defineProps<{
  job: GenerationJobPublic
  compact?: boolean
  layerState?: CanvasLayerState
  selectedLayerId?: string
  interactive?: boolean
}>(), {
  compact: false,
  selectedLayerId: '',
  interactive: false,
})
const emit = defineEmits<{
  dimensions: [{ width: number, height: number }]
  layerPointerdown: [{ event: PointerEvent, layer: ImageLayerPublic }]
  layerResizeStart: [{ event: PointerEvent, layer: ImageLayerPublic, corner: LayerCorner }]
}>()
const layerCorners: LayerCorner[] = ['nw', 'ne', 'sw', 'se']

const layers = computed(() => orderedImageLayers(props.job.layers || []))
function editFor(layer: ImageLayerPublic) {
  return props.layerState?.layers.find(edit => edit.id === layer.id)
}
function isHidden(layer: ImageLayerPublic) {
  return editFor(layer)?.hidden === true
}
function isLocked(layer: ImageLayerPublic) {
  return editFor(layer)?.locked === true
}
function effectiveLayer(layer: ImageLayerPublic): ImageLayerPublic {
  const edit = editFor(layer)
  if (!edit)
    return layer
  return {
    ...layer,
    zIndex: edit.zIndex ?? layer.zIndex,
  }
}
const visibleLayers = computed(() => layers.value.filter(layer => !isHidden(layer)).map(effectiveLayer))
const placedLayers = computed(() => visibleLayers.value.filter(layer => layer.renderMode !== 'unplaced'))
const unplacedLayers = computed(() => visibleLayers.value.filter(layer => layer.renderMode === 'unplaced'))
const canvas = computed(() => {
  const value = props.job.layerCanvas
  if (value && value.width > 0 && value.height > 0)
    return value
  const base = layers.value.find(layer => layer.role === 'base')
  if (base?.imageWidth && base.imageHeight)
    return { width: base.imageWidth, height: base.imageHeight }
  return { width: 1, height: 1 }
})

onMounted(() => {
  if (canvas.value.width > 1 && canvas.value.height > 1)
    emit('dimensions', canvas.value)
})

function layerStyle(layer: ImageLayerPublic) {
  const edit = editFor(layer)
  const dx = edit?.dx || 0
  const dy = edit?.dy || 0
  const scaleX = edit?.scaleX || 1
  const scaleY = edit?.scaleY || 1
  const selected = props.selectedLayerId === layer.id
  if (layer.renderMode !== 'cropped' || !layer.boundingBox)
    return { left: `${dx / 10}%`, top: `${dy / 10}%`, width: `${scaleX * 100}%`, height: `${scaleY * 100}%`, zIndex: layer.zIndex, outline: selected ? '2px solid var(--ring)' : undefined }
  const rect = layerRectFromBoundingBox(layer.boundingBox, { width: 100, height: 100 })
  return {
    left: `${rect.left + dx / 10}%`,
    top: `${rect.top + dy / 10}%`,
    width: `${rect.width * scaleX}%`,
    height: `${rect.height * scaleY}%`,
    zIndex: layer.zIndex,
    outline: selected ? '2px solid var(--ring)' : undefined,
  }
}

function onBaseLoad(event: Event) {
  const target = event.target as HTMLImageElement
  if (!props.job.layerCanvas && target.naturalWidth > 0 && target.naturalHeight > 0)
    emit('dimensions', { width: target.naturalWidth, height: target.naturalHeight })
}
function onLayerPointerdown(event: PointerEvent, layer: ImageLayerPublic) {
  if (!props.interactive)
    return
  emit('layerPointerdown', { event, layer })
}
function onLayerResizeStart(event: PointerEvent, layer: ImageLayerPublic, corner: LayerCorner) {
  if (!props.interactive || props.selectedLayerId !== layer.id)
    return
  emit('layerResizeStart', { event, layer, corner })
}
function resizeClass(corner: LayerCorner) {
  return {
    'layer-resize-nw': corner === 'nw',
    'layer-resize-ne': corner === 'ne',
    'layer-resize-sw': corner === 'sw',
    'layer-resize-se': corner === 'se',
  }
}
function resizeLabel(layer: ImageLayerPublic, corner: LayerCorner) {
  return ['Resize ', layer.name, ' ', corner].join('')
}
</script>

<template>
  <div
    class="layer-stack-preview relative h-full w-full overflow-hidden"
    :class="compact ? 'rounded-lg' : 'rounded-xl border border-border'"
    :style="{ aspectRatio: `${canvas.width} / ${canvas.height}` }"
    role="img"
    :aria-label="`Layer stack with ${layers.length} layers`"
  >
    <div
      v-for="layer in placedLayers"
      :key="layer.id"
      class="absolute block select-none"
      :class="[
        props.interactive ? 'pointer-events-auto' : 'pointer-events-none',
        props.interactive ? (isLocked(layer) ? 'cursor-not-allowed opacity-80' : 'cursor-move') : '',
      ]"
      :style="layerStyle(layer)"
      :data-layer-id="layer.id"
      :aria-label="`${layer.name}${isLocked(layer) ? ' (locked)' : ''}`"
      @pointerdown.stop="onLayerPointerdown($event, layer)"
      @dblclick.stop
    >
      <img
        :src="layer.url"
        :alt="layer.name"
        class="pointer-events-none block size-full select-none"
        :loading="compact ? 'lazy' : 'eager'"
        draggable="false"
        @load="layer.role === 'base' && onBaseLoad($event)"
      >
      <template v-if="props.interactive && props.selectedLayerId === layer.id && !isLocked(layer)">
        <button
          v-for="corner in layerCorners" :key="corner"
          type="button"
          class="layer-resize-handle absolute size-2 rounded-full border border-ring bg-background"
          :class="resizeClass(corner)"
          :aria-label="resizeLabel(layer, corner)"
          @pointerdown.stop.prevent="onLayerResizeStart($event, layer, corner)"
        />
      </template>
    </div>
    <div v-if="!placedLayers.length" class="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
      No positioned layers available.
    </div>
    <div v-if="unplacedLayers.length" class="pointer-events-none absolute right-2 bottom-2 left-2 rounded-md border border-amber-400/40 bg-background/90 px-2 py-1 text-[11px] text-amber-700 shadow-sm dark:text-amber-300">
      {{ unplacedLayers.length }} layer{{ unplacedLayers.length === 1 ? '' : 's' }} need manual placement.
    </div>
  </div>
</template>

<style scoped>
.layer-stack-preview {
  background-color: color-mix(in srgb, var(--muted) 45%, transparent);
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--foreground) 8%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--foreground) 8%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--foreground) 8%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--foreground) 8%, transparent) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}
.layer-resize-handle { z-index: 20; transform: translate(-50%, -50%); touch-action: none; }
.layer-resize-nw { left: 0; top: 0; cursor: nwse-resize; }
.layer-resize-ne { right: 0; top: 0; transform: translate(50%, -50%); cursor: nesw-resize; }
.layer-resize-sw { left: 0; bottom: 0; transform: translate(-50%, 50%); cursor: nesw-resize; }
.layer-resize-se { right: 0; bottom: 0; transform: translate(50%, 50%); cursor: nwse-resize; }
</style>
