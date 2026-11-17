-- ============================================================================
-- FILE: supabase/migrations/20260301000300_property_catalog_tables.sql
-- TUJUAN: Pembuatan tabel Domain B (Property Catalog, Price History & Promotions)
-- REFERENSI: FIM-PROPERTY_PHASE_1B_DATABASE_ARCHITECTURE_v1.0 & v1.1 (Tabel 4-9)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- [Tabel 04] developers (Level 1 Hierarki Katalog Properti)
-- Catatan: Entitas mitra developer pada katalog produk, BUKAN tenant sistem CRM.
-- ----------------------------------------------------------------------------
CREATE TABLE public.developers (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(150) NOT NULL,
    address TEXT NOT NULL,
    pic_name VARCHAR(120) NOT NULL,
    pic_phone VARCHAR(30) NOT NULL,
    pic_email VARCHAR(150) NULL,
    policy_notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_developers PRIMARY KEY (id),
    CONSTRAINT uq_developers_code UNIQUE (code),
    CONSTRAINT uq_developers_name UNIQUE (name),
    CONSTRAINT fk_developers_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_developers_code CHECK (char_length(trim(code)) >= 2),
    CONSTRAINT chk_developers_name CHECK (char_length(trim(name)) >= 2)
);

-- ----------------------------------------------------------------------------
-- [Tabel 05] property_projects (Level 2 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.property_projects (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    developer_id UUID NOT NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    province VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    facilities TEXT NULL,
    status public.project_status_enum NOT NULL DEFAULT 'ACTIVE_SELLING',
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_property_projects PRIMARY KEY (id),
    CONSTRAINT uq_property_projects_code UNIQUE (code),
    CONSTRAINT uq_property_projects_dev_name UNIQUE (developer_id, name),
    CONSTRAINT fk_property_projects_developer
        FOREIGN KEY (developer_id) REFERENCES public.developers(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_property_projects_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- [Tabel 06] property_types (Level 3 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.property_types (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    standard_land_area NUMERIC(8,2) NOT NULL,
    standard_building_area NUMERIC(8,2) NOT NULL,
    bedrooms SMALLINT NOT NULL DEFAULT 2,
    bathrooms SMALLINT NOT NULL DEFAULT 1,
    electricity_watt INTEGER NOT NULL DEFAULT 1300,
    specifications TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_property_types PRIMARY KEY (id),
    CONSTRAINT uq_property_types_project_code UNIQUE (project_id, code),
    -- Constraint unik komposit untuk mendukung CST-04 (Refinement v1.1 #1 & #2)
    CONSTRAINT uq_property_types_id_project UNIQUE (id, project_id),
    CONSTRAINT fk_property_types_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_property_types_areas CHECK (
        standard_land_area > 0 AND standard_building_area > 0
    ),
    CONSTRAINT chk_property_types_rooms CHECK (
        bedrooms >= 0 AND bathrooms >= 0 AND electricity_watt > 0
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 07] units (Level 4 Hierarki Katalog Properti)
-- ----------------------------------------------------------------------------
CREATE TABLE public.units (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    property_type_id UUID NOT NULL,
    unit_code VARCHAR(30) NOT NULL,
    block_number VARCHAR(20) NOT NULL,
    land_area NUMERIC(8,2) NOT NULL,
    building_area NUMERIC(8,2) NOT NULL,
    catalog_price NUMERIC(15,2) NOT NULL,
    orientation VARCHAR(50) NULL,
    is_hook BOOLEAN NOT NULL DEFAULT false,
    status public.unit_status_enum NOT NULL DEFAULT 'AVAILABLE',
    current_holder_sales_id UUID NULL,
    current_holder_team_id UUID NULL,
    status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_units PRIMARY KEY (id),
    CONSTRAINT uq_units_project_unit_code UNIQUE (project_id, unit_code),
    CONSTRAINT fk_units_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-04 (Refinement v1.1 #1): Menjamin property_type_id berasal dari project_id yang sama
    CONSTRAINT fk_units_property_type_project
        FOREIGN KEY (property_type_id, project_id)
        REFERENCES public.property_types(id, project_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_units_holder_sales
        FOREIGN KEY (current_holder_sales_id) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_units_holder_team
        FOREIGN KEY (current_holder_team_id) REFERENCES public.teams(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_units_dimensions_price CHECK (
        land_area > 0 AND building_area > 0 AND catalog_price > 0
    ),
    -- Refinement v1.1 #7: Konsistensi atribut pemegang reservasi unit (OQ-05)
    CONSTRAINT chk_units_holder_consistency CHECK (
        (status = 'AVAILABLE' AND current_holder_sales_id IS NULL AND current_holder_team_id IS NULL)
        OR (status IN ('HELD', 'BOOKED', 'SOLD') AND current_holder_sales_id IS NOT NULL AND current_holder_team_id IS NOT NULL)
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 08] unit_price_histories
-- Mencatat seluruh riwayat perubahan harga katalog unit secara permanen (BR-03)
-- ----------------------------------------------------------------------------
CREATE TABLE public.unit_price_histories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL,
    old_price NUMERIC(15,2) NOT NULL,
    new_price NUMERIC(15,2) NOT NULL,
    reason TEXT NOT NULL,
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_unit_price_histories PRIMARY KEY (id),
    CONSTRAINT fk_unit_price_histories_unit
        FOREIGN KEY (unit_id) REFERENCES public.units(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_unit_price_histories_changed_by
        FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_unit_price_histories_values CHECK (
        old_price > 0 AND new_price > 0 AND old_price <> new_price
    ),
    CONSTRAINT chk_unit_price_histories_reason CHECK (
        char_length(trim(reason)) >= 10
    )
);

-- ----------------------------------------------------------------------------
-- [Tabel 09] promotions
-- Menyimpan program promosi penjualan pada proyek atau tipe properti tertentu
-- ----------------------------------------------------------------------------
CREATE TABLE public.promotions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    property_type_id UUID NULL,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    promo_type public.promo_type_enum NOT NULL,
    discount_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    bonus_description TEXT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_promotions PRIMARY KEY (id),
    CONSTRAINT uq_promotions_code UNIQUE (code),
    CONSTRAINT fk_promotions_project
        FOREIGN KEY (project_id) REFERENCES public.property_projects(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- CST-04 (Refinement v1.1 #2): Jika property_type_id diisi, wajib milik project_id yang sama
    CONSTRAINT fk_promotions_property_type_project
        FOREIGN KEY (property_type_id, project_id)
        REFERENCES public.property_types(id, project_id) MATCH SIMPLE
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_promotions_created_by
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_promotions_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_promotions_discount CHECK (
        (promo_type = 'PERCENTAGE_DISCOUNT' AND discount_value > 0 AND discount_value <= 100)
        OR (promo_type = 'NOMINAL_DISCOUNT' AND discount_value > 0)
        OR (promo_type = 'FREE_BENEFIT' AND discount_value = 0 AND bonus_description IS NOT NULL)
    )
);

COMMIT;
