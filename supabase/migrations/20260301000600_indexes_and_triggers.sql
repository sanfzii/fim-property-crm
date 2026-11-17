-- ============================================================================
-- FILE: supabase/migrations/20260301000600_indexes_and_triggers.sql
-- TUJUAN: Pembuatan seluruh Performance Indexes dan Trigger updated_at
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 + Revisi KPR v1.2
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PERFORMANCE INDEXES (37 INDEKS TERARAH DI DOMAIN A s/d E)
-- ============================================================================

-- Domain A: Identity & Organization (2 Indeks)
CREATE INDEX idx_profiles_system_role_active
    ON public.profiles(system_role, is_active);

CREATE INDEX idx_team_memberships_lookup
    ON public.team_memberships(profile_id, team_id, is_active);

-- Domain B: Property Catalog, Pricing & Promotions (6 Indeks)
CREATE INDEX idx_projects_developer_status
    ON public.property_projects(developer_id, status);

CREATE INDEX idx_projects_city
    ON public.property_projects(city);

CREATE INDEX idx_property_types_project
    ON public.property_types(project_id, is_active);

CREATE INDEX idx_units_catalog_lookup
    ON public.units(project_id, property_type_id, status, catalog_price);

CREATE INDEX idx_unit_price_histories_unit
    ON public.unit_price_histories(unit_id, changed_at DESC);

CREATE INDEX idx_promotions_project_dates
    ON public.promotions(project_id, is_active, start_date, end_date);

-- Domain C: CRM & Pre-Sales (12 Indeks)
CREATE INDEX idx_leads_sales_filter
    ON public.leads(assigned_sales_id, pipeline_stage, lead_temperature);

CREATE INDEX idx_leads_team_filter
    ON public.leads(team_id, pipeline_stage, lead_temperature);

CREATE INDEX idx_leads_preferred_project
    ON public.leads(preferred_project_id, pipeline_stage);

CREATE INDEX idx_leads_search_name_phone
    ON public.leads(full_name, phone);

CREATE INDEX idx_lead_score_histories_lead
    ON public.lead_score_histories(lead_id, calculated_at DESC);

CREATE INDEX idx_lead_pipeline_histories_lead
    ON public.lead_pipeline_histories(lead_id, changed_at DESC);

CREATE INDEX idx_lead_assignment_histories_lead
    ON public.lead_assignment_histories(lead_id, assigned_at DESC);

CREATE INDEX idx_lead_activities_lead_time
    ON public.lead_activities(lead_id, interaction_at DESC);

CREATE INDEX idx_followup_sales_status_due
    ON public.follow_up_tasks(assigned_sales_id, status, due_at);

CREATE INDEX idx_followup_kpr_app_status
    ON public.follow_up_tasks(related_kpr_application_id, status, due_at)
    WHERE related_kpr_application_id IS NOT NULL;

CREATE INDEX idx_site_visits_lead
    ON public.site_visits(lead_id, scheduled_at DESC);

CREATE INDEX idx_site_visits_sales_sched
    ON public.site_visits(sales_id, status, scheduled_at);

-- Domain D: Transaction, Finance, KPR & Deal (13 Indeks)
CREATE INDEX idx_bookings_pending_expiry
    ON public.bookings(expires_at)
    WHERE status = 'PENDING_FEE';

CREATE INDEX idx_bookings_team_sales
    ON public.bookings(team_id, current_sales_id, status);

CREATE INDEX idx_schedules_unpaid_due
    ON public.payment_schedules(due_date, status)
    WHERE status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE');

CREATE INDEX idx_payment_schedules_booking
    ON public.payment_schedules(booking_id, installment_number);

CREATE INDEX idx_payments_pending_sla
    ON public.payment_records(verification_sla_due_at, submitted_at)
    WHERE verification_status = 'PENDING_VERIFICATION';

CREATE INDEX idx_refund_transactions_booking
    ON public.refund_transactions(booking_id, status);

CREATE INDEX idx_kpr_team_stage
    ON public.kpr_applications(team_id, application_status, current_stage, disbursement_status);

CREATE INDEX idx_kpr_akad_sched
    ON public.kpr_applications(akad_scheduled_at)
    WHERE current_stage = 'AKAD_SCHEDULED' AND application_status = 'APPROVED';

CREATE INDEX idx_kpr_documents_app_status
    ON public.kpr_documents(kpr_application_id, status);

CREATE INDEX idx_kpr_stage_histories_app
    ON public.kpr_stage_histories(kpr_application_id, changed_at DESC);

CREATE INDEX idx_kpr_disbursements_app
    ON public.kpr_disbursements(kpr_application_id, sequence_number);

CREATE INDEX idx_deals_reporting
    ON public.deals(team_id, current_sales_id, sales_outcome_status, contract_status, payment_settlement_status, sales_closed_won_at);

CREATE INDEX idx_deal_status_histories_deal
    ON public.deal_status_histories(deal_id, changed_at DESC);

-- Domain E: Outbox, Notifications & Audit (4 Indeks)
CREATE INDEX idx_notification_outbox_pending
    ON public.notification_outbox(status, next_retry_at)
    WHERE status IN ('PENDING', 'FAILED_RETRYABLE');

CREATE INDEX idx_notifications_recipient_unread
    ON public.notifications(recipient_user_id, is_read, created_at DESC);

CREATE INDEX idx_audit_entity_time
    ON public.audit_logs(entity_table, entity_id, created_at DESC);

CREATE INDEX idx_audit_actor_time
    ON public.audit_logs(actor_user_id, action_type, created_at DESC);

-- ============================================================================
-- 2. TRIGGER OTOMATIS updated_at (17 TABEL YANG MEMILIKI KOLOM updated_at)
-- ============================================================================

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_reference_sequences_updated_at
    BEFORE UPDATE ON public.reference_sequences
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_developers_updated_at
    BEFORE UPDATE ON public.developers
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_property_projects_updated_at
    BEFORE UPDATE ON public.property_projects
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_property_types_updated_at
    BEFORE UPDATE ON public.property_types
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_units_updated_at
    BEFORE UPDATE ON public.units
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_promotions_updated_at
    BEFORE UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_site_visits_updated_at
    BEFORE UPDATE ON public.site_visits
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_payment_schedules_updated_at
    BEFORE UPDATE ON public.payment_schedules
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_follow_up_tasks_updated_at
    BEFORE UPDATE ON public.follow_up_tasks
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_refund_transactions_updated_at
    BEFORE UPDATE ON public.refund_transactions
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_kpr_applications_updated_at
    BEFORE UPDATE ON public.kpr_applications
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_kpr_documents_updated_at
    BEFORE UPDATE ON public.kpr_documents
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER trg_deals_updated_at
    BEFORE UPDATE ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

COMMIT;
