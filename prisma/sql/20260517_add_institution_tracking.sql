-- Adds nullable institution and participant-token validity columns for the
-- institution tracking rollout. This patch is safe to rerun against Prism DB.

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS institution_id INTEGER,
  ADD COLUMN IF NOT EXISTS participant_token_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS participant_token_invalid_reason TEXT;

ALTER TABLE participant_tokens
  ADD COLUMN IF NOT EXISTS institution_id INTEGER;

ALTER TABLE oauth_pipelines
  ADD COLUMN IF NOT EXISTS participant_institution_id INTEGER;

CREATE INDEX IF NOT EXISTS connections_institution_id_idx
  ON connections (institution_id);

CREATE INDEX IF NOT EXISTS connections_participant_token_valid_idx
  ON connections (participant_token_valid);

CREATE INDEX IF NOT EXISTS participant_tokens_institution_id_idx
  ON participant_tokens (institution_id);

CREATE INDEX IF NOT EXISTS oauth_pipelines_participant_institution_id_idx
  ON oauth_pipelines (participant_institution_id);
