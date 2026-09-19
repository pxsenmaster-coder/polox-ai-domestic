export type GenerationProviderQueue = 'ark' | 'fal' | 'unassigned'

/**
 * Keep Ark requests below the provider's burst limit while preserving the
 * existing global/Fal capacity for other providers.
 */
export async function generationConcurrency(provider?: GenerationProviderQueue) {
  if (provider === 'ark')
    return 3
  return 10
}
