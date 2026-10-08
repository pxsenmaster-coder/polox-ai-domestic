<script setup lang="ts">
import type { AssetLibraryAssetSearchItem, AssetLibraryAssetSearchList } from '~~/shared/types/assetLibrary'
import { isMediaAudioUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { useAppLocale } from '~/composables/useAppLocale'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  add: [assets: AssetLibraryAssetPublic[]]
  dragAsset: [asset: AssetLibraryAssetPublic]
}>()
const { t } = useAppLocale()
const query = ref('')
const assets = ref<AssetLibraryAssetSearchItem[]>([])
const selectedIds = ref(new Set<string>())
const loading = ref(false)
const error = ref('')
const panelWidth = ref(352)
let resizeDrag: { pointerId: number, startX: number, startWidth: number } | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestId = 0

async function search() {
  const currentRequest = ++requestId
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<AssetLibraryAssetSearchList>('/api/asset-libraries/assets', {
      query: { q: query.value.trim(), limit: 200 },
    })
    if (currentRequest === requestId) {
      assets.value = result.items
      selectedIds.value = new Set([...selectedIds.value].filter(id => result.items.some(asset => asset.id === id)))
    }
  }
  catch {
    if (currentRequest === requestId)
      error.value = t('Could not load library assets. Check the connection and retry.', '素材库加载失败，请检查连接后重试。')
  }
  finally {
    if (currentRequest === requestId)
      loading.value = false
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void search() }, 220)
}

