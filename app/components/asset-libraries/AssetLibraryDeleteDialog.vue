<script setup lang="ts">
import { ASSET_LIBRARY_DELETE_CONFIRMATION } from '~~/shared/types/assetLibrary'
import { useAppLocale } from '~/composables/useAppLocale'

const props = defineProps<{
  open: boolean
  pending?: boolean
  libraryName?: string
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': []
}>()

const { t } = useAppLocale()

const confirmation = ref('')
const canDelete = computed(() => confirmation.value.trim() === ASSET_LIBRARY_DELETE_CONFIRMATION)

watch(() => props.open, (open) => {
  if (open)
    confirmation.value = ''
})

function onOpenChange(open: boolean) {
  if (props.pending && !open)
    return
  emit('update:open', open)
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
      <AlertDialogHeader class="gap-2">
        <AlertDialogTitle>
          {{ t('Delete this asset library?', '删除此素材库？') }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t(`This cannot be undone. ${libraryName || 'This library'} and its assets will be removed.`, `此操作无法撤销。素材库“${libraryName || '素材库'}”及其中素材将被删除。`) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="grid gap-2">
        <Label for="delete-asset-library-confirmation">
          {{ t(`Type ${ASSET_LIBRARY_DELETE_CONFIRMATION} to confirm`, `输入 ${ASSET_LIBRARY_DELETE_CONFIRMATION} 以确认`) }}
        </Label>
        <Input
          id="delete-asset-library-confirmation"
          v-model="confirmation"
          :disabled="pending"
          autocomplete="off"
          autofocus
          class="h-9 rounded-xl bg-input/30 shadow-none"
          :placeholder="ASSET_LIBRARY_DELETE_CONFIRMATION"
        />
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel class="rounded-lg shadow-none" :disabled="pending">
          {{ t('Cancel', '取消') }}
        </AlertDialogCancel>
        <Button
          class="rounded-lg bg-destructive text-white shadow-none hover:bg-destructive/90 disabled:opacity-40"
          :disabled="pending || !canDelete"
          @click="emit('confirm')"
        >
          <Spinner v-if="pending" class="size-4" />
          {{ t('Delete library', '删除素材库') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
