<script setup lang="ts">
import { useAppLocale } from '~/composables/useAppLocale'

const { isChinese, toggleLocale, t } = useAppLocale()
</script>

<template>
  <button
    type="button"
    class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    :aria-label="t('Switch to Chinese', '切换为英文')"
    :title="t('Switch to Chinese', '切换为英文')"
    @click="toggleLocale"
  >
    <Icon name="i-lucide-languages" class="size-4" />
    <span>{{ isChinese ? 'EN' : '中文' }}</span>
  </button>
</template>
