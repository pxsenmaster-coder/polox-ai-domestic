<script setup lang="ts">
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Download,
  FilePlus2,
  KeyRound,
  LockKeyhole,
  Power,
  RefreshCcw,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'

interface BuiltinSkill {
  id: string
  name: string
  description: string
  keywords?: string
  icon?: string
  source?: 'builtin'
  enabled?: boolean
}

interface UserSkill {
  id: string
  name: string
  description: string
  keywords?: string
  cover?: string
  enabled: boolean
  status: 'draft' | 'published'
  visibility: 'private' | 'public'
  version: string
  source: 'user' | 'imported'
  triggers: string[]
  requires: string[]
  maxGenerationsPerRun?: number
  allowSpend?: boolean
  updatedAt?: string
}

interface SkillsResponse {
  builtinCatalog: BuiltinSkill[]
  userSkills: UserSkill[]
  registeredAt: string
}

interface SkillCard {
  id: string
  name: string
  description: string
  keywords?: string
  icon?: string
  source: 'builtin' | 'user' | 'imported'
  enabled: boolean
  status?: 'draft' | 'published'
  version?: string
  triggers: string[]
  requires: string[]
  allowSpend?: boolean
  updatedAt?: string
}

interface ValidationIssue {
  path: string
  message: string
}

interface SkillDetail {
  source: 'builtin' | 'user'
  markdown?: string | null
  keywords?: string
  enabled?: boolean
  status?: 'draft' | 'published'
}

const { public: publicConfig } = useRuntimeConfig()

useSeoMeta({
  title: `Skills · ${publicConfig.brandName}`,
  description: 'Create and manage editable AI workflows in your local workspace.',
})

const importInput = ref<HTMLInputElement | null>(null)
const data = ref<SkillsResponse | null>(null)
const loading = ref(true)
const loadError = ref('')
const busySkillId = ref('')

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit' | 'view'>('create')
const editorSkillId = ref('')
const editorMarkdown = ref('')
const editorKeywords = ref('')
const editorEnabled = ref(true)
const editorLoading = ref(false)
const editorSaving = ref(false)
const validationRunning = ref(false)
const validationOk = ref<boolean | null>(null)
const validationIssues = ref<ValidationIssue[]>([])
const deleteConfirmOpen = ref(false)
const pendingDeleteSkill = ref<SkillCard | null>(null)
const deletePending = ref(false)

const starterMarkdown = `---
id: album-layout
name: Album layout
description: Turn a set of photos into an editable album page.
version: 1.0.0
triggers:
  - /album-layout
requires:
  - ask_user
  - generate_image
safety:
  maxGenerationsPerRun: 4
  allowSpend: false
---

# Album layout

Use the user's photos as editable slots. Ask for the page mood, preserve the subject, and return a structured layout before generating any final image.
`

const isReadonlyEditor = computed(() => editorMode.value === 'view')
const editorTitle = computed(() => {
  if (editorMode.value === 'create')
    return 'Create a skill'
  if (editorMode.value === 'view')
    return 'Built-in skill'
  return 'Edit skill'
})
const editorDescription = computed(() => {
  if (editorMode.value === 'view')
    return 'Built-in skills are part of the product runtime and cannot be overwritten here.'
  return 'SKILL.md is the portable source of truth. Validate it before saving changes.'
})

const skills = computed<SkillCard[]>(() => {
  const builtins = (data.value?.builtinCatalog || []).map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    keywords: skill.keywords,
    icon: skill.icon,
    source: 'builtin' as const,
    enabled: true,
    triggers: [`/${skill.id}`],
    requires: [],
  }))
  const userSkills = (data.value?.userSkills || []).map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    keywords: skill.keywords,
    source: skill.source,
    enabled: skill.enabled,
    status: skill.status,
    version: skill.version,
    triggers: skill.triggers || [],
    requires: skill.requires || [],
    allowSpend: skill.allowSpend,
    updatedAt: skill.updatedAt,
  }))
  return [...builtins, ...userSkills]
})

const userSkillCount = computed(() => data.value?.userSkills.length || 0)
const enabledCount = computed(() => skills.value.filter(skill => skill.enabled).length)
const draftCount = computed(() => skills.value.filter(skill => skill.status === 'draft').length)

