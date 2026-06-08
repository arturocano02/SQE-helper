# SQE1 Study Platform — Master Reference Document

> **Purpose:** This file is the single source of truth for the app's architecture, feature set, and build status.
> It must be updated on every meaningful commit or session. Never guess — check here first.

---

## What This App Is

An AI-powered adaptive study platform for UK law students preparing for the **SQE1** (Solicitors Qualifying Examination, Functioning Legal Knowledge papers FLK1 and FLK2). It replaces generic tools like Barbri with a smarter, more personal experience.

**Target users:** Law students and trainee solicitors, ~6–18 months before their SQE1 sitting.

**Commercial status:** Pre-revenue. Free for now. First user is a known individual whose existing wrong-answer notes have been used to inform the import feature.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | `src/` directory structure |
| Database + Auth | Supabase (Postgres + Auth) | Google OAuth only |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) | Centralised question generation — admin only |
| Styling | Tailwind CSS (custom design tokens) | Dark-mode only. No component library. |
| Fonts | `next/font/google` | Cormorant Garamond (serif, headings) + DM Sans (sans, body) |
| File parsing | `mammoth` (.docx), `pdf-parse` (.pdf) | Server-side only |
| Hosting | Vercel | Fluid Compute, Node.js 24 |
| Spaced repetition | SM-2 algorithm | Implemented in `src/lib/srs.ts` |

---

## Design System

**Philosophy:** "Warm late-night study session." Not a tech product. Not an AI product.

| Token | Value | Usage |
|---|---|---|
| `bg` | `#0D0D0B` | Page background |
| `surface` | `#161613` | Cards |
| `surface2` | `#1E1E1A` | Inputs, hover states |
| `border` | `#2A2A24` | All borders |
| `accent` | `#C8922A` | CTAs, selected states, progress |
| `accent-dim` | `#5C3F0D` | Selected card backgrounds |
| `primary` | `#EEE9DF` | Main text |
| `secondary` | `#8C876F` | Labels, captions |
| `muted` | `#4A4740` | Disabled, timestamps |
| `success` | `#4ADE80` | Correct answers |
| `error` | `#F87171` | Wrong answers |
| `warning` | `#FBBF24` | Medium difficulty, caution |

**Hard rules — never break:**
1. Five MCQ options always (A–E). The real SQE1 uses A–E.
2. No purple, violet, or blue anywhere — not in hover, focus rings, badges.
3. Every MCQ result must show a full explanation of all five options.
4. Sessions must always be pauseable and resumeable.
5. The home screen suggests but never forces. No pop-ups, no guilt mechanics.

---

## Content Architecture

### Centralised Question Bank (Admin-Owned)

All source material is uploaded **once** by an admin. Claude generates questions from it. Questions go into the shared `questions` table and are served to **all users**.

**This means:**
- No per-user Claude calls for core content — token cost paid once per source file
- Admin reviews and approves all AI-generated questions before they go live
- Source files tracked in `source_materials` table with extraction status
- Users share the question bank — mastery/SRS state is per-user, questions are shared

### User-Uploaded Notes (Optional, Personal)

Users can optionally upload their own revision notes during onboarding (Step 3) or from their profile later. These are parsed by Claude to:
- Identify weak areas and seed their personal mastery scores
- Create `question_history` entries (`is_imported: true`) so the platform knows what they've struggled with
- **Do NOT create new questions in the shared bank** — user notes stay private to that user

**During onboarding, this is clearly framed as:**
> "Upload your own notes to personalise your starting point — optional. The question bank already has content for everyone."

### SQE1 Topic Taxonomy

**FLK1 (6 topics)**
1. Business Law and Practice → Formation, Directors' Duties, Shareholders, Taxation, Insolvency, etc.
2. Dispute Resolution → Starting a claim, Default judgment, Case management, Trial, Enforcement
3. Contract → Formation, Terms, Termination, Privity, Discharge, Remedies
4. Tort → Negligence, Employer's liability, Psychiatric harm, Land torts, Product liability
5. Legal System and Constitutional Law → Sources of Law, Courts, Constitution, HRA, Judicial Review
6. Legal Services

**FLK2 (6 topics)**
7. Property Practice → Freehold/Leasehold transactions, Searches, Exchange, Completion
8. Land Law → Nature of land, Freehold covenants, Co-ownership, Leases
9. Trusts → Types, Proprietary estoppel, Trustees, Equitable claims
10. Wills and Administration of Estates → Validity, IHT, Administration, Tax planning
11. Solicitors Accounts
12. Criminal Law and Practice → Police powers, Bail, Sentencing, Appeals

---

## Database Schema

### Tables

**`topics`** — 12 rows, seeded. Immutable for now.

