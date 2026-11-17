BEGIN;

CREATE TABLE public.project_commission_rate_histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.property_projects(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  old_rate NUMERIC(5,2) NULL,
  new_rate NUMERIC(5,2) NULL,
  changed_by UUID NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_commission_history_rates CHECK (
    (old_rate IS NULL OR old_rate BETWEEN 0 AND 100)
    AND (new_rate IS NULL OR new_rate BETWEEN 0 AND 100)
    AND old_rate IS DISTINCT FROM new_rate
  )
);

CREATE INDEX idx_project_commission_rate_histories_project_time
  ON public.project_commission_rate_histories(project_id, changed_at DESC);
ALTER TABLE public.project_commission_rate_histories ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_project_commission_rate_histories_admin_select
  ON public.project_commission_rate_histories FOR SELECT TO authenticated
  USING (app_security.get_current_user_role() = 'ADMIN');
GRANT SELECT ON public.project_commission_rate_histories TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_project_commission_rate_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.developer_commission_rate IS DISTINCT FROM OLD.developer_commission_rate THEN
    INSERT INTO public.project_commission_rate_histories
      (project_id, old_rate, new_rate, changed_by)
    VALUES
      (NEW.id, OLD.developer_commission_rate, NEW.developer_commission_rate, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_project_commission_rate_change
  AFTER UPDATE OF developer_commission_rate ON public.property_projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_project_commission_rate_change();

COMMIT;
