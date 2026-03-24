-- Coach conversation persistence for eval quality tracking and learning
-- Each row = one exchange (user question + assistant response) with full message context

CREATE TABLE IF NOT EXISTS coach_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  turn_index SMALLINT NOT NULL DEFAULT 0,
  user_message TEXT NOT NULL,
  assistant_message TEXT NOT NULL,
  input_messages JSONB NOT NULL,     -- full messages array sent to model
  context JSONB,                     -- focus, workout state, screen context
  metadata JSONB DEFAULT '{}',       -- model, latency_ms, token counts
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coach_conv_user_id ON coach_conversations(user_id, created_at DESC);
CREATE INDEX idx_coach_conv_session ON coach_conversations(session_id, turn_index);

ALTER TABLE coach_conversations ENABLE ROW LEVEL SECURITY;

-- Append-only: users can read and insert their own conversations
-- No UPDATE/DELETE policies — conversation data is immutable for integrity
CREATE POLICY "Users read own conversations"
  ON coach_conversations FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own conversations"
  ON coach_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