**`profiles`** — one row per auth user
- `is_admin` bool — admins get full dashboard access

**`source_materials`** *(Phase 1b)*
- `id`, `file_name`, `file_type`, `raw_text` (TEXT — full extracted text), `status` (processing/done/failed), `questions_generated` (int), `uploaded_by` (FK → profiles), `created_at`

**`questions`** — shared bank, admin-curated
- Options stored as JSONB: `[{label:'A',text:'...'}, ...]` — always exactly 5 for MCQ
- `status`: draft → approved (users see) → archived
- `source_file` references `source_materials.file_name` (loose reference, not FK)

**`sessions`** — per-user study session
- `question_ids[]` pre-computed at creation — SRS ordered: due → unseen → not-due
- `current_question_index` — enables pause/resume

**`question_history`** — every answer ever given
- `is_imported: true` for seeded entries from user note uploads

**`user_topic_mastery`** — cached, recalculated synchronously on each answer
- `mastery_score` formula: `(easy_pct × 0.15) + (medium_pct × 0.35) + (hard_pct × 0.50)`

**`user_question_srs`** — SM-2 state per (user, question)

**`user_topic_coverage`** — onboarding confidence declaration (shaky=25, okay=55, solid=75)

### RLS
All user tables RLS-enabled. Admin API routes use service role key (server only). Topics + approved questions publicly readable.

---

## File Structure

```
src/
  app/
    (auth)/
      sign-in/page.tsx                  ← Google OAuth sign-in
      auth/callback/route.ts            ← Code exchange + profile creation + redirect
    (app)/
      home/page.tsx                     ← Dashboard: resume, suggested, neglected, all topics
      onboarding/page.tsx               ← 3-step: about you / topic coverage / optional notes
      study/
        drill/page.tsx                  ← Topic + filter selector
        drill/[sessionId]/page.tsx      ← MCQ session (keyboard shortcuts, pause/resume)
        recall/page.tsx                 ← Topic selector
        recall/[sessionId]/page.tsx     ← Flashcard session (self-assessment)
      session/[sessionId]/summary/page.tsx
      topics/[slug]/page.tsx            ← Topic detail + mastery breakdown + quick launch
      progress/page.tsx                 ← Progress overview (sessions, mastery bars)
      admin/
        page.tsx                        ← Analytics dashboard + source materials list
        content/upload/page.tsx         ← Source material upload → Claude → draft questions
        content/questions/page.tsx      ← Question bank table, filters, inline edit
    api/
      sessions/create/route.ts          ← SRS-ordered session creation
      sessions/answer/route.ts          ← Record answer + SRS update + mastery recalc
      sessions/complete/route.ts        ← Complete (POST) or pause (PATCH)
      admin/upload/route.ts             ← File → extract → chunk → Claude → insert drafts
      admin/questions/route.ts          ← PUT (update), PATCH (bulk status)
      import/route.ts                   ← User notes → Claude parse → question_history seeds
  components/
    ui/
      Button.tsx, Card.tsx, Badge.tsx
      TopicCard.tsx, MasteryBar.tsx, ProgressBar.tsx, LoadingSpinner.tsx
    study/
      QuestionCard.tsx, OptionButton.tsx, ExplanationPanel.tsx, SessionHeader.tsx
    admin/
      QuestionTable.tsx, QuestionEditPanel.tsx
  lib/
    supabase/client.ts, server.ts       ← Browser + server/admin clients
    anthropic.ts                        ← Anthropic client, MODEL constant
    mastery.ts                          ← Score calc, confidence seed, labels
    srs.ts                              ← SM-2 algorithm
    chunker.ts                          ← ALL CAPS header splitting for FLK notes
  types/
    database.ts                         ← All types, strict (no `any`)
  middleware.ts                         ← Session refresh + route protection
```

---

## Study Modes

### 1. Topic Drill
- Multi-select topics, filter by paper/difficulty/count (10/25/50)
- SRS ordering at creation: due → unseen → not-due
- MCQ A–E, keyboard shortcuts, animated feedback, explanation panel slides up
- Escape to pause, resumes from `current_question_index`

### 2. Active Recall
- Flashcard format — tap to reveal answer
- Self-assessment: Got it / Nearly / Missed it → maps to SM-2 quality 5/3/1
- Mobile-first for this mode

### 3. Exam Simulation — **Phase 2**
- Adaptive cross-topic, drills down on weak areas
- Mirrors real SQE1 randomised format

---

## AI Prompts

