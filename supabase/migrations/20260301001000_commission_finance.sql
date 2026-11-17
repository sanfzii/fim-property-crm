BEGIN;

-- Nilai NULL berarti komisi developer belum dikonfigurasi (tidak diasumsikan).
ALTER TABLE public.property_projects
  ADD COLUMN developer_commission_rate NUMERIC(5,2) NULL,
  ADD CONSTRAINT chk_property_projects_commission_rate
    CHECK (developer_commission_rate IS NULL OR developer_commission_rate BETWEEN 0 AND 100);

-- Snapshot diisi sekali saat Deal pertama kali menjadi CLOSED_WON.
ALTER TABLE public.deals
  ADD COLUMN commission_rate_snapshot NUMERIC(5,2) NULL,
  ADD COLUMN commission_total_snapshot NUMERIC(15,2) NULL,
  ADD COLUMN sales_split_rate_snapshot NUMERIC(5,2) NULL,
  ADD COLUMN supervisor_split_rate_snapshot NUMERIC(5,2) NULL,
  ADD COLUMN company_split_rate_snapshot NUMERIC(5,2) NULL,
  ADD COLUMN sales_commission_snapshot NUMERIC(15,2) NULL,
  ADD COLUMN supervisor_commission_snapshot NUMERIC(15,2) NULL,
  ADD COLUMN company_commission_snapshot NUMERIC(15,2) NULL,
  ADD COLUMN commission_received_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN commission_supervisor_id UUID NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN developer_commission_status TEXT GENERATED ALWAYS AS (
    CASE WHEN commission_total_snapshot IS NULL THEN NULL
      WHEN commission_total_snapshot = 0 THEN 'TIDAK ADA KOMISI'
      WHEN commission_received_amount = 0 THEN 'BELUM DITERIMA'
      WHEN commission_received_amount < commission_total_snapshot THEN 'DITERIMA SEBAGIAN'
      ELSE 'SUDAH DITERIMA' END
  ) STORED,
  ADD CONSTRAINT chk_deals_commission_received CHECK (commission_received_amount >= 0 AND (commission_total_snapshot IS NULL OR commission_received_amount <= commission_total_snapshot));

CREATE TABLE public.finance_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  sales_split_rate NUMERIC(5,2) NOT NULL DEFAULT 70,
  supervisor_split_rate NUMERIC(5,2) NOT NULL DEFAULT 15,
  sales_base_salary NUMERIC(15,2) NOT NULL DEFAULT 2000000,
  supervisor_base_salary NUMERIC(15,2) NOT NULL DEFAULT 5000000,
  updated_by UUID NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_finance_split_rates CHECK (sales_split_rate BETWEEN 0 AND 100 AND supervisor_split_rate BETWEEN 0 AND 100 AND sales_split_rate + supervisor_split_rate <= 100),
  CONSTRAINT chk_finance_salaries CHECK (sales_base_salary >= 0 AND supervisor_base_salary >= 0)
);
INSERT INTO public.finance_settings (id) VALUES (TRUE);

CREATE TABLE public.developer_commission_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_developer_commission_receipts_deal ON public.developer_commission_receipts(deal_id, created_at);

ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_commission_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_finance_settings_admin ON public.finance_settings
  FOR ALL TO authenticated USING (app_security.get_current_user_role() = 'ADMIN')
  WITH CHECK (app_security.get_current_user_role() = 'ADMIN');
CREATE POLICY pol_commission_receipts_select ON public.developer_commission_receipts
  FOR SELECT TO authenticated USING (
    app_security.get_current_user_role() = 'ADMIN'
    OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND (
      (app_security.get_current_user_role() = 'SUPERVISOR' AND d.team_id = app_security.get_current_user_active_team_id())
      OR (app_security.get_current_user_role() = 'SALES' AND d.current_sales_id = auth.uid())
    ))
  );
CREATE POLICY pol_commission_receipts_insert_admin ON public.developer_commission_receipts
  FOR INSERT TO authenticated WITH CHECK (app_security.get_current_user_role() = 'ADMIN' AND recorded_by = auth.uid());
GRANT SELECT, INSERT ON public.developer_commission_receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.finance_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_deal_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC(5,2);
  v_sales NUMERIC(5,2);
  v_supervisor NUMERIC(5,2);
  v_supervisor_id UUID;
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
      SELECT tm.profile_id INTO v_supervisor_id
      FROM public.team_memberships tm
      WHERE tm.team_id = NEW.team_id AND tm.membership_role = 'TEAM_SUPERVISOR' AND tm.is_active
      LIMIT 1;
      v_total := round(NEW.final_deal_value * v_rate / 100, 2);
      NEW.commission_rate_snapshot := v_rate;
      NEW.commission_total_snapshot := v_total;
      NEW.sales_split_rate_snapshot := coalesce(v_sales,70);
      NEW.supervisor_split_rate_snapshot := coalesce(v_supervisor,15);
      NEW.company_split_rate_snapshot := 100 - coalesce(v_sales,70) - coalesce(v_supervisor,15);
      NEW.sales_commission_snapshot := round(v_total * coalesce(v_sales,70) / 100,2);
      NEW.supervisor_commission_snapshot := round(v_total * coalesce(v_supervisor,15) / 100,2);
      NEW.company_commission_snapshot := v_total - NEW.sales_commission_snapshot - NEW.supervisor_commission_snapshot;
      NEW.commission_supervisor_id := v_supervisor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_snapshot_deal_commission BEFORE INSERT OR UPDATE OF sales_outcome_status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_deal_commission();

CREATE OR REPLACE FUNCTION public.apply_developer_commission_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total NUMERIC(15,2); v_received NUMERIC(15,2);
BEGIN
  SELECT commission_total_snapshot, commission_received_amount INTO v_total, v_received
  FROM public.deals WHERE id = NEW.deal_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'Komisi Deal belum dikonfigurasi'; END IF;
  IF v_received + NEW.amount > v_total THEN RAISE EXCEPTION 'Penerimaan komisi melebihi total komisi'; END IF;
  UPDATE public.deals SET commission_received_amount = commission_received_amount + NEW.amount WHERE id = NEW.deal_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_developer_commission_receipt AFTER INSERT ON public.developer_commission_receipts
  FOR EACH ROW EXECUTE FUNCTION public.apply_developer_commission_receipt();

COMMIT;
