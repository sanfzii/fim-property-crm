BEGIN;

CREATE TABLE public.deal_commission_backfill_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  commission_rate NUMERIC(5,2) NOT NULL CHECK (commission_rate BETWEEN 0 AND 100),
  commission_total NUMERIC(15,2) NOT NULL CHECK (commission_total >= 0),
  sales_split_rate NUMERIC(5,2) NOT NULL,
  supervisor_split_rate NUMERIC(5,2) NOT NULL,
  company_split_rate NUMERIC(5,2) NOT NULL,
  previous_snapshot JSONB NOT NULL,
  new_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_backfill_audit_splits CHECK (sales_split_rate + supervisor_split_rate + company_split_rate = 100)
);

ALTER TABLE public.deal_commission_backfill_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_deal_commission_backfill_audits_admin_select
  ON public.deal_commission_backfill_audits FOR SELECT TO authenticated
  USING (app_security.get_current_user_role() = 'ADMIN');
GRANT SELECT ON public.deal_commission_backfill_audits TO authenticated;

-- Hapus overload eksperimen sebelumnya yang masih meminta supervisor_id;
-- jika dibiarkan, PostgREST tidak dapat menentukan fungsi untuk RPC dua argumen.
DROP FUNCTION IF EXISTS public.backfill_legacy_deal_commission(UUID, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.backfill_legacy_deal_commission(
  p_deal_id UUID,
  p_commission_rate NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_settings public.finance_settings%ROWTYPE;
  v_total NUMERIC(15,2);
  v_sales_amount NUMERIC(15,2);
  v_supervisor_amount NUMERIC(15,2);
  v_company_amount NUMERIC(15,2);
  v_previous JSONB;
  v_new JSONB;
BEGIN
  IF app_security.get_current_user_role() <> 'ADMIN' THEN
    RAISE EXCEPTION 'Hanya Admin yang dapat mengisi snapshot komisi Deal lama';
  END IF;
  IF p_commission_rate IS NULL OR p_commission_rate < 0 OR p_commission_rate > 100 THEN
    RAISE EXCEPTION 'Tarif komisi harus berada pada rentang 0 sampai 100 persen';
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal tidak ditemukan'; END IF;
  IF v_deal.sales_outcome_status <> 'CLOSED_WON' THEN
    RAISE EXCEPTION 'Snapshot hanya dapat diisi untuk Deal CLOSED_WON';
  END IF;
  IF v_deal.commission_total_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Deal ini sudah memiliki snapshot komisi';
  END IF;

  SELECT * INTO v_settings FROM public.finance_settings WHERE id = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengaturan pembagian komisi belum tersedia'; END IF;
  v_total := round(v_deal.final_deal_value * p_commission_rate / 100, 2);
  v_sales_amount := round(v_total * v_settings.sales_split_rate / 100, 2);
  v_supervisor_amount := round(v_total * v_settings.supervisor_split_rate / 100, 2);
  v_company_amount := v_total - v_sales_amount - v_supervisor_amount;

  UPDATE public.deals SET
    commission_rate_snapshot = p_commission_rate,
    commission_total_snapshot = v_total,
    sales_split_rate_snapshot = v_settings.sales_split_rate,
    supervisor_split_rate_snapshot = v_settings.supervisor_split_rate,
    company_split_rate_snapshot = 100 - v_settings.sales_split_rate - v_settings.supervisor_split_rate,
    sales_commission_snapshot = v_sales_amount,
    supervisor_commission_snapshot = v_supervisor_amount,
    company_commission_snapshot = v_company_amount,
    commission_supervisor_id = NULL
  WHERE id = p_deal_id;

  v_previous := jsonb_build_object('commission_rate_snapshot', NULL, 'commission_total_snapshot', NULL);
  v_new := jsonb_build_object(
    'commission_rate_snapshot', p_commission_rate,
    'commission_total_snapshot', v_total,
    'sales_split_rate_snapshot', v_settings.sales_split_rate,
    'supervisor_split_rate_snapshot', v_settings.supervisor_split_rate,
    'company_split_rate_snapshot', 100 - v_settings.sales_split_rate - v_settings.supervisor_split_rate,
    'sales_commission_snapshot', v_sales_amount,
    'supervisor_commission_snapshot', v_supervisor_amount,
    'company_commission_snapshot', v_company_amount,
    'commission_supervisor_id', NULL
  );
  INSERT INTO public.deal_commission_backfill_audits
    (deal_id, actor_user_id, commission_rate, commission_total, sales_split_rate, supervisor_split_rate, company_split_rate, previous_snapshot, new_snapshot)
  VALUES
    (p_deal_id, auth.uid(), p_commission_rate, v_total, v_settings.sales_split_rate, v_settings.supervisor_split_rate,
     100 - v_settings.sales_split_rate - v_settings.supervisor_split_rate, v_previous, v_new);
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_legacy_deal_commission(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_deal_commission(UUID, NUMERIC) TO authenticated;

-- Alokasi Supervisor tidak ditautkan ke identitas individu pada Deal baru.
CREATE OR REPLACE FUNCTION public.snapshot_deal_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC(5,2);
  v_sales NUMERIC(5,2);
  v_supervisor NUMERIC(5,2);
  v_total NUMERIC(15,2);
BEGIN
  IF NEW.sales_outcome_status = 'CLOSED_WON'
     AND (TG_OP = 'INSERT' OR OLD.sales_outcome_status IS DISTINCT FROM 'CLOSED_WON')
     AND NEW.commission_total_snapshot IS NULL THEN
    SELECT pp.developer_commission_rate INTO v_rate
    FROM public.units u JOIN public.property_projects pp ON pp.id = u.project_id
    WHERE u.id = NEW.unit_id;
    IF v_rate IS NOT NULL THEN
      SELECT sales_split_rate, supervisor_split_rate INTO v_sales, v_supervisor
      FROM public.finance_settings WHERE id = TRUE;
      v_total := round(NEW.final_deal_value * v_rate / 100, 2);
      NEW.commission_rate_snapshot := v_rate;
      NEW.commission_total_snapshot := v_total;
      NEW.sales_split_rate_snapshot := coalesce(v_sales,70);
      NEW.supervisor_split_rate_snapshot := coalesce(v_supervisor,15);
      NEW.company_split_rate_snapshot := 100 - coalesce(v_sales,70) - coalesce(v_supervisor,15);
      NEW.sales_commission_snapshot := round(v_total * coalesce(v_sales,70) / 100,2);
      NEW.supervisor_commission_snapshot := round(v_total * coalesce(v_supervisor,15) / 100,2);
      NEW.company_commission_snapshot := v_total - NEW.sales_commission_snapshot - NEW.supervisor_commission_snapshot;
      NEW.commission_supervisor_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