async function loadSkills() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await $fetch<SkillsResponse>('/api/skills')
  }
  catch (error) {
    loadError.value = readErrorMessage(error, 'Could not load skills')
  }
  finally {
    loading.value = false
  }
}

function resetValidation() {
  validationOk.value = null
  validationIssues.value = []
}

function openCreate() {
  editorMode.value = 'create'
  editorSkillId.value = ''
  editorMarkdown.value = starterMarkdown
  editorKeywords.value = 'album layout editable template photo book'
  editorEnabled.value = true
  resetValidation()
  editorOpen.value = true
}

async function openSkill(skill: SkillCard) {
  editorMode.value = skill.source === 'builtin' ? 'view' : 'edit'
  editorSkillId.value = skill.id
  editorMarkdown.value = ''
  editorKeywords.value = skill.keywords || ''
  editorEnabled.value = skill.enabled
  resetValidation()
  editorOpen.value = true
  editorLoading.value = true
  try {
    const detail = await $fetch<SkillDetail>(`/api/skills/${encodeURIComponent(skill.id)}`)
    editorMarkdown.value = detail.markdown || ''
    editorKeywords.value = detail.keywords || editorKeywords.value
    editorEnabled.value = detail.enabled ?? editorEnabled.value
  }
  catch (error) {
    editorOpen.value = false
    toast.error(readErrorMessage(error, 'Could not open this skill'))
  }
  finally {
    editorLoading.value = false
  }
}

async function validateDraft() {
  if (!editorMarkdown.value.trim() || validationRunning.value || isReadonlyEditor.value)
    return
  validationRunning.value = true
  resetValidation()
  try {
    const result = await $fetch<{ ok: boolean, issues: ValidationIssue[] }>('/api/skills', {
      method: 'POST',
      body: { markdown: editorMarkdown.value, validateOnly: true },
    })
    validationOk.value = result.ok
    validationIssues.value = result.issues || []
    if (result.ok)
      toast.success('Skill validated')
  }
  catch (error) {
    validationOk.value = false
    toast.error(readErrorMessage(error, 'Could not validate this skill'))
  }
  finally {
    validationRunning.value = false
  }
}

async function saveSkill() {
  if (editorSaving.value || isReadonlyEditor.value || !editorMarkdown.value.trim())
    return
  editorSaving.value = true
  try {
    if (editorMode.value === 'create') {
      await $fetch('/api/skills', {
        method: 'POST',
        body: {
          markdown: editorMarkdown.value,
          keywords: editorKeywords.value,
          enabled: editorEnabled.value,
          status: editorEnabled.value ? 'published' : 'draft',
        },
      })
      toast.success('Skill created')
    }
    else {
      await $fetch(`/api/skills/${encodeURIComponent(editorSkillId.value)}`, {
        method: 'PATCH',
        body: {
          markdown: editorMarkdown.value,
          keywords: editorKeywords.value,
          enabled: editorEnabled.value,
        },
      })
      toast.success('Skill saved')
    }
    editorOpen.value = false
    await loadSkills()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not save this skill'))
  }
  finally {
    editorSaving.value = false
  }
}

async function toggleSkill(skill: SkillCard) {
  if (skill.source === 'builtin' || busySkillId.value)
    return
  busySkillId.value = skill.id
  try {
    await $fetch(`/api/skills/${encodeURIComponent(skill.id)}`, {
      method: 'PATCH',
      body: { enabled: !skill.enabled },
    })
    if (data.value) {
      data.value.userSkills = data.value.userSkills.map(item => item.id === skill.id ? { ...item, enabled: !skill.enabled } : item)
    }
    toast.success(skill.enabled ? 'Skill disabled' : 'Skill enabled')
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not update this skill'))
  }
  finally {
    busySkillId.value = ''
  }
}

async function deleteSkill(skill: SkillCard) {
  if (skill.source === 'builtin' || busySkillId.value)
    return
  pendingDeleteSkill.value = skill
  deleteConfirmOpen.value = true
}

