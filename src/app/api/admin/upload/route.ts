import { createClient, createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL_BULK } from '@/lib/anthropic'
import { chunkText } from '@/lib/chunker'

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

const IMPORT_SYSTEM = `You are parsing an official SQE1 sample question paper for England and Wales.

Extract EVERY MCQ exactly as written:
- Copy the question prompt verbatim (preserve all scenario details)
- Copy all 5 options A–E verbatim
- Correct answer: look for an answer key section at the end of the document — answers are often listed as "1. C  2. A  3. B..." Match each question number to its answer. If no answer key is visible in this chunk, use your legal knowledge to determine the correct answer.
- Explanation: write 3-5 sentences explaining why the correct answer is right and why each wrong option fails
- Topic: read the question content carefully and assign the most accurate slug
${TOPIC_GUIDE}
${DIFFICULTY_GUIDE}

Return ONLY valid JSON, no markdown fences:
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    return (await pdfParse(buffer)).text
  }
  throw new Error(`Unsupported file type: .${ext}`)
}

/**
 * For import mode: split into larger chunks (~20 questions each).
 * Sample question papers don't have ALL CAPS headers so we split by size only.
 */
function chunkForImport(text: string): string[] {
  const CHUNK_SIZE = 6000
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    // Try to break at a question boundary (newline before a number like "\n12.")
    let end = Math.min(i + CHUNK_SIZE, text.length)
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n', end)
      if (breakAt > i + 2000) end = breakAt
    }
    const chunk = text.slice(i, end).trim()
    if (chunk.length > 100) chunks.push(chunk)
    i = end
  }
  return chunks
}

async function callClaude(system: string, content: string): Promise<GeneratedQuestion[]> {
  try {
    const message = await anthropic.messages.create({
      model: MODEL_BULK,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content }],
    })
    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed.questions) ? parsed.questions : []
  } catch {
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
          if (materialId) await admin.from('source_materials').update({ raw_text: text }).eq('id', materialId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Extraction failed'
          if (materialId) await admin.from('source_materials').update({ status: 'failed', error_message: msg }).eq('id', materialId)
          send('file_error', { file: fileName, error: msg })
          continue
        }

        if (!text.trim()) {
          if (materialId) await admin.from('source_materials').update({ status: 'failed', error_message: 'No text extracted' }).eq('id', materialId)
          send('file_error', { file: fileName, error: 'No text could be extracted' })
          continue
        }

        // Chunk
        const rawChunks = uploadMode === 'generate' ? chunkText(text) : chunkForImport(text)
        // No hard cap — process everything. Vercel allows 300s; Haiku is ~1.5s/chunk.
        // Practical limit: ~150 chunks = ~225s. Warn in UI if over 120.
        const chunks = rawChunks
        const skipped = 0
        if (materialId) await admin.from('source_materials').update({ total_chunks: chunks.length }).eq('id', materialId)

        send('step', {
          file: fileName,
          message: `Split into ${chunks.length} sections${skipped > 0 ? ` (${skipped} skipped — file too large)` : ''}`,
          chunks: chunks.length,
        })

        // Process each chunk
        const allQuestions: GeneratedQuestion[] = []
        let chunksDone = 0

        for (const chunk of chunks) {
          send('chunk_progress', {
            file: fileName,
            done: chunksDone,
            total: chunks.length,
            pct: Math.round((chunksDone / chunks.length) * 100),
            message: `Processing section ${chunksDone + 1} of ${chunks.length}…`,
          })

          const qs = await callClaude(systemPrompt, chunk)
          allQuestions.push(...qs)
          chunksDone++

          send('chunk_progress', {
            file: fileName,
            done: chunksDone,
            total: chunks.length,
            pct: Math.round((chunksDone / chunks.length) * 100),
            questionsFound: allQuestions.length,
            message: `Section ${chunksDone} done — ${allQuestions.length} questions so far`,
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
