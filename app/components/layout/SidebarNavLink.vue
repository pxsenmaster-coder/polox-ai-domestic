<script setup lang="ts">
import type { SidebarMenuButtonVariants } from '~/components/ui/sidebar'
import type { NavLink } from '~/types/nav'
import { useSidebar } from '~/components/ui/sidebar'
import { useAppLocale } from '~/composables/useAppLocale'

const props = withDefaults(defineProps<{
  item: NavLink
  size?: SidebarMenuButtonVariants['size']
}>(), {
  size: 'default',
})

const { setOpenMobile } = useSidebar()
const { t } = useAppLocale()
const route = useRoute()

function title(value: string) {
  const labels: Record<string, [string, string]> = {
    'Home': ['Home', '首页'],
    'Skills': ['Skills', '技能'],
    'Projects': ['Projects', '项目'],
    'Asset Libraries': ['Asset Libraries', '素材库'],
  }
  const [english, chinese] = labels[value] || [value, value]
  return t(english, chinese)
}

const isActive = computed(() => {
  if (props.item.link === '/')
    return route.path === '/'
  return route.path === props.item.link || route.path.startsWith(`${props.item.link}/`)
})
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton as-child :tooltip="title(item.title)" :size="size" :data-active="isActive">
        <NuxtLink :to="item.link" @click="setOpenMobile(false)">
          <Icon :name="item.icon || ''" />
          <span>{{ title(item.title) }}</span>
          <span v-if="item.new" class="rounded-md bg-[#adfa1d] px-1.5 py-0.5 text-xs text-black leading-none no-underline group-hover:no-underline">
            New
          </span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<style scoped>

</style>