async function confirmDeleteSkill() {
  const skill = pendingDeleteSkill.value
  if (!skill || skill.source === 'builtin' || deletePending.value)
    return
  deletePending.value = true
  busySkillId.value = skill.id
  try {
    await $fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' })
    if (data.value)
      data.value.userSkills = data.value.userSkills.filter(item => item.id !== skill.id)
    toast.success('Skill deleted')
    deleteConfirmOpen.value = false
    pendingDeleteSkill.value = null
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not delete this skill'))
  }
  finally {
    busySkillId.value = ''
    deletePending.value = false
  }
}

async function exportSkill(skill: SkillCard) {
  try {
    const payload = await $fetch<Record<string, unknown>>(`/api/skills/${encodeURIComponent(skill.id)}/export`)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${skill.id}.polox-skill.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('Skill exported')
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not export this skill'))
  }
}

function openImport() {
  importInput.value?.click()
}

async function importSkill(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  try {
    const raw = await file.text()
    let body: { markdown?: string, skill?: { markdown?: string } }
    if (file.name.toLowerCase().endsWith('.json') || raw.trimStart().startsWith('{'))
      body = JSON.parse(raw) as { markdown?: string, skill?: { markdown?: string } }
    else
      body = { markdown: raw }
    await $fetch('/api/skills/import', { method: 'POST', body })
    toast.success('Skill imported and kept disabled for review')
    await loadSkills()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not import this skill'))
  }
}

