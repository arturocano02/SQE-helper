import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const MODEL = 'claude-sonnet-4-6-20250620'                // import mode — needs accuracy
export const MODEL_BULK = 'claude-haiku-4-5-20251001'   // generate mode — cheap + fast
