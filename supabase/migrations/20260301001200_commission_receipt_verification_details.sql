BEGIN;

ALTER TABLE public.developer_commission_receipts
  ADD COLUMN IF NOT EXISTS received_on DATE NULL,
  ADD COLUMN IF NOT EXISTS transfer_reference VARCHAR(120) NULL;

COMMIT;
