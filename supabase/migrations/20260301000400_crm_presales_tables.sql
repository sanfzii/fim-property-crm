-- ============================================================================
-- FILE: supabase/migrations/20260301000400_crm_presales_tables.sql
-- TUJUAN: Pembuatan tabel Domain C (CRM & Pre-Sales, kecuali follow_up_tasks)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 10-14, 16)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 10] leads
-- Pusat database calon pembeli beserta atribut kualifikasi, skor aturan bisnis
-- (OQ-04, non-ML), temperatur & pipeline
-- ----------------------------------------------------------------------------
CREATE TABLE public.leads (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150) NULL,
    occupation VARCHAR(100) NULL,
    lead_source public.lead_source_enum NOT NULL,
    assigned_sales_id UUID NOT NULL,
    team_id UUID NOT NULL,
    budget_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    preferred_city VARCHAR(100) NULL,
    preferred_project_id UUID NULL,
    preferred_property_type_id UUID NULL,
    preferred_payment_method public.payment_method_enum NULL,
    purchase_timeline public.purchase_timeline_enum NOT NULL DEFAULT 'UNSPECIFIED',
    payment_readiness public.payment_readiness_enum NOT NULL DEFAULT 'UNDECIDED',
    prospect_score SMALLINT NOT NULL DEFAULT 0,
    lead_temperature public.lead_temperature_enum NOT NULL DEFAULT 'COLD',
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    pipeline_stage public.pipeline_stage_enum NOT NULL DEFAULT 'NEW',
    lost_reason VARCHAR(150) NULL,
    created_by UUID NOT NULL,
    last_interaction_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_leads PRIMARY KEY (id),
    CONSTRAINT uq_leads_phone UNIQUE (phone),
    CONSTRAINT fk_leads_assigned_sales
        FOREIGN KEY (assigned_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_preferred_project
        FOREIGN KEY (preferred_project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_preferred_type_project
        FOREIGN KEY (preferred_property_type_id, preferred_project_id)
        REFERENCES public.property_types(id, project_id) MATCH SIMPLE
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leads_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_leads_budget CHECK (budget_amount >= 0),
    -- CST-07: Membatasi skor pada 0-100 dan menjaga keselarasan kategori Cold/Warm/Hot (OQ-04)
    CONSTRAINT chk_leads_score_and_temperature CHECK (
        prospect_score BETWEEN 0 AND 100
        AND (
            (lead_temperature = 'COLD' AND prospect_score BETWEEN 0 AND 44)
            OR (lead_temperature = 'WARM' AND prospect_score BETWEEN 45 AND 74)
            OR (lead_temperature = 'HOT' AND prospect_score BETWEEN 75 AND 100)
        )
    ),
    CONSTRAINT chk_leads_closed_lost_reason CHECK (
        pipeline_stage <> 'CLOSED_LOST'
        OR (lost_reason IS NOT NULL AND char_length(trim(lost_reason)) >= 3)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 11] lead_score_histories
-- Riwayat audit skor prospek berbasis aturan bisnis deterministik (OQ-04, bukan ML)
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_score_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    old_score SMALLINT NOT NULL,
    new_score SMALLINT NOT NULL,
    old_temperature public.lead_temperature_enum NOT NULL,
    new_temperature public.lead_temperature_enum NOT NULL,
    score_breakdown JSONB NOT NULL,
    trigger_source VARCHAR(50) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_score_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_score_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_score_histories_bounds CHECK (
        old_score BETWEEN 0 AND 100 AND new_score BETWEEN 0 AND 100
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 12] lead_pipeline_histories
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_pipeline_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    from_stage public.pipeline_stage_enum NULL,
    to_stage public.pipeline_stage_enum NOT NULL,
    notes TEXT NULL,
    lost_reason VARCHAR(150) NULL,
    changed_by UUID NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_pipeline_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_pipeline_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_pipeline_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- [Tabel 13] lead_assignment_histories
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_assignment_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    from_sales_id UUID NULL,
    to_sales_id UUID NOT NULL,
    from_team_id UUID NULL,
    to_team_id UUID NOT NULL,
    reason TEXT NOT NULL,
    assigned_by UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_assignment_histories PRIMARY KEY (id),
    CONSTRAINT fk_lead_assignment_histories_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_from_sales
        FOREIGN KEY (from_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_to_sales
        FOREIGN KEY (to_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_from_team
        FOREIGN KEY (from_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_to_team
        FOREIGN KEY (to_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_assignment_histories_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_assignment_histories_reason CHECK (
        char_length(trim(reason)) >= 3
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 14] lead_activities
-- Catatan komunikasi historis yang tidak boleh dihapus saat Lead pindah Sales
-- ----------------------------------------------------------------------------
CREATE TABLE public.lead_activities (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    sales_id UUID NOT NULL,
    channel public.activity_channel_enum NOT NULL,
    interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    summary TEXT NOT NULL,
    customer_response public.interaction_response_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_lead_activities PRIMARY KEY (id),
    CONSTRAINT fk_lead_activities_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_lead_activities_sales
        FOREIGN KEY (sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_lead_activities_summary CHECK (
        char_length(trim(summary)) >= 5
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 16] site_visits
-- ----------------------------------------------------------------------------
CREATE TABLE public.site_visits (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    sales_id UUID NOT NULL,
    project_id UUID NOT NULL,
    unit_id UUID NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    preparation_notes TEXT NULL,
    status public.site_visit_status_enum NOT NULL DEFAULT 'SCHEDULED',
    customer_interest_outcome public.site_visit_outcome_enum NULL,
    evaluation_notes TEXT NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_site_visits PRIMARY KEY (id),
    CONSTRAINT fk_site_visits_lead
        FOREIGN KEY (lead_id) REFERENCES public.leads(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_sales
        FOREIGN KEY (sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_site_visits_unit
        FOREIGN KEY (unit_id) REFERENCES public.units(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_site_visits_completion CHECK (
        status <> 'COMPLETED'
        OR (
            customer_interest_outcome IS NOT NULL
            AND evaluation_notes IS NOT NULL
            AND completed_at IS NOT NULL
        )
    )
);

COMMIT;