onMounted(() => {
  void loadSkills()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1128px] flex-col gap-7 pb-8">
    <header class="relative overflow-hidden rounded-2xl border border-border/80 bg-card/65 p-5 shadow-none sm:p-7">
      <div class="pointer-events-none absolute inset-y-0 left-0 w-1 bg-lime-400/85" aria-hidden="true" />
      <div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div class="max-w-2xl space-y-3">
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-lime-300/90">
            <WandSparkles class="size-4" aria-hidden="true" />
            <span>Skill workshop</span>
          </div>
          <div class="space-y-2">
            <h1 class="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              Build workflows that stay editable.
            </h1>
            <p class="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Skills are portable <code class="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">SKILL.md</code> workflows. Keep them private, review their permissions, and decide which ones can run in your projects.
            </p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <input ref="importInput" type="file" accept=".md,.markdown,.json,text/markdown,application/json" class="hidden" @change="importSkill">
          <Button type="button" variant="outline" class="h-9 rounded-lg px-3 text-xs shadow-none" @click="openImport">
            <Upload class="mr-1.5 size-3.5" aria-hidden="true" />
            Import
          </Button>
          <Button type="button" class="h-9 rounded-lg bg-lime-400 px-3 text-xs text-black shadow-none hover:bg-lime-300" @click="openCreate">
            <FilePlus2 class="mr-1.5 size-3.5" aria-hidden="true" />
            New skill
          </Button>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/60">
        <div class="bg-background/75 px-3 py-3 sm:px-4">
          <p class="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Installed
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums">
            {{ skills.length }}
          </p>
        </div>
        <div class="bg-background/75 px-3 py-3 sm:px-4">
          <p class="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Enabled
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-lime-300">
            {{ enabledCount }}
          </p>
        </div>
        <div class="bg-background/75 px-3 py-3 sm:px-4">
          <p class="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Your drafts
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums">
            {{ draftCount }}
          </p>
        </div>
      </div>
    </header>

    <section aria-labelledby="skills-heading" class="space-y-4">
      <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Catalog
          </p>
          <h2 id="skills-heading" class="mt-1 text-xl font-semibold tracking-tight">
            Installed skills
          </h2>
        </div>
        <p class="text-xs text-muted-foreground">
          {{ userSkillCount }} user {{ userSkillCount === 1 ? 'skill' : 'skills' }} · built-ins stay read-only
        </p>
      </div>

      <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="index in 6" :key="index" class="h-56 animate-pulse rounded-2xl border border-border bg-card/60" />
      </div>

      <div v-else-if="loadError" class="rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
        <div class="flex items-start gap-3">
          <AlertTriangle class="mt-0.5 size-5 text-red-300" aria-hidden="true" />
          <div class="flex-1 space-y-2">
            <p class="font-medium">
              Skills could not be loaded.
            </p>
            <p class="text-sm text-muted-foreground">
              {{ loadError }}
            </p>
            <Button type="button" variant="outline" class="h-8 rounded-lg px-3 text-xs shadow-none" @click="loadSkills">
              <RefreshCcw class="mr-1.5 size-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      </div>

      <div v-else-if="skills.length === 0" class="rounded-2xl border border-dashed border-border bg-card/45 p-10 text-center">
        <Sparkles class="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
        <p class="mt-3 font-medium">
          No skills registered yet.
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          Create or import a SKILL.md to add your first workflow.
        </p>
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="skill in skills"
          :key="skill.id"
          class="group flex min-h-56 flex-col rounded-2xl border border-border/80 bg-card/70 p-4 shadow-none transition-colors duration-150 hover:border-lime-300/45 hover:bg-card"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/45">
              <Icon :name="skill.icon || 'lucide:sparkles'" class="size-5 text-foreground" aria-hidden="true" />
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="skill.source === 'builtin'" class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
                <LockKeyhole class="size-3" aria-hidden="true" />
                Built-in
              </span>
              <span v-else class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]" :class="skill.enabled ? 'border-lime-300/35 text-lime-300' : 'border-border text-muted-foreground'">
                <span class="size-1.5 rounded-full" :class="skill.enabled ? 'bg-lime-300' : 'bg-muted-foreground'" aria-hidden="true" />
                {{ skill.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
          </div>

          <div class="mt-4 flex-1">
            <div class="flex items-start justify-between gap-2">
              <h3 class="font-medium leading-snug">
                {{ skill.name }}
              </h3>
              <span v-if="skill.status === 'draft'" class="rounded bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-200">Draft</span>
            </div>
            <p class="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {{ skill.description }}
            </p>
          </div>

          <div class="mt-4 flex min-h-5 flex-wrap gap-1.5">
            <span v-for="trigger in skill.triggers.slice(0, 2)" :key="trigger" class="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {{ trigger }}
            </span>
            <span v-if="skill.allowSpend" class="rounded bg-amber-300/10 px-1.5 py-0.5 text-[10px] text-amber-200">spend enabled</span>
          </div>

          <div class="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
            <button type="button" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="openSkill(skill)">
              <Code2 class="size-3.5" aria-hidden="true" />
              {{ skill.source === 'builtin' ? 'View source' : 'Edit source' }}
            </button>
            <div class="flex items-center gap-1">
              <button v-if="skill.source !== 'builtin'" type="button" class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" :aria-label="`Toggle ${skill.name}`" :disabled="busySkillId === skill.id" @click="toggleSkill(skill)">
                <Power class="size-3.5" aria-hidden="true" />
              </button>
              <button type="button" class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-label="`Export ${skill.name}`" @click="exportSkill(skill)">
                <Download class="size-3.5" aria-hidden="true" />
              </button>
              <button v-if="skill.source !== 'builtin'" type="button" class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" :aria-label="`Delete ${skill.name}`" :disabled="busySkillId === skill.id" @click="deleteSkill(skill)">
                <Trash2 class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <Dialog v-model:open="deleteConfirmOpen">
      <DialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
        <DialogHeader class="gap-1">
          <DialogTitle>Delete this skill?</DialogTitle>
          <DialogDescription>
            “{{ pendingDeleteSkill?.name }}” will be removed from your local skill library. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" class="h-8 rounded-lg px-3 text-xs shadow-none" :disabled="deletePending" @click="deleteConfirmOpen = false">
            Cancel
          </Button>
          <Button type="button" variant="destructive" class="h-8 rounded-lg px-3 text-xs shadow-none" :disabled="deletePending" @click="confirmDeleteSkill">
            <Trash2 class="mr-1.5 size-3.5" aria-hidden="true" />
            {{ deletePending ? 'Deleting…' : 'Delete skill' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="editorOpen">
      <DialogContent class="max-h-[92vh] overflow-y-auto rounded-2xl border-border bg-card shadow-none sm:max-w-4xl">
        <DialogHeader class="gap-1 pr-7">
          <div class="flex items-center gap-2">
            <DialogTitle>{{ editorTitle }}</DialogTitle>
            <span v-if="isReadonlyEditor" class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
              <LockKeyhole class="size-3" aria-hidden="true" /> Read-only
            </span>
          </div>
          <DialogDescription>{{ editorDescription }}</DialogDescription>
        </DialogHeader>

        <div v-if="editorLoading" class="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <RefreshCcw class="mr-2 size-4 animate-spin" aria-hidden="true" />
          Loading source…
        </div>
        <div v-else class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div class="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel html-for="skill-keywords">
                  Keywords
                </FieldLabel>
                <Input id="skill-keywords" v-model="editorKeywords" :disabled="isReadonlyEditor" placeholder="album, photo book, editable layout" class="h-9 rounded-xl bg-input/30 shadow-none" />
              </Field>
              <Field>
                <div class="flex items-center justify-between gap-3">
                  <FieldLabel html-for="skill-markdown">
                    SKILL.md
                  </FieldLabel>
                  <span class="font-mono text-[10px] text-muted-foreground">{{ editorMarkdown.length }} chars</span>
                </div>
                <Textarea id="skill-markdown" v-model="editorMarkdown" :readonly="isReadonlyEditor" rows="18" spellcheck="false" class="min-h-[360px] rounded-xl bg-[#0a0a0a] font-mono text-xs leading-relaxed shadow-none" />
              </Field>
            </FieldGroup>
          </div>

          <aside class="space-y-4 rounded-xl border border-border/70 bg-background/45 p-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Runtime gate
              </p>
              <label class="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring" :class="isReadonlyEditor ? 'cursor-not-allowed opacity-60' : ''">
                <input v-model="editorEnabled" type="checkbox" :disabled="isReadonlyEditor" class="mt-0.5 size-4 accent-lime-400">
                <span>
                  <span class="block text-sm font-medium">Allow this skill to run</span>
                  <span class="mt-1 block text-xs leading-relaxed text-muted-foreground">Disabled skills remain available for editing and review but stay out of the agent catalog.</span>
                </span>
              </label>
            </div>

            <div class="border-t border-border/70 pt-4">
              <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Validation
              </p>
              <div v-if="validationOk === true" class="mt-3 flex items-start gap-2 rounded-lg border border-lime-300/25 bg-lime-300/5 p-3 text-xs text-lime-200">
                <CheckCircle2 class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Frontmatter and required workflow fields look good.</span>
              </div>
              <div v-else-if="validationOk === false" class="mt-3 space-y-2 rounded-lg border border-red-400/25 bg-red-400/5 p-3 text-xs text-red-200">
                <div class="flex items-start gap-2">
                  <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>Fix the following before saving.</span>
                </div>
                <ul class="list-disc space-y-1 pl-5 text-red-200/85">
                  <li v-for="issue in validationIssues" :key="`${issue.path}-${issue.message}`">
                    {{ issue.path }}: {{ issue.message }}
                  </li>
                </ul>
              </div>
              <p v-else class="mt-3 text-xs leading-relaxed text-muted-foreground">
                Validation checks the id, description, triggers, permissions, and safety limits.
              </p>
              <Button v-if="!isReadonlyEditor" type="button" variant="outline" class="mt-3 h-8 w-full rounded-lg px-3 text-xs shadow-none" :disabled="validationRunning || !editorMarkdown.trim()" @click="validateDraft">
                <RefreshCcw class="mr-1.5 size-3.5" :class="validationRunning ? 'animate-spin' : ''" aria-hidden="true" />
                {{ validationRunning ? 'Checking…' : 'Validate source' }}
              </Button>
            </div>

            <div class="border-t border-border/70 pt-4 text-xs leading-relaxed text-muted-foreground">
              <div class="flex items-start gap-2">
                <KeyRound class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Keep spend permissions explicit. A skill can request generation tools, but it never bypasses provider routing or project review.</span>
              </div>
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" class="h-8 rounded-lg px-3 text-xs shadow-none" :disabled="editorSaving" @click="editorOpen = false">
            {{ isReadonlyEditor ? 'Close' : 'Cancel' }}
          </Button>
          <Button v-if="!isReadonlyEditor" type="button" class="h-8 rounded-lg bg-lime-400 px-3 text-xs text-black shadow-none hover:bg-lime-300" :disabled="editorSaving || editorLoading || !editorMarkdown.trim()" @click="saveSkill">
            <Check class="mr-1.5 size-3.5" aria-hidden="true" />
            {{ editorSaving ? 'Saving…' : 'Save skill' }}
          </Button>
          <Button v-else type="button" class="h-8 rounded-lg px-3 text-xs shadow-none" @click="editorOpen = false">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
