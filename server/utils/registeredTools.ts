/** Names a user-authored L1 skill is allowed to reference. */
const CORE_TOOL_NAMES = [
  'generate_image',
  'remove_background',
  'generate_video',
  'concat_videos',
  'ask_user',
  'export_zip',
  'load_skill',
  'save_user_skill',
]
const KNOWN_MODEL_IDS = [
  'seedream/5-pro-text-to-image',
  'seedream/5-pro-image-to-image',
  'gpt-image-2-text-to-image',
  'gpt-image-2-image-to-image',
  'nano-banana-2-text-to-image',
  'nano-banana-2-image-to-image',
  'nano-banana-2-lite-text-to-image',
  'nano-banana-2-lite-image-to-image',
  'nano-banana-pro-text-to-image',
  'nano-banana-pro-image-to-image',
  'bytedance/seedance-2-5-text-to-video',
  'bytedance/seedance-2-5-image-to-video',
  'bytedance/seedance-2-5-reference-to-video',
  'bytedance/seedance-2-text-to-video',
  'bytedance/seedance-2-image-to-video',
  'bytedance/seedance-2-reference-to-video',
  'minimax-h3/text-to-video',
  'minimax-h3/image-to-video',
  'minimax-h3/reference-to-video',
  'wan/3-0-video-text-to-video',
  'wan/3-0-video-image-to-video',
  'wan/3-0-video-reference-to-video',
  'image-text-editor',
  'image-layer-splitter',
]

export function registeredToolNames() {
  const names = new Set<string>(CORE_TOOL_NAMES)
  for (const id of KNOWN_MODEL_IDS)
    names.add(`model_${id.replace(/[^a-z0-9]/gi, '_')}`)
  return names
}

export function isRegisteredToolName(name: string) {
  const normalized = String(name || '').trim()
  return registeredToolNames().has(normalized)
}
