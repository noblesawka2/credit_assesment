ALTER TABLE public.credit_applications ALTER COLUMN external_member_id DROP NOT NULL;
ALTER TABLE public.credit_applications ADD CONSTRAINT credit_unlinked_draft_only
  CHECK (external_member_id IS NOT NULL OR (status = 'DRAFT' AND submitted_at IS NULL AND reference IS NULL));
