-- ============================================================================
-- FILE: supabase/migrations/20260301000200_identity_and_supporting_tables.sql
-- TUJUAN: Pembuatan tabel Domain A (Identity & Organization) dan Domain E (Supporting)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 1-3 & 29-32)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 01] profiles
-- Menyimpan profil staf internal satu perusahaan PT FIM-Property (1:1 dengan auth.users)
-- Catatan Keamanan: Kolom email dan phone bersifat sensitif dan dibatasi akses
-- bacanya melalui kebijakan RLS & View v_staff_directory pada File 03.
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    system_role public.system_role_enum NOT NULL DEFAULT 'SALES',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_profiles PRIMARY KEY (id),
    CONSTRAINT uq_profiles_email UNIQUE (email),
    CONSTRAINT fk_profiles_auth_user
        FOREIGN KEY (id) REFERENCES auth.users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_profiles_full_name CHECK (char_length(trim(full_name)) >= 2),
    CONSTRAINT chk_profiles_email CHECK (position('@' in email) > 1),
    CONSTRAINT chk_profiles_phone CHECK (char_length(trim(phone)) >= 8)
);

-- ----------------------------------------------------------------------------
-- [Tabel 02] teams
-- Menyimpan master data grup penjualan internal perusahaan (Tim Sales)
-- ----------------------------------------------------------------------------
CREATE TABLE public.teams (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_teams PRIMARY KEY (id),
    CONSTRAINT uq_teams_code UNIQUE (code),
    CONSTRAINT uq_teams_name UNIQUE (name),
    CONSTRAINT fk_teams_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_teams_code CHECK (char_length(trim(code)) >= 2),
    CONSTRAINT chk_teams_name CHECK (char_length(trim(name)) >= 2)
);

-- ----------------------------------------------------------------------------
-- [Tabel 03] team_memberships
-- Menyimpan keanggotaan aktif dan histori perpindahan tim untuk Supervisor & Sales
-- ----------------------------------------------------------------------------
CREATE TABLE public.team_memberships (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    profile_id UUID NOT NULL,
    membership_role public.team_member_role_enum NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ NULL,
    assigned_by UUID NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_team_memberships PRIMARY KEY (id),
    CONSTRAINT fk_team_memberships_team
        FOREIGN KEY (team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_team_memberships_profile
        FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_team_memberships_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_team_memberships_dates CHECK (
        (is_active = true AND left_at IS NULL)
        OR (is_active = false AND left_at IS NOT NULL AND left_at >= joined_at)
    )
);

-- CST-01: Satu tim maksimal memiliki tepat satu Supervisor aktif pada satu waktu
CREATE UNIQUE INDEX uq_one_active_supervisor_per_team
    ON public.team_memberships(team_id)
    WHERE is_active = true AND membership_role = 'TEAM_SUPERVISOR';

-- CST-02: Satu staf maksimal memiliki satu keanggotaan tim aktif pada satu waktu
CREATE UNIQUE INDEX uq_one_active_team_per_profile
    ON public.team_memberships(profile_id)
    WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- [Tabel 29] reference_sequences
-- Menyimpan counter nomor urut bulanan untuk BK, PAY, KPR, DL, dan REF (OQ-07)
-- ----------------------------------------------------------------------------
CREATE TABLE public.reference_sequences (
    prefix VARCHAR(10) NOT NULL,
    year_month VARCHAR(6) NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_reference_sequences PRIMARY KEY (prefix, year_month),
    CONSTRAINT chk_reference_sequences_prefix CHECK (prefix IN ('BK', 'PAY', 'KPR', 'DL', 'REF')),
    CONSTRAINT chk_reference_sequences_ym CHECK (year_month ~ '^[0-9]{6}$'),
    CONSTRAINT chk_reference_sequences_val CHECK (last_value >= 0)
);

-- ----------------------------------------------------------------------------
-- [Tabel 30] notification_outbox
-- Antrean Transactional Outbox untuk pengiriman notifikasi yang fault-tolerant
-- ----------------------------------------------------------------------------
CREATE TABLE public.notification_outbox (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_type VARCHAR(60) NOT NULL,
    deduplication_key VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status public.outbox_status_enum NOT NULL DEFAULT 'PENDING',
    retry_count SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notification_outbox PRIMARY KEY (id),
    CONSTRAINT uq_notification_outbox_dedup UNIQUE (deduplication_key),
    CONSTRAINT chk_notification_outbox_retry CHECK (retry_count >= 0 AND retry_count <= 5)
);

-- ----------------------------------------------------------------------------
-- [Tabel 31] notifications
-- Pusat notifikasi internal aplikasi (In-App Notification Center)
-- ----------------------------------------------------------------------------
CREATE TABLE public.notifications (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL,
    notification_type public.notification_type_enum NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    reference_type VARCHAR(40) NOT NULL,
    reference_id UUID NOT NULL,
    deduplication_key VARCHAR(160) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT fk_notifications_recipient
        FOREIGN KEY (recipient_user_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-12 (Refinement v1.1 #5): Mencegah notifikasi ganda per penerima
    CONSTRAINT uq_notifications_recipient_dedup UNIQUE (recipient_user_id, deduplication_key),
    CONSTRAINT chk_notifications_ref_type CHECK (
        reference_type IN ('LEAD', 'UNIT', 'BOOKING', 'PAYMENT', 'KPR', 'PROMO', 'DEAL', 'FOLLOW_UP', 'SITE_VISIT')
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 32] audit_logs
-- Rekam jejak audit sistem yang bersifat Append-Only (Modul U)
-- ----------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    actor_user_id UUID NULL,
    actor_role VARCHAR(30) NOT NULL,
    action_type VARCHAR(60) NOT NULL,
    entity_table VARCHAR(60) NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB NULL,
    new_values JSONB NULL,
    reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    CONSTRAINT fk_audit_logs_actor
        FOREIGN KEY (actor_user_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

COMMIT;
