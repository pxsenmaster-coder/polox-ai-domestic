<script setup lang="ts">
import { PROJECT_DELETE_CONFIRMATION } from '~~/shared/types/project'
import { useAppLocale } from '~/composables/useAppLocale'

const props = defineProps<{
  open: boolean
  pending?: boolean
  projectName?: string
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': []
}>()

const { t } = useAppLocale()

const confirmation = ref('')
const canDelete = computed(() => confirmation.value.trim() === PROJECT_DELETE_CONFIRMATION)

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
          {{ t('Delete this project?', '删除此项目？') }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t(`This cannot be undone. All generations in ${projectName || 'this project'} will be moved to Default.`, `此操作无法撤销。项目“${projectName || '此项目'}”中的所有生成结果将移至默认项目。`) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="grid gap-2">
        <Label for="delete-project-confirmation">
          {{ t(`Type ${PROJECT_DELETE_CONFIRMATION} to confirm`, `输入 ${PROJECT_DELETE_CONFIRMATION} 以确认`) }}
        </Label>
        <Input
          id="delete-project-confirmation"
          v-model="confirmation"
          :disabled="pending"
          autocomplete="off"
          autofocus
          class="h-9 rounded-xl bg-input/30 shadow-none"
          :placeholder="PROJECT_DELETE_CONFIRMATION"
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
          {{ t('Delete project', '删除项目') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
