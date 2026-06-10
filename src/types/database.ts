export type Paper = 'FLK1' | 'FLK2'
export type SourceMaterialStatus = 'processing' | 'done' | 'failed'
export type ChunkExtractionStatus = 'pending' | 'extracting' | 'extracted' | 'failed'
export type QuestionType = 'mcq' | 'flashcard'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type QuestionStatus = 'draft' | 'approved' | 'archived'
export type SessionMode = 'drill' | 'simulate' | 'recall'
export type SelfAssessment = 'got_it' | 'nearly' | 'missed_it'
export type Confidence = 'shaky' | 'okay' | 'solid'
export type ChunkConfidence = 'unseen' | 'shaky' | 'okay' | 'solid'
export type RuleType = 'definition' | 'threshold' | 'test' | 'exception' | 'procedure' | 'consequence' | 'general_principle' | 'uncertain'
export type FeedbackType =
  // Question-specific
  | 'wrong_answer'
  | 'poor_explanation'
  | 'outdated_law'
  | 'misleading_question'
  // App-level
  | 'bug'
  | 'feature_request'
  | 'content_request'
  | 'other'
export type FeedbackStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed'

export interface Feedback {
  id: string
  user_id: string | null
  question_id: string | null
  feedback_type: FeedbackType
  description: string
  status: FeedbackStatus
  admin_note: string | null
  created_at: string
}

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

export interface Subtopic {
  id: string
  topic_id: string
  name: string
  slug: string
  sort_order: number
  created_at: string
}

export interface KnowledgeChunk {
  id: string
  topic_id: string
  subtopic_id: string | null
  source_material_id: string | null
  rule_text: string
  exact_source_quote: string | null
  context_text: string | null
  source_section: string | null
  key_terms: string[]
  rule_type: RuleType
  is_approved: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface UserChunkMastery {
  id: string
  user_id: string
  chunk_id: string
  confidence_level: ChunkConfidence
  correct_count: number
  attempt_count: number
  last_tested_at: string | null
  updated_at: string
}

export interface Question {
  id: string
  topic_id: string | null
  knowledge_chunk_id: string | null
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
  chunk_status: ChunkExtractionStatus
  chunks_extracted: number
  chunk_error: string | null
}

// Joined / enriched types
export interface KnowledgeChunkWithTopic extends KnowledgeChunk {
  topic?: Topic
  subtopic?: Subtopic
}
