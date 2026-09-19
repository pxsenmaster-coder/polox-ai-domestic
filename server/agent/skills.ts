import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function normalizeModuleUrl(value: string) {
  if (value.startsWith('file:'))
    return value
  if (/^[a-z]:[\\/]/i.test(value))
    return `file:///${value.replace(/\\/g, '/')}`
  if (value.startsWith('/'))
    return `file://${value}`
  return value
}

function moduleDirectory(value: string) {
  try {
    return dirname(fileURLToPath(normalizeModuleUrl(value)))
  }
  catch {
    // Nitro's Windows prerenderer can expose import.meta.url as `/D:/...`.
    // Keep the local source-tree fallback available for dev and test runs.
    return resolve(process.cwd(), 'server/agent')
  }
}

const skillsDir = resolve(moduleDirectory(import.meta.url), 'skills')

const FIRST_SKILLS = ['reference-analysis', 'prompt-rewrite', 'result-evaluation', 'long-form-video']

export function loadAgentSkills() {
  const blocks: string[] = []
  for (const name of FIRST_SKILLS) {
    try {
      const text = readFileSync(resolve(skillsDir, `${name}.md`), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
    catch {
      // Skill files are optional at runtime.
    }
  }
  try {
    const extra = readdirSync(skillsDir).filter(file => file.endsWith('.md') && !FIRST_SKILLS.includes(file.replace(/\.md$/, '')))
    for (const file of extra.sort()) {
      const text = readFileSync(resolve(skillsDir, file), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
  }
  catch {
    // No skills directory.
  }
  return blocks
}

export function skillsPromptBlock() {
  const skills = loadAgentSkills()
  if (!skills.length)
    return ''
  return `\n\n## Skills\nThese operating notes shape how you think. They do not spend money. Only tools spend money.\n\n${skills.join('\n\n')}`
}
