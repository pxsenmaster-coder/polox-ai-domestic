import Ajv from 'ajv'
import { ARK_SEEDREAM_I2I_MODEL, arkFormSchema, isArkGenerateModel } from '~~/shared/utils/arkSeedream'

const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false, useDefaults: true })
const validators = new Map<string, ReturnType<typeof ajv.compile>>()

export function sanitizeArkInput(model: string, raw: Record<string, unknown>) {
  if (!isArkGenerateModel(model))
    throw createError({ statusCode: 400, statusMessage: 'Unknown Ark model' })
  const schema = arkFormSchema(model).components.schemas.Input
  const allowed = new Set(Object.keys(schema.properties))
  const unknown = Object.keys(raw).filter(key => !allowed.has(key))
  if (unknown.length)
    throw createError({ statusCode: 400, statusMessage: `Unknown Ark parameter: ${unknown.join(', ')}` })
  const input = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)))
  let validate = validators.get(model)
  if (!validate) {
    validate = ajv.compile({
      type: 'object',
      properties: schema.properties,
      required: schema.required,
      additionalProperties: false,
    })
    validators.set(model, validate)
  }
  if (!validate(input))
    throw createError({ statusCode: 400, statusMessage: ajv.errorsText(validate.errors, { separator: '; ' }) })
  if (model === ARK_SEEDREAM_I2I_MODEL && (!Array.isArray(input.image_urls) || !input.image_urls.length))
    throw createError({ statusCode: 400, statusMessage: 'At least one reference image is required for Ark image-to-image' })
  for (const url of Array.isArray(input.image_urls) ? input.image_urls : []) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw createError({ statusCode: 400, statusMessage: 'image_urls must contain HTTP URLs' })
  }
  return input
}
