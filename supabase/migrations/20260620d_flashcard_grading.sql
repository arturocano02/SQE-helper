-- ============================================================
-- AI-graded flashcard answers + dispute flow
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run — every statement is idempotent.
-- ============================================================

-- 1. CAPTURE THE USER'S TYPED ANSWER + AI GRADING ON FLASHCARD ATTEMPTS
-- Recall sessions now require the user to type their own answer before
-- seeing the model answer. Claude compares the two and grades them.
-- ============================================================
ALTER TABLE question_history ADD COLUMN IF NOT EXISTS user_answer_text TEXT;
ALTER TABLE question_history ADD COLUMN IF NOT EXISTS ai_verdict TEXT CHECK (ai_verdict IN ('correct', 'partial', 'incorrect'));
ALTER TABLE question_history ADD COLUMN IF NOT EXISTS ai_score INT CHECK (ai_score >= 0 AND ai_score <= 100);

-- 2. FLASHCARD DISPUTES VIA THE EXISTING FEEDBACK TABLE
-- A dispute is feedback pointing at a question_id where the user believes
-- the AI graded their typed answer incorrectly. Surfaces on the existing
-- admin feedback page/notification badge — no new UI needed.
-- ============================================================
ALTER TYPE feedback_type ADD VALUE IF NOT EXISTS 'flashcard_dispute';