### Question Generation (Admin)
System prompt instructs Claude to:
- Extract every distinct legal rule from FLK notes
- Generate easy/medium/hard MCQ + 1 flashcard per rule
- Always 5 options, exactly one correct, plausible distractors
- Full explanation: why correct is right, why each wrong option is wrong
- Map to exact topic slug
- Return strict JSON only — no markdown fences

### User Notes Import
System prompt instructs Claude to:
- Parse compressed UK law student revision notes
- Extract prompt + correct rule + topic slug per item
- All imported items tagged `confidence: "shaky"` by default
- Return strict JSON only

---

## Onboarding Flow

1. **About you** — exam date (optional) + prep level
2. **Topics covered** — mark Shaky/Okay/Solid per covered topic → seeds mastery
3. **Import notes (optional)** — clearly labelled as optional personalisation, not required
   - Framing: "The platform already has a full question bank. This just helps us understand where you are."
   - On completion → parse with Claude → seed `question_history` + mastery
   - Skip → straight to `/home`

---

## Planned Features

### Phase 2 (Next session)
- [ ] Exam Simulation mode (adaptive, cross-topic)
- [ ] Spaced repetition surfacing on home (due cards highlighted)
- [ ] Subtopic drill (drill within e.g. Contract → Discharge)
- [ ] Study streak tracking

### Phase 3 (Future)
- [ ] **"Why did you pick that?"** — After wrong answer + explanation, optional follow-up: Claude asks what the user's reasoning was, identifies the specific misconception, and corrects it. Not on every question — triggered by a "Dig deeper" button in ExplanationPanel.
- [ ] Notes viewer — show the source material section relevant to a question
- [ ] Exam timer simulation (180 min / 180 Qs format)
- [ ] Email reminders (spaced repetition nudges)
- [ ] PWA for mobile recall sessions
- [ ] Subtopic taxonomy in DB (currently implicit in question content)

### Known Gaps Before Launch
- [ ] File size limit enforcement (~10MB max) on upload routes
- [ ] Rate limiting on API routes
- [ ] `simulate` mode routes are stubs only
- [ ] No email notification system

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # Server-only. Never expose client-side.
ANTHROPIC_API_KEY=
```

---

## Build Status

### ✅ Phase 1 — Complete

| Feature | Status | Notes |
|---|---|---|
| Next.js 15 scaffold, TypeScript strict | ✅ | Zero TS errors |
| Design system (tokens, fonts, dark mode) | ✅ | |
| Google OAuth + Supabase auth | ✅ | |
| Middleware route protection | ✅ | |
| Onboarding 3-step | ✅ | |
| Home dashboard | ✅ | Resume, suggested, neglected, grid |
| Topic Drill (launcher + session) | ✅ | Keyboard shortcuts, pause/resume |
| Active Recall (launcher + session) | ✅ | Self-assessment, mobile-friendly |
| Session summary | ✅ | |
| Progress page | ✅ | |
| Topic detail page | ✅ | |
| Admin: upload → Claude → draft Qs | ✅ | |
| Admin: question table + edit + approve | ✅ | |
| All session API routes | ✅ | |
| SM-2 SRS | ✅ | |
| Mastery score calculation | ✅ | |
| User notes import (personal) | ✅ | |
| DB schema + RLS + seed topics | ✅ | |
| Clean production build | ✅ | |

### ✅ Phase 1b — Complete (this session)

| Feature | Status |
|---|---|
| `source_materials` DB table + migration | ✅ |
| Admin dashboard `/admin` with analytics | ✅ |
| Source material list + expandable text preview | ✅ |
| Per-topic question count bars in admin | ✅ |
| Upload route saves to `source_materials`, tracks progress | ✅ |
| Onboarding Step 3 re-framed (optional/personal, privacy explained) | ✅ |
| CLAUDE.md created | ✅ |

### ⏳ Phase 2 — Not started

| Feature | Status |
|---|---|
| Exam Simulation mode | ⏳ |
| Spaced repetition home surfacing | ⏳ |
| Full progress analytics | ⏳ |
| Subtopic drill | ⏳ |
| Study streaks | ⏳ |

---

## Key Architectural Decisions

1. **Centralised question bank, not per-user generation.** Admin pays Claude API cost once. All users share approved questions. Personal notes are imported as history signals only.
2. **No client-side mutations.** All writes via Next.js API routes. Service role key server-only.
3. **Pre-computed session question lists.** `question_ids[]` set at creation. Pause/resume = track `current_question_index`.
4. **Synchronous mastery recalculation.** Updated in the same API call as recording an answer. No queues in Phase 1.
5. **Draft → Approved workflow.** AI generates drafts. Admin approves. Users see only approved questions.
6. **SM-2 SRS is per (user, question).** Shared questions, individual progression.

---

*Last updated: 2026-06-08 — Phase 1b*
