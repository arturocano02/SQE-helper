import { anthropic, MODEL } from '@/lib/anthropic'
import type { AiVerdict } from '@/types/database'

interface GradeInput {
  prompt: string
  modelAnswer: string
  userAnswer: string
}

interface GradeResult {
  verdict: AiVerdict
  score: number
  feedback: string
}

const SYSTEM_PROMPT = `You are grading a UK SQE1 law student's free-text recall of a legal rule.

You will be given:
1. The flashcard prompt (the question/rule being recalled)
2. The model answer (the correct rule, as written by the platform)
3. The student's typed answer

Grade how closely the student's answer captures the LEGAL SUBSTANCE of the model answer —
not exact wording. Minor phrasing differences, omitted citations, or different ordering of
points should not be penalised if the legal substance is correct. Missing a key element,
threshold, exception, or getting the rule wrong should be penalised.

Return STRICT JSON only, no markdown fences, no commentary outside the JSON:
{
  "score": <integer 0-100, how closely the answer matches the model answer's legal substance>,
  "verdict": "correct" | "partial" | "incorrect",
  "feedback": "<one short sentence, max 25 words, on what was missing or wrong — empty string if fully correct>"
}

Guidance: score >= 80 -> "correct". score 50-79 -> "partial". score < 50 -> "incorrect".`

export async function gradeFlashcardAnswer(input: GradeInput): Promise<GradeResult> {
  const { prompt, modelAnswer, userAnswer } = input

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `FLASHCARD PROMPT:\n${prompt}\n\nMODEL ANSWER:\n${modelAnswer}\n\nSTUDENT'S ANSWER:\n${userAnswer}`,
        },
      ],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const raw = textBlock && 'text' in textBlock ? textBlock.text.trim() : ''
    const parsed = JSON.parse(raw) as { score: number; verdict: AiVerdict; feedback: string }

    const score = Math.max(0, Math.min(100, Math.round(parsed.score)))
    const verdict: AiVerdict = ['correct', 'partial', 'incorrect'].includes(parsed.verdict)
      ? parsed.verdict
      : (score >= 80 ? 'correct' : score >= 50 ? 'partial' : 'incorrect')

    return { score, verdict, feedback: parsed.feedback ?? '' }
  } catch {
    // If grading fails for any reason, fall back to a neutral "partial" so the
    // student isn't unfairly marked wrong by an infra hiccup — they still see
    // the full model answer to self-compare, and can dispute if needed.
    return { score: 60, verdict: 'partial', feedback: '' }
  }
}