watch(() => props.open, (open) => {
  if (open)
    void search()
  else
    selectedIds.value = new Set()
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const selectedAssets = computed(() => assets.value.filter(asset => selectedIds.value.has(asset.id)))
function toggle(asset: AssetLibraryAssetSearchItem) {
  const next = new Set(selectedIds.value)
  if (next.has(asset.id))
    next.delete(asset.id)
  else
    next.add(asset.id)
  selectedIds.value = next
}
function startDrag(event: DragEvent, asset: AssetLibraryAssetSearchItem) {
  if (!event.dataTransfer)
    return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-polox-library-asset', JSON.stringify(asset))
  event.dataTransfer.setData('text/plain', asset.name)
  emit('dragAsset', asset)
}
function startResize(event: PointerEvent) {
  if (event.button !== 0)
    return
  resizeDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidth.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (resizeDrag?.pointerId !== event.pointerId)
    return
  panelWidth.value = Math.max(280, Math.min(560, resizeDrag.startWidth + resizeDrag.startX - event.clientX))
}
function endResize(event: PointerEvent) {
  if (resizeDrag?.pointerId === event.pointerId)
    resizeDrag = undefined
}
function addSelected() {
  if (!selectedAssets.value.length)
    return
  emit('add', selectedAssets.value)
  selectedIds.value = new Set()
}
function isVideo(asset: AssetLibraryAssetPublic) {
  return asset.kind === 'video' || isMediaVideoUrl(asset.url)
}
function isAudio(asset: AssetLibraryAssetPublic) {
  return asset.kind === 'audio' || isMediaAudioUrl(asset.url)
}
</script>

<template>
  <aside
    v-if="open"
    class="absolute top-3 right-3 bottom-16 z-40 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur"
    :style="{ width: `min(${panelWidth}px, calc(100% - 1.5rem))` }"
    :aria-label="t('Asset library', '素材库')"
    @pointerdown.stop
  >
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('Resize asset library panel', '调整素材库宽度')"
      :aria-valuemin="280"
      :aria-valuemax="560"
      :aria-valuenow="panelWidth"
      class="absolute top-0 bottom-0 left-0 z-10 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none focus-visible:outline-2 focus-visible:outline-ring"
      @pointerdown.stop.prevent="startResize"
      @pointermove="moveResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      @keydown.left.prevent="panelWidth = Math.min(560, panelWidth + 16)"
      @keydown.right.prevent="panelWidth = Math.max(280, panelWidth - 16)"
    >
      <span class="h-10 w-0.5 rounded-full bg-border group-hover:bg-primary" />
    </button>
    <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          {{ t('Asset library', '素材库') }}
        </h2>
        <p class="text-[11px] text-muted-foreground">
          {{ t('Drag a file onto the canvas, or select a few to add together.', '拖动单个素材到画布，或多选后一起添加。') }}
        </p>
      </div>
      <button class="canvas-action shrink-0" :aria-label="t('Close asset library', '关闭素材库')" @click="emit('close')">
        <Icon name="i-lucide-x" />
      </button>
    </header>
    <div class="border-b border-border p-3">
      <label class="sr-only" for="canvas-library-search">{{ t('Search assets', '搜索素材') }}</label>
      <div class="relative">
        <Icon name="i-lucide-search" class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <input id="canvas-library-search" v-model="query" class="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" :placeholder="t('Search by file name', '按素材名称搜索')" @input="scheduleSearch">
      </div>
    </div>
    <p v-if="error" class="mx-3 mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
      {{ error }}
      <button class="ml-2 underline underline-offset-2" @click="search">
        {{ t('Retry', '重试') }}
      </button>
    </p>
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="loading && !assets.length" class="grid h-28 place-items-center text-xs text-muted-foreground" role="status">
        {{ t('Loading library…', '正在加载素材库…') }}
      </div>
      <div v-else-if="!assets.length && !error" class="grid h-36 content-center justify-items-center gap-2 rounded-lg border border-dashed border-border px-5 text-center">
        <Icon name="i-lucide-library" class="size-5 text-muted-foreground" />
        <p class="text-xs font-medium">
          {{ t('No matching assets', '没有找到素材') }}
        </p>
        <p class="text-[11px] text-muted-foreground">
          {{ t('Save a result to the library first, or try another search.', '请先将结果保存到素材库，或尝试其他关键词。') }}
        </p>
      </div>
      <div v-else class="grid grid-cols-2 gap-2">
        <button
          v-for="asset in assets"
          :key="asset.id"
          type="button"
          draggable="true"
          class="group relative overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring"
          :class="selectedIds.has(asset.id) ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-muted-foreground/50'"
          :aria-pressed="selectedIds.has(asset.id)"
          :title="`${asset.name} · ${asset.libraryName}`"
          @click="toggle(asset)"
          @dragstart="startDrag($event, asset)"
        >
          <div class="relative aspect-[4/3] overflow-hidden bg-muted/40">
            <img v-if="!isVideo(asset) && !isAudio(asset)" :src="asset.url" :alt="asset.name" class="size-full object-cover" loading="lazy">
            <video v-else-if="isVideo(asset)" :src="asset.url" class="size-full object-cover" muted playsinline preload="metadata" />
            <div v-else class="grid size-full place-items-center text-muted-foreground">
              <Icon name="i-lucide-audio-lines" class="size-7" />
            </div>
            <span class="absolute top-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{{ asset.kind }}</span>
            <span v-if="selectedIds.has(asset.id)" class="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
              <Icon name="i-lucide-check" class="size-3" />
            </span>
          </div>
          <span class="block truncate px-2 pt-1.5 text-[11px] font-medium">{{ asset.name }}</span>
          <span class="block truncate px-2 pb-2 text-[10px] text-muted-foreground">{{ asset.libraryName }}</span>
        </button>
      </div>
    </div>
    <footer class="flex items-center justify-between border-t border-border px-3 py-2.5">
      <span class="text-[11px] text-muted-foreground">{{ t(`${selectedIds.size} selected`, `已选择 ${selectedIds.size} 项`) }}</span>
      <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50" :disabled="!selectedIds.size" @click="addSelected">
        <Icon name="i-lucide-plus" class="size-3.5" />
        {{ t('Add to canvas', '添加到画布') }}
      </button>
    </footer>
  </aside>
</template>
