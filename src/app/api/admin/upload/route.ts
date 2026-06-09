import { createClient, createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL, MODEL_BULK } from '@/lib/anthropic'
import { chunkText, chunkForImport, type TextChunk } from '@/lib/chunker'

// ── Prompts ──────────────────────────────────────────────────────────────────

const TOPIC_GUIDE = `
TOPIC MAPPING — read the question content carefully and pick the SINGLE most accurate slug:

business-law      → company formation, articles, directors duties, board meetings, shareholders rights,
                    share capital, dividends, LLP, general partnerships, company insolvency, winding up,
                    administration, receivership, taxation of companies, close companies, accounts/audit

dispute-resolution → CPR, civil procedure, starting a claim, particulars of claim, defence, default judgment,
                    summary judgment, interim injunctions, disclosure/inspection, witness statements,
                    expert evidence, case management, trial, enforcement of judgments, costs/COSTS budgeting,
                    ADR, mediation, appeals (civil), small claims, fast track, multi-track

contract          → offer & acceptance, consideration, intention to create legal relations, capacity, terms
                    (express/implied), exclusion clauses, UCTA, misrepresentation, mistake, duress, undue
                    influence, illegality, privity, assignment, frustration, breach, damages, specific
                    performance, injunctions, limitation

tort              → negligence, duty of care, breach, causation, remoteness, contributory negligence,
                    occupiers liability, employer liability, vicarious liability, psychiatric harm,
                    pure economic loss, product liability, nuisance (private/public), trespass to land,
                    Rylands v Fletcher, defamation

legal-system      → sources of law, statutory interpretation, precedent/stare decisis, courts hierarchy,
                    EU law (retained), constitutional law, separation of powers, parliamentary sovereignty,
                    HRA 1998, Convention rights, judicial review, prerogative powers, delegated legislation

legal-services    → SRA Standards & Regulations, professional conduct, solicitors duties, conflicts of
                    interest, confidentiality, privilege, money laundering/AML, client care, fees,
                    complaints, regulatory framework, professional indemnity

property-practice → residential/commercial conveyancing, stages of a transaction, deducing title,
                    searches (local authority, drainage, environmental), enquiries, contract of sale,
                    exchange of contracts, completion, SDLT, Land Registry registration, new builds,
                    leasehold transactions, rent/service charges

land-law          → freehold estates, leasehold estates, legal/equitable interests, easements,
                    freehold covenants, co-ownership (joint tenancy/tenancy in common), TOLATA,
                    mortgages, adverse possession, land registration (LRA 2002), overriding interests,
                    overreaching, priority of interests

trusts            → express trusts (creation, certainties), resulting trusts, constructive trusts,
                    proprietary estoppel, trustees powers and duties, breach of trust, equitable
                    remedies, charities, purpose trusts, Quistclose trusts

wills             → formalities (Wills Act 1837), capacity and knowledge/approval, undue influence,
                    revocation, alteration, intestacy (Administration of Estates Act 1925),
                    inheritance tax (IHT), potentially exempt transfers, nil rate band, estate
                    administration, probate, personal representatives, powers of attorney

solicitors-accounts → SRA Accounts Rules, client money, office money, mixed money, statutory trust,
                      interest on client money, bills of costs, third party managed accounts,
                      residual balances, accountants reports

criminal-law      → homicide (murder/manslaughter), non-fatal offences (assault/ABH/GBH), theft,
                    robbery, burglary, fraud, criminal damage, sexual offences, defences
                    (self-defence, intoxication, duress, insanity), inchoate offences, accessory
                    liability, sentencing principles, youth offenders`

const DIFFICULTY_GUIDE = `
DIFFICULTY CALIBRATION — the SQE1 is a hard exam. Be strict:
  easy   = pure rule recall ("What is the test for X?") — max 20% of output
  medium = single-issue application to facts ("On these facts, has X occurred?") — 40% of output
  hard   = multi-step reasoning, competing principles, or a trap where the obvious answer is wrong — 40% of output

Hard questions should:
- Present a realistic scenario with 2-3 interacting legal issues
- Include a distractor that would fool someone who knows the rule but misapplies it
- Test the exceptions, qualifications, and edge cases — not the headline rule`

