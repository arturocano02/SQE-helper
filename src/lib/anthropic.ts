import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const MODEL = 'claude-sonnet-4-20250514'        // for import/parsing (quality matters)
export const MODEL_BULK = 'claude-haiku-4-5-20251001'  // for bulk question generation (cheap + fast)
