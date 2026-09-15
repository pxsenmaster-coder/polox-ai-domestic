import type { ModelOpenAPISchema } from '../types/aiModel'

// Application IDs are stable and provider-specific request model IDs remain configurable
// in local service settings so a model revision can be changed without touching projects.
export const ARK_SEEDREAM_T2I_MODEL = 'ark/seedream/5-pro-text-to-image'
export const ARK_SEEDREAM_I2I_MODEL = 'ark/seedream/5-pro-image-to-image'
export const ARK_SEEDREAM_MODELS = [ARK_SEEDREAM_T2I_MODEL, ARK_SEEDREAM_I2I_MODEL] as const
export const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
// Candidate 5.0 Pro model ID. It is intentionally editable in Service connection
// because availability and model revisions are account/region scoped.
export const DEFAULT_ARK_SEEDREAM_MODEL = 'doubao-seedream-5-0-pro-260628'
export const ARK_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'

export function isArkGenerateModel(model: string) {
  return (ARK_SEEDREAM_MODELS as readonly string[]).includes(model)
}

export function arkRequestModel(model: string, configuredModel = DEFAULT_ARK_SEEDREAM_MODEL) {
  if (!isArkGenerateModel(model))
    return model
  return configuredModel.trim() || DEFAULT_ARK_SEEDREAM_MODEL
}

function imageUrls(required: boolean) {
  return {
    'type': 'array',
    ...(required ? { minItems: 1 } : {}),
    'maxItems': 10,
    'items': { type: 'string' },
    'description': 'Optional reference images. The Ark API accepts up to 10 images.',
    'x-label': 'Reference images',
    'x-accept': ARK_IMAGE_ACCEPT,
    'x-max-bytes': 30 * 1024 * 1024,
    'x-ui-component': 'uploaders',
  } as const
}

export function arkFormSchema(model: string): ModelOpenAPISchema {
  const imageToImage = model === ARK_SEEDREAM_I2I_MODEL
  return {
    components: {
      schemas: {
        Input: {
          'properties': {
            prompt: {
              'type': 'string',
              'minLength': 1,
              'maxLength': 800,
              'description': 'Describe the image or edit to generate.',
              'x-placeholder': 'Describe the image you want to generate',
            },
            image_urls: imageUrls(imageToImage),
            size: {
              type: 'string',
              enum: ['1K', '2K', '4K'],
              default: '2K',
              description: 'Output resolution preset.',
            },
            watermark: {
              type: 'boolean',
              default: false,
              description: 'Whether to add the provider watermark.',
            },
          },
          'required': imageToImage ? ['prompt', 'image_urls'] : ['prompt'],
          'x-order-properties': ['prompt', 'image_urls', 'size', 'watermark'],
        },
      },
    },
  }
}