const GENERATE_SYSTEM = `You are a senior SQE1 exam writer for England and Wales. Source material is compressed revision notes.

For each distinct legal rule or principle you find, generate:
- Two MCQs at Hard difficulty
- One MCQ at Medium difficulty
- One flashcard (crisp rule-recall prompt + precise complete answer)

Do NOT generate easy questions unless the rule is genuinely introductory.

MCQs: exactly 5 options A–E, exactly one correct, four plausible distractors that test understanding.
Explanation: explain why the correct answer is right AND specifically why each wrong option fails.
${TOPIC_GUIDE}
${DIFFICULTY_GUIDE}

Return ONLY valid JSON, no markdown fences:
{"questions":[{"topic_slug":"string","type":"mcq"|"flashcard","difficulty":"easy"|"medium"|"hard","prompt":"string","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],"correct_answer":"A"|"B"|"C"|"D"|"E","explanation":"string"}]}
Flashcards: options=null, correct_answer=null, explanation=full rule answer.`

const IMPORT_SYSTEM = `You are parsing an official SRA SQE1 sample question paper for England and Wales.

The document format is:
- Questions are numbered "Question 1", "Question 2" etc. (or just "1.", "2.")
- Each question has a scenario/fact pattern, then "Which of the following..." or similar
- Options are labelled A. B. C. D. E.
- An answer key appears at the end formatted as: "1 B  2 C  3 A..." or in two columns

Your job: extract EVERY question in this chunk.

For each question:
1. "prompt": copy the FULL question text verbatim including the scenario and the question asked
2. "options": copy each of A, B, C, D, E verbatim
3. "correct_answer": use the ANSWER KEY section at the bottom of this text (look for "=== ANSWER KEY ===" marker). Match the question number to the letter. If no key is present, use your legal knowledge.
4. "explanation": 2-3 sentences — why the correct answer is right, why the main distractor is wrong
5. "topic_slug": classify based on legal subject matter
6. "difficulty": "medium" for application questions, "hard" for complex multi-issue scenarios, "easy" only for pure recall
${TOPIC_GUIDE}

Return ONLY valid JSON, no markdown, no commentary:
{"questions":[{"topic_slug":"string","type":"mcq","difficulty":"easy"|"medium"|"hard","prompt":"string","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],"correct_answer":"A"|"B"|"C"|"D"|"E","explanation":"string"}]}`

// ── Helpers ───────────────────────────────────────────────────────────────────

interface GeneratedQuestion {
  topic_slug: string
  type: 'mcq' | 'flashcard'
  difficulty?: 'easy' | 'medium' | 'hard'
  prompt: string
  options?: Array<{ label: string; text: string }> | null
  correct_answer?: string | null
  explanation?: string
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === 'txt') return buffer.toString('utf-8')
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer })).value
  }
  if (ext === 'pdf') {
    // pdf-parse v1 — callable as a function directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
    const result = await pdfParse(buffer)
    return result.text
  }
  throw new Error(`Unsupported file type: .${ext}`)
}


const VALID_SLUGS = new Set([
  'business-law','dispute-resolution','contract','tort','legal-system',
  'legal-services','property-practice','land-law','trusts','wills',
  'solicitors-accounts','criminal-law',
])

// Fuzzy slug correction — if Claude returns something close, map it
const SLUG_ALIASES: Record<string, string> = {
  'business': 'business-law',
  'business law': 'business-law',
  'dispute': 'dispute-resolution',
  'civil litigation': 'dispute-resolution',
  'civil procedure': 'dispute-resolution',
  'contract law': 'contract',
  'tort law': 'tort',
  'public law': 'legal-system',
  'constitutional law': 'legal-system',
  'legal system': 'legal-system',
  'professional conduct': 'legal-services',
  'solicitors': 'legal-services',
  'property': 'property-practice',
  'conveyancing': 'property-practice',
  'land': 'land-law',
  'equity': 'trusts',
  'trusts and equity': 'trusts',
  'wills and probate': 'wills',
  'wills and administration': 'wills',
  'probate': 'wills',
  'accounts': 'solicitors-accounts',
  'criminal': 'criminal-law',
  'criminal litigation': 'criminal-law',
}

