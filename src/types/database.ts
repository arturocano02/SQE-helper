export type Paper = 'FLK1' | 'FLK2'
export type SourceMaterialStatus = 'processing' | 'done' | 'failed'
export type QuestionType = 'mcq' | 'flashcard'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type QuestionStatus = 'draft' | 'approved' | 'archived'
export type SessionMode = 'drill' | 'simulate' | 'recall'
export type SelfAssessment = 'got_it' | 'nearly' | 'missed_it'
export type Confidence = 'shaky' | 'okay' | 'solid'

export interface MCQOption {
  label: 'A' | 'B' | 'C' | 'D' | 'E'
  text: string
}

export interface Topic {
  id: string
  name: string
  paper: Paper
  slug: string
  sort_order: number
  created_at: string
}

export interface Profile {
  id: string
  name: string | null
  avatar_url: string | null
  exam_date: string | null
  is_admin: boolean
  onboarding_complete: boolean
  created_at: string
}

export interface Question {
  id: string
  topic_id: string | null
  type: QuestionType
  difficulty: Difficulty | null
  prompt: string
  options: MCQOption[] | null
  correct_answer: string | null
  explanation: string | null
  status: QuestionStatus
  source_file: string | null
  version: number
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  mode: SessionMode
  topic_ids: string[] | null
  started_at: string
  ended_at: string | null
  paused_at: string | null
  current_question_index: number
  question_ids: string[] | null
  total_questions: number | null
  correct_count: number
  is_complete: boolean
}

export interface QuestionHistory {
  id: string
  user_id: string
  question_id: string | null
  session_id: string | null
  was_correct: boolean | null
  selected_answer: string | null
  self_assessment: SelfAssessment | null
  answered_at: string
  is_imported: boolean
}

export interface UserTopicMastery {
  user_id: string
  topic_id: string
  mastery_score: number
  easy_correct: number
  easy_total: number
  medium_correct: number
  medium_total: number
  hard_correct: number
  hard_total: number
  last_visited_at: string | null
}

export interface UserQuestionSrs {
  user_id: string
  question_id: string
  next_review_at: string
  ease_factor: number
  interval_days: number
  repetitions: number
}

export interface UserTopicCoverage {
  user_id: string
  topic_id: string
  confidence: Confidence
  set_at: string
}

// Joined / enriched types used in the UI
export interface TopicWithMastery extends Topic {
  mastery?: UserTopicMastery
}

export interface QuestionWithTopic extends Question {
  topic?: Topic
}

export interface SessionWithDetails extends Session {
  topics?: Topic[]
}

export interface SourceMaterial {
  id: string
  file_name: string
  file_type: string
  raw_text: string | null
  status: SourceMaterialStatus
  questions_generated: number
  chunks_processed: number
  total_chunks: number
  error_message: string | null
  uploaded_by: string | null
  created_at: string
}