function normaliseSlug(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.toLowerCase().trim().replace(/_/g, '-')
  if (VALID_SLUGS.has(s)) return s
  if (ALIAS_MAP.has(s)) return ALIAS_MAP.get(s)!
  // partial match
  for (const [alias, slug] of ALIAS_MAP) {
    if (s.includes(alias) || alias.includes(s)) return slug
  }
  return null
}

const ALIAS_MAP = new Map(Object.entries(SLUG_ALIASES))

async function callClaude(
  system: string,
  content: string,
  topicHint?: string | null,
  mode: 'generate' | 'import' = 'generate'
): Promise<GeneratedQuestion[]> {
  const model = mode === 'import' ? MODEL : MODEL_BULK

  const userContent = topicHint
    ? `The following content is from the "${topicHint}" section. Prefer topic_slug "${topicHint}" unless clearly wrong.\n\n${content}`
    : content

  let raw = ''
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed.questions)) {
      console.warn('[upload] Claude returned JSON but no questions array. Keys:', Object.keys(parsed))
      return []
    }

    // Normalise slugs — filter out questions with unresolvable slugs
    const valid: GeneratedQuestion[] = []
    for (const q of parsed.questions) {
      const slug = normaliseSlug(q.topic_slug)
      if (slug) {
        valid.push({ ...q, topic_slug: slug })
      } else {
        console.warn('[upload] Unresolvable slug:', q.topic_slug, '— skipping question:', q.prompt?.slice(0, 60))
      }
    }
    console.log(`[upload] Claude returned ${parsed.questions.length} questions, ${valid.length} with valid slugs`)
    return valid
  } catch (e) {
    console.error('[upload] Claude parse error:', e instanceof Error ? e.message : e)
    console.error('[upload] Raw response (first 400):', raw.slice(0, 400))
    return []
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return new Response('Forbidden', { status: 403 })

  const formData = await request.formData()
  const files = formData.getAll('files') as File[]
  const uploadMode = (formData.get('mode') as string) === 'generate' ? 'generate' : 'import'

  if (!files.length) return new Response('No files', { status: 400 })

  const admin = createAdminClient()
  const { data: topics } = await admin.from('topics').select('id, slug')
  const slugToId = new Map((topics ?? []).map((t: { slug: string; id: string }) => [t.slug, t.id]))

  const systemPrompt = uploadMode === 'generate' ? GENERATE_SYSTEM : IMPORT_SYSTEM

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: object) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      let grandTotal = 0

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        const fileName = file.name
        const ext = fileName.toLowerCase().split('.').pop() ?? ''

        send('file_start', { file: fileName, fileNum: fi + 1, total: files.length })

        // Create DB record
        const { data: sm } = await admin
          .from('source_materials')
          .insert({ file_name: fileName, file_type: ext, status: 'processing', uploaded_by: user.id })
          .select('id').single()
        const materialId = sm?.id

        // Extract text
        send('step', { file: fileName, message: 'Extracting text…' })
        let text = ''
        try {
          text = await extractText(Buffer.from(await file.arrayBuffer()), ext)
          console.log(`[upload] Extracted ${text.length} chars from ${fileName}`)
          console.log(`[upload] First 300 chars: ${text.slice(0, 300).replace(/\n/g, '↵')}`)
          console.log(`[upload] Last 300 chars: ${text.slice(-300).replace(/\n/g, '↵')}`)
          if (materialId) await admin.from('source_materials').update({ raw_text: text }).eq('id', materialId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Extraction failed'
          console.error(`[upload] Extraction failed for ${fileName}:`, msg)
          if (materialId) await admin.from('source_materials').update({ status: 'failed', error_message: msg }).eq('id', materialId)
          send('file_error', { file: fileName, error: msg })
          continue
        }

        if (!text.trim()) {
          if (materialId) await admin.from('source_materials').update({ status: 'failed', error_message: 'No text extracted' }).eq('id', materialId)
          send('file_error', { file: fileName, error: 'No text could be extracted' })
          continue
        }

        // Chunk — generate mode gets context-aware structured chunks
        type AnyChunk = TextChunk | string

        // For import mode: extract the raw answer key section and append to every chunk.
        // SQE sample papers have a two-column answer key at the end (e.g. "1 B  46 A\n2 C  47 B...")
        // We pass it raw so Claude handles the column layout — don't try to parse it ourselves.
        let answerKeyAppendix = ''
        if (uploadMode === 'import') {
          const last4000 = text.slice(-4000)
          // Count how many "number letter" pairs exist — if enough, this is the answer key
          const pairCount = (last4000.match(/\b\d{1,3}\s+[A-E]\b/g) ?? []).length
          if (pairCount >= 5) {
            answerKeyAppendix = `\n\n=== ANSWER KEY (from end of document — use question numbers to match) ===\n${last4000.trim()}\n===`
            console.log(`[upload] Answer key appended — found ${pairCount} answer pairs in last 4000 chars`)
          } else {
            console.warn(`[upload] No answer key detected (only ${pairCount} pairs found)`)
          }
        }

        const rawChunks: AnyChunk[] = uploadMode === 'generate'
          ? chunkText(text)
          : chunkForImport(text).map(c => answerKeyAppendix ? c + answerKeyAppendix : c)

        if (materialId) await admin.from('source_materials').update({ total_chunks: rawChunks.length }).eq('id', materialId)

        send('step', {
          file: fileName,
          message: `Split into ${rawChunks.length} sections — processing all`,
          chunks: rawChunks.length,
        })

        // Process each chunk
        const allQuestions: GeneratedQuestion[] = []
        let chunksDone = 0

        for (const raw of rawChunks) {
          const isStructured = typeof raw === 'object'
          const chunkText2 = isStructured ? (raw as TextChunk).text : raw as string
          const topicHint = isStructured ? (raw as TextChunk).topicSlug : null
          const headerLabel = isStructured ? ((raw as TextChunk).topicHeader ?? '') : ''

          // Skip chunks with no actual question content (intro pages, footer, etc.)
          const textBeforeAnswerKey = chunkText2.split('=== ANSWER KEY')[0]
          const hasQuestion = /question\s+\d{1,3}/i.test(textBeforeAnswerKey) ||
                              /which of the following|select the (best|correct|most)/i.test(textBeforeAnswerKey) ||
                              /\nA\.\s+\w|\nA\s{2,}\w/.test(textBeforeAnswerKey)

          if (!hasQuestion) {
            chunksDone++
            console.log(`[upload] Skipping non-question chunk ${chunksDone}/${rawChunks.length} (intro/footer)`)
            continue
          }

          send('chunk_progress', {
            file: fileName,
            done: chunksDone,
            total: rawChunks.length,
            pct: Math.round((chunksDone / rawChunks.length) * 100),
            message: headerLabel
              ? `Processing: ${headerLabel} (${chunksDone + 1}/${rawChunks.length})`
              : `Processing section ${chunksDone + 1} of ${rawChunks.length}…`,
          })

          const qs = await callClaude(systemPrompt, chunkText2, topicHint, uploadMode)
          allQuestions.push(...qs)
          chunksDone++

          send('chunk_progress', {
            file: fileName,
            done: chunksDone,
            total: rawChunks.length,
            pct: Math.round((chunksDone / rawChunks.length) * 100),
            questionsFound: allQuestions.length,
            message: headerLabel
              ? `Done: ${headerLabel} — ${allQuestions.length} questions total`
              : `Section ${chunksDone} done — ${allQuestions.length} questions so far`,
          })

          if (materialId && chunksDone % 5 === 0) {
            await admin.from('source_materials').update({ chunks_processed: chunksDone }).eq('id', materialId)
          }
        }

        // Save
        send('step', { file: fileName, message: `Saving ${allQuestions.length} questions…` })

        const rows = allQuestions
          .filter(q => q.topic_slug && slugToId.has(q.topic_slug))
          .map(q => ({
            topic_id: slugToId.get(q.topic_slug)!,
            type: q.type ?? 'mcq',
            difficulty: q.difficulty ?? 'medium',
            prompt: q.prompt,
            options: q.options ?? null,
            correct_answer: q.correct_answer ?? null,
            explanation: q.explanation ?? null,
            status: 'draft' as const,
            source_file: fileName,
          }))

        if (rows.length > 0) await admin.from('questions').insert(rows)

        if (materialId) {
          await admin.from('source_materials').update({
            status: 'done',
            questions_generated: rows.length,
            chunks_processed: chunksDone,
          }).eq('id', materialId)
        }

        grandTotal += rows.length
        send('file_done', { file: fileName, questions: rows.length, chunks: chunksDone })
      }

      send('all_done', { total_questions: grandTotal })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
