-- ==============================================================================
-- School Cart Manager: Comprehensive Up-to-Date Database Schema
-- Generated directly from live Supabase instance (Production)
-- Architecture: Zero-Plaintext ID Privacy (id_hash + id_last4)
-- Date: 2026-10-18
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. TABLES & COLUMNS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.allowed_admins (
    email                    text NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carts (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    name                     text NOT NULL,
    location                 text,
    total_devices            integer DEFAULT 0,
    notes                    text,
    created_at               TIMESTAMPTZ DEFAULT now(),
    display_name             text,
    deleted_at               TIMESTAMPTZ,
    kiosk_code               text,
    allow_manual_entry       boolean DEFAULT true NOT NULL,
    enable_charge_tracking   boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS public.students (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    name                     text NOT NULL,
    class_name               text,
    grade                    integer,
    created_at               TIMESTAMPTZ DEFAULT now(),
    charge_strikes           integer DEFAULT 0 NOT NULL,
    last_charged_at          TIMESTAMPTZ,
    is_active                boolean DEFAULT true NOT NULL,
    deleted_at               TIMESTAMPTZ,
    id_hash                  VARCHAR NOT NULL,
    id_last4                 VARCHAR
);

CREATE TABLE IF NOT EXISTS public.teachers (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    name                     text NOT NULL,
    email                    text,
    is_active                boolean DEFAULT true NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    id_hash                  VARCHAR NOT NULL,
    id_last4                 VARCHAR
);

CREATE TABLE IF NOT EXISTS public.devices (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id                  uuid,
    device_number            integer NOT NULL,
    asset_tag                text,
    mac_address              text,
    hostname                 text,
    last_seen                TIMESTAMPTZ,
    battery_level            integer,
    status                   text DEFAULT 'locked'::text,
    created_at               TIMESTAMPTZ DEFAULT now(),
    is_charging              boolean,
    last_battery_level       smallint,
    last_battery_recorded    TIMESTAMPTZ,
    deleted_at               TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.device_loans (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id                uuid,
    student_id               uuid,
    checkout_at              TIMESTAMPTZ DEFAULT now(),
    checkout_method          text DEFAULT 'qr_scan'::text,
    digital_login_at         TIMESTAMPTZ,
    digital_logout_at        TIMESTAMPTZ,
    checkin_at               TIMESTAMPTZ,
    status                   text DEFAULT 'active'::text,
    return_method            text,
    notes                    text,
    created_at               TIMESTAMPTZ DEFAULT now(),
    lesson_id                uuid,
    teacher_id               uuid
);

CREATE TABLE IF NOT EXISTS public.lessons (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id               uuid,
    lesson_code              text NOT NULL,
    subject                  text,
    duration_minutes         integer NOT NULL,
    start_time               TIMESTAMPTZ DEFAULT now() NOT NULL,
    end_time                 TIMESTAMPTZ NOT NULL,
    status                   text DEFAULT 'active'::text NOT NULL,
    is_locked                boolean DEFAULT false NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.lesson_participants (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id                uuid NOT NULL,
    loan_id                  uuid,
    device_id                uuid NOT NULL,
    student_id               uuid NOT NULL,
    joined_at                TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.student_groups (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    name                     text NOT NULL,
    description              text,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    group_number             text,
    teacher_id               uuid,
    subject                  text,
    class_name               text,
    created_by_teacher_id    uuid
);

CREATE TABLE IF NOT EXISTS public.student_group_members (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id                 uuid NOT NULL,
    student_id               uuid NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.lesson_pre_assignments (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id                uuid NOT NULL,
    student_id               uuid NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_log (
    id                       uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id                uuid,
    loan_id                  uuid,
    source                   text,
    event_type               text,
    payload                  jsonb,
    created_at               TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 2. CONSTRAINTS (PK, UNIQUE, FOREIGN KEY, CHECK)
-- ==============================================================================

-- allowed_admins: PRIMARY KEY allowed_admins_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowed_admins_pkey') THEN
        ALTER TABLE public.allowed_admins ADD CONSTRAINT allowed_admins_pkey PRIMARY KEY (email);
    END IF;
END $$;

-- carts: PRIMARY KEY carts_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_pkey') THEN
        ALTER TABLE public.carts ADD CONSTRAINT carts_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- device_loans: CHECK device_loans_checkout_method_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_checkout_method_check') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_checkout_method_check CHECK ((checkout_method = ANY (ARRAY['qr_scan'::text, 'manual_number'::text])));
    END IF;
END $$;

-- device_loans: CHECK device_loans_return_method_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_return_method_check') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_return_method_check CHECK ((return_method = ANY (ARRAY['cart_station'::text, 'admin'::text, 'force_close'::text])));
    END IF;
END $$;

-- device_loans: CHECK device_loans_status_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_status_check') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'returned'::text, 'force_closed'::text])));
    END IF;
END $$;

-- device_loans: FOREIGN KEY device_loans_teacher_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_teacher_id_fkey') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- device_loans: FOREIGN KEY device_loans_student_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_student_id_fkey') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
    END IF;
END $$;

-- device_loans: FOREIGN KEY device_loans_lesson_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_lesson_id_fkey') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
    END IF;
END $$;

-- device_loans: FOREIGN KEY device_loans_device_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_device_id_fkey') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id);
    END IF;
END $$;

-- device_loans: PRIMARY KEY device_loans_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_loans_pkey') THEN
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- devices: CHECK devices_status_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_status_check') THEN
        ALTER TABLE public.devices ADD CONSTRAINT devices_status_check CHECK ((status = ANY (ARRAY['locked'::text, 'active'::text, 'offline'::text])));
    END IF;
END $$;

-- devices: FOREIGN KEY devices_cart_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_cart_id_fkey') THEN
        ALTER TABLE public.devices ADD CONSTRAINT devices_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- devices: PRIMARY KEY devices_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_pkey') THEN
        ALTER TABLE public.devices ADD CONSTRAINT devices_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- devices: UNIQUE devices_mac_address_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_mac_address_key') THEN
        ALTER TABLE public.devices ADD CONSTRAINT devices_mac_address_key UNIQUE (mac_address);
    END IF;
END $$;

-- devices: UNIQUE devices_cart_id_device_number_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_cart_id_device_number_key') THEN
        ALTER TABLE public.devices ADD CONSTRAINT devices_cart_id_device_number_key UNIQUE (cart_id, device_number);
    END IF;
END $$;

-- event_log: CHECK event_log_source_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_log_source_check') THEN
        ALTER TABLE public.event_log ADD CONSTRAINT event_log_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'cart_station'::text, 'admin'::text, 'system'::text])));
    END IF;
END $$;

-- event_log: FOREIGN KEY event_log_device_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_log_device_id_fkey') THEN
        ALTER TABLE public.event_log ADD CONSTRAINT event_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id);
    END IF;
END $$;

-- event_log: FOREIGN KEY event_log_loan_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_log_loan_id_fkey') THEN
        ALTER TABLE public.event_log ADD CONSTRAINT event_log_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES device_loans(id);
    END IF;
END $$;

-- event_log: PRIMARY KEY event_log_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_log_pkey') THEN
        ALTER TABLE public.event_log ADD CONSTRAINT event_log_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- lesson_participants: FOREIGN KEY lesson_participants_lesson_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_lesson_id_fkey') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
    END IF;
END $$;

-- lesson_participants: FOREIGN KEY lesson_participants_student_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_student_id_fkey') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
    END IF;
END $$;

-- lesson_participants: FOREIGN KEY lesson_participants_loan_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_loan_id_fkey') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES device_loans(id) ON DELETE SET NULL;
    END IF;
END $$;

-- lesson_participants: FOREIGN KEY lesson_participants_device_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_device_id_fkey') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;
    END IF;
END $$;

-- lesson_participants: PRIMARY KEY lesson_participants_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_pkey') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- lesson_participants: UNIQUE lesson_participants_lesson_id_device_id_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_participants_lesson_id_device_id_key') THEN
        ALTER TABLE public.lesson_participants ADD CONSTRAINT lesson_participants_lesson_id_device_id_key UNIQUE (lesson_id, device_id);
    END IF;
END $$;

-- lesson_pre_assignments: FOREIGN KEY lesson_pre_assignments_student_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_pre_assignments_student_id_fkey') THEN
        ALTER TABLE public.lesson_pre_assignments ADD CONSTRAINT lesson_pre_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
    END IF;
END $$;

-- lesson_pre_assignments: FOREIGN KEY lesson_pre_assignments_lesson_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_pre_assignments_lesson_id_fkey') THEN
        ALTER TABLE public.lesson_pre_assignments ADD CONSTRAINT lesson_pre_assignments_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
    END IF;
END $$;

-- lesson_pre_assignments: PRIMARY KEY lesson_pre_assignments_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_pre_assignments_pkey') THEN
        ALTER TABLE public.lesson_pre_assignments ADD CONSTRAINT lesson_pre_assignments_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- lesson_pre_assignments: UNIQUE lesson_pre_assignments_lesson_id_student_id_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_pre_assignments_lesson_id_student_id_key') THEN
        ALTER TABLE public.lesson_pre_assignments ADD CONSTRAINT lesson_pre_assignments_lesson_id_student_id_key UNIQUE (lesson_id, student_id);
    END IF;
END $$;

-- lessons: CHECK lessons_status_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_status_check') THEN
        ALTER TABLE public.lessons ADD CONSTRAINT lessons_status_check CHECK ((status = ANY (ARRAY['active'::text, 'scheduled'::text, 'ended'::text, 'cancelled'::text])));
    END IF;
END $$;

-- lessons: FOREIGN KEY lessons_teacher_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_teacher_id_fkey') THEN
        ALTER TABLE public.lessons ADD CONSTRAINT lessons_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- lessons: PRIMARY KEY lessons_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_pkey') THEN
        ALTER TABLE public.lessons ADD CONSTRAINT lessons_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- student_group_members: FOREIGN KEY student_group_members_group_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_group_members_group_id_fkey') THEN
        ALTER TABLE public.student_group_members ADD CONSTRAINT student_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES student_groups(id) ON DELETE CASCADE;
    END IF;
END $$;

-- student_group_members: FOREIGN KEY student_group_members_student_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_group_members_student_id_fkey') THEN
        ALTER TABLE public.student_group_members ADD CONSTRAINT student_group_members_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
    END IF;
END $$;

-- student_group_members: PRIMARY KEY student_group_members_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_group_members_pkey') THEN
        ALTER TABLE public.student_group_members ADD CONSTRAINT student_group_members_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- student_group_members: UNIQUE student_group_members_group_id_student_id_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_group_members_group_id_student_id_key') THEN
        ALTER TABLE public.student_group_members ADD CONSTRAINT student_group_members_group_id_student_id_key UNIQUE (group_id, student_id);
    END IF;
END $$;

-- student_groups: FOREIGN KEY student_groups_created_by_teacher_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_created_by_teacher_id_fkey') THEN
        ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_created_by_teacher_id_fkey FOREIGN KEY (created_by_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- student_groups: FOREIGN KEY student_groups_teacher_id_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_teacher_id_fkey') THEN
        ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- student_groups: PRIMARY KEY student_groups_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_pkey') THEN
        ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- student_groups: UNIQUE student_groups_group_number_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_group_number_key') THEN
        ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_group_number_key UNIQUE (group_number);
    END IF;
END $$;

-- student_groups: UNIQUE student_groups_name_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_groups_name_key') THEN
        ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_name_key UNIQUE (name);
    END IF;
END $$;

-- students: PRIMARY KEY students_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_pkey') THEN
        ALTER TABLE public.students ADD CONSTRAINT students_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- students: UNIQUE students_id_hash_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_id_hash_key') THEN
        ALTER TABLE public.students ADD CONSTRAINT students_id_hash_key UNIQUE (id_hash);
    END IF;
END $$;

-- teachers: PRIMARY KEY teachers_pkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_pkey') THEN
        ALTER TABLE public.teachers ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- teachers: UNIQUE teachers_id_hash_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_id_hash_key') THEN
        ALTER TABLE public.teachers ADD CONSTRAINT teachers_id_hash_key UNIQUE (id_hash);
    END IF;
END $$;

-- ==============================================================================
-- 3. INDEXES
-- ==============================================================================

CREATE INDEX idx_device_loans_teacher_id ON public.device_loans USING btree (teacher_id);
CREATE INDEX idx_device_loans_teacher_status ON public.device_loans USING btree (teacher_id, status);
CREATE INDEX idx_loans_device_status ON public.device_loans USING btree (device_id, status);
CREATE INDEX idx_loans_student_status ON public.device_loans USING btree (student_id, status);
CREATE UNIQUE INDEX idx_unique_active_device_loan ON public.device_loans USING btree (device_id) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX idx_unique_active_student_loan ON public.device_loans USING btree (student_id) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX devices_cart_id_device_number_key ON public.devices USING btree (cart_id, device_number);
CREATE UNIQUE INDEX devices_mac_address_key ON public.devices USING btree (mac_address);
CREATE INDEX idx_devices_cart ON public.devices USING btree (cart_id);
CREATE INDEX idx_event_log_created_at ON public.event_log USING btree (created_at);
CREATE INDEX idx_event_log_device ON public.event_log USING btree (device_id, created_at DESC);
CREATE UNIQUE INDEX lesson_participants_lesson_id_device_id_key ON public.lesson_participants USING btree (lesson_id, device_id);
CREATE INDEX idx_pre_assignments_lesson ON public.lesson_pre_assignments USING btree (lesson_id);
CREATE INDEX idx_pre_assignments_student ON public.lesson_pre_assignments USING btree (student_id);
CREATE UNIQUE INDEX lesson_pre_assignments_lesson_id_student_id_key ON public.lesson_pre_assignments USING btree (lesson_id, student_id);
CREATE INDEX idx_lessons_active ON public.lessons USING btree (lesson_code, status) WHERE (status = 'active'::text);
CREATE INDEX idx_group_members_group ON public.student_group_members USING btree (group_id);
CREATE INDEX idx_group_members_student ON public.student_group_members USING btree (student_id);
CREATE UNIQUE INDEX student_group_members_group_id_student_id_key ON public.student_group_members USING btree (group_id, student_id);
CREATE INDEX idx_student_groups_number ON public.student_groups USING btree (group_number);
CREATE UNIQUE INDEX student_groups_group_number_key ON public.student_groups USING btree (group_number);
CREATE UNIQUE INDEX student_groups_name_key ON public.student_groups USING btree (name);
CREATE UNIQUE INDEX idx_students_id_hash ON public.students USING btree (id_hash);
CREATE INDEX idx_students_id_last4 ON public.students USING btree (id_last4);
CREATE INDEX idx_students_is_active ON public.students USING btree (is_active);
CREATE UNIQUE INDEX students_id_hash_key ON public.students USING btree (id_hash);
CREATE UNIQUE INDEX idx_teachers_id_hash ON public.teachers USING btree (id_hash);
CREATE INDEX idx_teachers_id_last4 ON public.teachers USING btree (id_last4);
CREATE UNIQUE INDEX teachers_id_hash_key ON public.teachers USING btree (id_hash);

-- ==============================================================================
-- 4. VIEWS
-- ==============================================================================

CREATE OR REPLACE VIEW public.active_lessons AS
SELECT l.id,
    l.lesson_code,
    l.subject,
    l.duration_minutes,
    l.start_time,
    l.end_time,
    l.is_locked,
    t.name AS teacher_name,
    (EXTRACT(epoch FROM (l.end_time - now())) / (60)::numeric) AS minutes_remaining,
    COUNT(CASE WHEN d.last_seen > (NOW() - INTERVAL '2 minutes') THEN 1 END) AS participant_count
   FROM lessons l
     LEFT JOIN teachers t ON t.id = l.teacher_id
     LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id
     LEFT JOIN devices d ON d.id = lp.device_id
  WHERE l.status = 'active' AND l.end_time > now()
  GROUP BY l.id, t.name;

CREATE OR REPLACE VIEW public.cart_status AS
SELECT c.id,
    c.name,
    c.display_name,
    c.location,
    (count(d.id))::integer AS total_devices,
    (count(d.id))::integer AS registered_devices,
    (count(dl.id))::integer AS active_loans,
    GREATEST(0, ((count(d.id))::integer - (count(dl.id))::integer)) AS available_devices,
    c.deleted_at,
    c.allow_manual_entry,
    c.enable_charge_tracking
   FROM ((carts c
     LEFT JOIN devices d ON (((c.id = d.cart_id) AND (d.deleted_at IS NULL))))
     LEFT JOIN device_loans dl ON (((dl.device_id = d.id) AND (dl.status = 'active'::text) AND (dl.checkin_at IS NULL))))
  WHERE (c.deleted_at IS NULL)
  GROUP BY c.id, c.name, c.display_name, c.location, c.deleted_at, c.allow_manual_entry, c.enable_charge_tracking;

CREATE OR REPLACE VIEW public.teacher_lessons AS
SELECT l.id,
    l.lesson_code,
    l.subject,
    l.duration_minutes,
    l.start_time,
    l.end_time,
    l.status,
    l.is_locked,
    l.teacher_id,
    t.name AS teacher_name,
    (EXTRACT(epoch FROM (l.start_time - now())) / (60)::numeric) AS minutes_until_start,
    (EXTRACT(epoch FROM (l.end_time - now())) / (60)::numeric) AS minutes_remaining,
    count(lp.id) AS participant_count
   FROM ((lessons l
     LEFT JOIN teachers t ON ((t.id = l.teacher_id)))
     LEFT JOIN lesson_participants lp ON ((lp.lesson_id = l.id)))
  WHERE ((l.status = ANY (ARRAY['active'::text, 'scheduled'::text])) AND (l.end_time > now()))
  GROUP BY l.id, t.name;

CREATE OR REPLACE VIEW public.unreturned_loans AS
SELECT dl.id AS loan_id,
    COALESCE(s.name, t.name) AS student_name,
    COALESCE(s.id_last4, t.id_last4) AS id_last4,
    COALESCE(s.class_name, 'מורה'::text) AS class_name,
    d.device_number,
    d.id AS device_id,
    c.name AS cart_name,
    c.id AS cart_id,
    dl.checkout_at,
    dl.checkout_method,
    dl.digital_login_at,
    (EXTRACT(epoch FROM (now() - dl.checkout_at)) / (60)::numeric) AS minutes_out
   FROM ((((device_loans dl
     LEFT JOIN students s ON ((s.id = dl.student_id)))
     LEFT JOIN teachers t ON ((t.id = dl.teacher_id)))
     JOIN devices d ON ((d.id = dl.device_id)))
     JOIN carts c ON ((c.id = d.cart_id)))
  WHERE ((dl.checkin_at IS NULL) AND (dl.status = 'active'::text) AND (d.deleted_at IS NULL) AND (c.deleted_at IS NULL));

-- ==============================================================================
-- 5. FUNCTIONS & STORED PROCEDURES (RPCs)
-- ==============================================================================

-- RPC: create_cart_securely
CREATE OR REPLACE FUNCTION public.create_cart_securely(p_name text, p_admin_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_cart_id UUID;
BEGIN
    -- אימות קוד מנהל (תומך באנגלית וגם במקלדת עברית בטעות)
    IF p_admin_code != 'admin2024' AND p_admin_code != 'שגצםמ2024' THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin passcode';
    END IF;

    -- הכנסת העגלה החדשה ומשיכת ה-UUID שלה
    INSERT INTO public.carts (name)
    VALUES (p_name)
    RETURNING id INTO v_cart_id;

    RETURN v_cart_id;
END;
$function$;

-- RPC: disconnect_student_from_lesson
CREATE OR REPLACE FUNCTION public.disconnect_student_from_lesson(p_loan_id uuid, p_student_id uuid, p_lesson_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- הסרת התלמיד מטבלת משתתפי השיעור
    DELETE FROM public.lesson_participants
    WHERE student_id = p_student_id
      AND (p_lesson_id IS NULL OR lesson_id = p_lesson_id);

    -- איפוס מזהה השיעור בהשאלה הפעילה
    UPDATE public.device_loans
    SET lesson_id = NULL
    WHERE id = p_loan_id
      AND student_id = p_student_id;

    RETURN true;
END;
$function$;

-- RPC: generate_lesson_code
CREATE OR REPLACE FUNCTION public.generate_lesson_code()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    code    TEXT;
    taken   BOOLEAN;
BEGIN
    -- סגירה אוטומטית של שיעורים שזמנם עבר
    UPDATE public.lessons
    SET status = 'ended'
    WHERE status = 'active' AND end_time <= NOW();

    LOOP
        code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

        SELECT EXISTS (
            SELECT 1 FROM public.lessons
            WHERE lesson_code = code AND status = 'active' AND end_time > NOW()
        ) INTO taken;

        EXIT WHEN NOT taken;
    END LOOP;
    RETURN code;
END;
$function$;

-- RPC: get_id_last4
CREATE OR REPLACE FUNCTION public.get_id_last4(raw_id text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  cleaned text;
  padded text;
BEGIN
  IF raw_id IS NULL OR trim(raw_id) = '' THEN
    RETURN NULL;
  END IF;
  cleaned := regexp_replace(trim(raw_id), '\D', '', 'g');
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;
  padded := lpad(cleaned, 9, '0');
  RETURN right(padded, 4);
END;
$function$;

-- RPC: get_pre_assigned_active_lesson
CREATE OR REPLACE FUNCTION public.get_pre_assigned_active_lesson(p_student_id uuid)
 RETURNS TABLE(id uuid, lesson_code text, subject text, teacher_name text, end_time timestamp with time zone, server_now timestamp with time zone, is_locked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF p_student_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        l.id,
        l.lesson_code,
        COALESCE(l.subject, 'שיעור'),
        COALESCE(t.name, 'מורה'),
        l.end_time,
        NOW() as server_now,
        l.is_locked
    FROM public.lessons l
    JOIN public.lesson_pre_assignments lpa ON lpa.lesson_id = l.id
    LEFT JOIN public.teachers t ON t.id = l.teacher_id
    WHERE lpa.student_id = p_student_id
      AND l.status = 'active'
      AND l.end_time > NOW()
    ORDER BY l.created_at DESC;
END;
$function$;

-- RPC: get_server_time
CREATE OR REPLACE FUNCTION public.get_server_time()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NOW();
$function$;

-- RPC: get_teacher_student_list
CREATE OR REPLACE FUNCTION public.get_teacher_student_list(p_teacher_id text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, class_name text, id_last4 character varying)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT s.id, s.name, s.class_name, s.id_last4
    FROM public.students s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
      AND s.class_name NOT IN ('צוות', 'איש צוות', 'מורה')
    ORDER BY s.name;
$function$;

-- RPC: handle_auth_signup_restriction
CREATE OR REPLACE FUNCTION public.handle_auth_signup_restriction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    allowed_count INT;
BEGIN
    -- אישור אימייל וטלפון אוטומטי כדי לחסוך צורך באישור ידני ב-Dashboard
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());

    -- בדיקת כמות המנהלים הרשומים במערכת
    SELECT COUNT(*) FROM public.allowed_admins INTO allowed_count;

    -- אם אין אף מנהל מורשם, נאפשר את הרישום של המנהל הראשון ונוסיף אותו לרשימה
    IF allowed_count = 0 THEN
        INSERT INTO public.allowed_admins (email) VALUES (NEW.email);
    ELSE
        -- אם כבר קיים מנהל, נבדוק האם האימייל הנוכחי נמצא ברשימת המורשים
        IF NOT EXISTS (SELECT 1 FROM public.allowed_admins WHERE email = NEW.email) THEN
            RAISE EXCEPTION 'הרשמה חסומה. כתובת האימייל % אינה נמצאת ברשימת המנהלים המורשים.', NEW.email;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- RPC: handle_returned_laptop_disconnect
CREATE OR REPLACE FUNCTION public.handle_returned_laptop_disconnect()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

    -- If the device loan status changes to 'returned' (checked-in)

    IF NEW.status IN ('returned', 'force_closed') AND OLD.status = 'active' THEN

        -- Set digital_logout_at to checkin_at if not already set

        IF NEW.digital_logout_at IS NULL THEN

            NEW.digital_logout_at := NEW.checkin_at;

        END IF;

        

        -- Remove from lesson_participants for any active lesson

        DELETE FROM public.lesson_participants

        WHERE device_id = NEW.device_id

          AND lesson_id IN (SELECT id FROM public.lessons WHERE status = 'active');

    END IF;

    RETURN NEW;

END;

$function$;

-- RPC: hash_id
CREATE OR REPLACE FUNCTION public.hash_id(raw_id text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  cleaned text;
  padded text;
  pepper text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Z2dqb3Jma25hZ2VzZXFsd2F5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc0MTI0NywiZXhwIjoyMDk0MzE3MjQ3fQ.43Z_aaV1Gm4-ZtNo4qk4bmWAzCxVxcsBKRLvXmCrGSQ';
BEGIN
  IF raw_id IS NULL OR trim(raw_id) = '' THEN
    RETURN NULL;
  END IF;
  cleaned := regexp_replace(trim(raw_id), '\D', '', 'g');
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;
  padded := lpad(cleaned, 9, '0');
  RETURN encode(hmac(padded, pepper, 'sha256'), 'hex');
END;
$function$;

-- RPC: is_admin_approved
CREATE OR REPLACE FUNCTION public.is_admin_approved()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_email text;
  v_found boolean;
BEGIN
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.allowed_admins
    WHERE lower(email) = v_email
  ) INTO v_found;

  RETURN v_found;
END;
$function$;

-- RPC: register_device_securely
CREATE OR REPLACE FUNCTION public.register_device_securely(p_asset_tag text, p_cart_id uuid, p_device_number integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_device_id UUID;
BEGIN
    -- חיפוש האם המחשב כבר קיים לפי ה-Asset Tag (שם המחשב ברשת)
    SELECT id FROM public.devices WHERE asset_tag = p_asset_tag INTO v_device_id;
    
    IF v_device_id IS NOT NULL THEN
        -- עדכון מחשב קיים
        UPDATE public.devices
        SET cart_id = p_cart_id,
            device_number = p_device_number,
            status = 'locked',
            is_charging = true,
            battery_level = 100
        WHERE id = v_device_id;
    ELSE
        -- יצירת מחשב חדש לחלוטין
        INSERT INTO public.devices (asset_tag, cart_id, device_number, status, is_charging, battery_level)
        VALUES (p_asset_tag, p_cart_id, p_device_number, 'locked', true, 100);
    END IF;
    
    RETURN true;
END;
$function$;

-- RPC: secure_create_teacher_group
CREATE OR REPLACE FUNCTION public.secure_create_teacher_group(entered_teacher_id text, group_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    res_teacher_id UUID;
    new_group_id UUID;
    random_num TEXT;
    computed_hash TEXT;
BEGIN
    IF entered_teacher_id IS NULL OR trim(entered_teacher_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    IF length(trim(entered_teacher_id)) = 64 THEN
        computed_hash := lower(trim(entered_teacher_id));
    ELSE
        computed_hash := public.hash_id(entered_teacher_id);
    END IF;

    SELECT id FROM public.teachers 
    WHERE (id_hash = computed_hash OR (length(trim(entered_teacher_id)) = 36 AND id::text = trim(entered_teacher_id)))
      AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    LOOP
        random_num := 'G-' || floor(random() * 90000 + 10000)::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM student_groups WHERE group_number = random_num);
    END LOOP;

    INSERT INTO student_groups (name, teacher_id, created_by_teacher_id, group_number)
    VALUES (group_name, res_teacher_id, res_teacher_id, random_num)
    RETURNING id INTO new_group_id;

    RETURN jsonb_build_object('success', true, 'group_id', new_group_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'קבוצה בשם זה כבר קיימת בבית הספר. בחר שם אחר.');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- RPC: secure_delete_teacher_group
CREATE OR REPLACE FUNCTION public.secure_delete_teacher_group(entered_teacher_id text, target_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    res_teacher_id UUID;
    group_record RECORD;
    computed_hash TEXT;
BEGIN
    IF entered_teacher_id IS NULL OR trim(entered_teacher_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    IF length(trim(entered_teacher_id)) = 64 THEN
        computed_hash := lower(trim(entered_teacher_id));
    ELSE
        computed_hash := public.hash_id(entered_teacher_id);
    END IF;

    SELECT id FROM public.teachers 
    WHERE (id_hash = computed_hash OR (length(trim(entered_teacher_id)) = 36 AND id::text = trim(entered_teacher_id)))
      AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    SELECT teacher_id, created_by_teacher_id FROM student_groups 
    WHERE id = target_group_id INTO group_record;

    IF group_record.teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'הקבוצה לא נמצאה במערכת');
    END IF;

    IF group_record.teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה לנהל או למחוק קבוצה זו מכיוון שאינך מוגדר כמורה שלה כעת.');
    END IF;

    IF group_record.created_by_teacher_id IS NULL OR group_record.created_by_teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה למחוק קבוצה זו מכיוון שלא אתה יצרת אותה, אך באפשרותך לערוך את תלמידיה.');
    END IF;

    DELETE FROM student_groups WHERE id = target_group_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- RPC: secure_pre_assign_students
CREATE OR REPLACE FUNCTION public.secure_pre_assign_students(entered_teacher_id text, target_lesson_id uuid, student_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    is_valid_teacher BOOLEAN;
    computed_hash TEXT;
BEGIN
    IF entered_teacher_id IS NULL OR trim(entered_teacher_id) = '' THEN
        RAISE EXCEPTION 'Unauthorized: Invalid teacher credentials';
    END IF;

    IF length(trim(entered_teacher_id)) = 64 THEN
        computed_hash := lower(trim(entered_teacher_id));
    ELSE
        computed_hash := public.hash_id(entered_teacher_id);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.teachers
        WHERE (id_hash = computed_hash OR (length(trim(entered_teacher_id)) = 36 AND id::text = trim(entered_teacher_id)))
          AND is_active = true
    ) INTO is_valid_teacher;

    IF NOT is_valid_teacher THEN
        RAISE EXCEPTION 'Unauthorized: Invalid teacher credentials';
    END IF;

    DELETE FROM public.lesson_pre_assignments
    WHERE lesson_id = target_lesson_id;

    IF array_length(student_ids, 1) > 0 THEN
        INSERT INTO public.lesson_pre_assignments (lesson_id, student_id)
        SELECT target_lesson_id, unnest(student_ids);
    END IF;

    RETURN true;
END;
$function$;

-- RPC: secure_set_group_members
CREATE OR REPLACE FUNCTION public.secure_set_group_members(entered_teacher_id text, target_group_id uuid, student_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    res_teacher_id UUID;
    s_id UUID;
    computed_hash TEXT;
BEGIN
    IF entered_teacher_id IS NULL OR trim(entered_teacher_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל');
    END IF;

    IF length(trim(entered_teacher_id)) = 64 THEN
        computed_hash := lower(trim(entered_teacher_id));
    ELSE
        computed_hash := public.hash_id(entered_teacher_id);
    END IF;

    SELECT id FROM public.teachers 
    WHERE (id_hash = computed_hash OR (length(trim(entered_teacher_id)) = 36 AND id::text = trim(entered_teacher_id)))
      AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM student_groups WHERE id = target_group_id AND teacher_id = res_teacher_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'קבוצה זו אינה שייכת למורה הנוכחי או שלא נמצאה');
    END IF;

    DELETE FROM student_group_members WHERE group_id = target_group_id;

    FOREACH s_id IN ARRAY student_ids LOOP
        IF s_id IS NOT NULL THEN
            INSERT INTO student_group_members (group_id, student_id)
            VALUES (target_group_id, s_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- RPC: sync_cart_total_devices
CREATE OR REPLACE FUNCTION public.sync_cart_total_devices()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

BEGIN

  IF TG_OP = 'DELETE' THEN

    IF OLD.cart_id IS NOT NULL THEN

      UPDATE public.carts

      SET total_devices = (

        SELECT COUNT(*)::INT FROM public.devices WHERE cart_id = OLD.cart_id AND deleted_at IS NULL

      )

      WHERE id = OLD.cart_id;

    END IF;

    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN

    -- אם המחשב הועבר בין עגלות, נסנכרן גם את העגלה הקודמת

    IF OLD.cart_id IS DISTINCT FROM NEW.cart_id AND OLD.cart_id IS NOT NULL THEN

      UPDATE public.carts

      SET total_devices = (

        SELECT COUNT(*)::INT FROM public.devices WHERE cart_id = OLD.cart_id AND deleted_at IS NULL

      )

      WHERE id = OLD.cart_id;

    END IF;



    IF NEW.cart_id IS NOT NULL THEN

      UPDATE public.carts

      SET total_devices = (

        SELECT COUNT(*)::INT FROM public.devices WHERE cart_id = NEW.cart_id AND deleted_at IS NULL

      )

      WHERE id = NEW.cart_id;

    END IF;

    RETURN NEW;

  ELSE -- INSERT

    IF NEW.cart_id IS NOT NULL THEN

      UPDATE public.carts

      SET total_devices = (

        SELECT COUNT(*)::INT FROM public.devices WHERE cart_id = NEW.cart_id AND deleted_at IS NULL

      )

      WHERE id = NEW.cart_id;

    END IF;

    RETURN NEW;

  END IF;

END;

$function$;

-- RPC: sync_pre_assignment_to_active_loan
CREATE OR REPLACE FUNCTION public.sync_pre_assignment_to_active_loan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    active_loan RECORD;
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        -- חיפוש השאלה פעילה של התלמיד
        SELECT id, device_id, lesson_id INTO active_loan
        FROM public.device_loans
        WHERE student_id = NEW.student_id AND status = 'active' AND checkin_at IS NULL;

        -- אם קיימת השאלה פעילה ועדיין לא משויך לה שיעור (אפשרות 2: הגנה מפני דריסה)
        IF active_loan.id IS NOT NULL AND active_loan.lesson_id IS NULL THEN
            -- עדכון ההשאלה עם מזהה השיעור
            UPDATE public.device_loans
            SET lesson_id = NEW.lesson_id
            WHERE id = active_loan.id;

                        -- בוטל ה-INSERT האוטומטי המוקדם ל-lesson_participants.
            -- התלמיד ייכנס ל-lesson_participants רק כשיבחר בפועל להיכנס לשיעור.
        END IF;

    ELSIF (TG_OP = 'DELETE') THEN
        -- הסרת השיעור מההשאלה רק אם מדובר באותו שיעור שנמחק מהשיוך מראש
        UPDATE public.device_loans
        SET lesson_id = NULL
        WHERE student_id = OLD.student_id AND status = 'active' AND lesson_id = OLD.lesson_id;

        -- הסרת התלמיד מרשימת משתתפי השיעור
        DELETE FROM public.lesson_participants
        WHERE student_id = OLD.student_id AND lesson_id = OLD.lesson_id;
    END IF;
    
    RETURN NULL;
END;
$function$;

-- RPC: verify_kiosk_code
CREATE OR REPLACE FUNCTION public.verify_kiosk_code(p_cart_id uuid, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_db_code TEXT;
BEGIN
    SELECT kiosk_code FROM public.carts
    WHERE id = p_cart_id AND deleted_at IS NULL
    INTO v_db_code;

    -- החזרת true אם הקוד נכון, אחרת false
    RETURN (v_db_code IS NOT NULL AND v_db_code = p_code);
END;
$function$;

-- RPC: verify_teacher_id
CREATE OR REPLACE FUNCTION public.verify_teacher_id(entered_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  computed_hash text;
  teacher_record RECORD;
BEGIN
  IF entered_id IS NULL OR trim(entered_id) = '' THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  IF length(trim(entered_id)) = 64 THEN
    computed_hash := lower(trim(entered_id));
  ELSE
    computed_hash := public.hash_id(entered_id);
  END IF;

  SELECT id, name, is_active, id_last4, id_hash
  FROM public.teachers
  WHERE (id_hash = computed_hash OR (length(trim(entered_id)) = 36 AND id::text = trim(entered_id)))
    AND is_active = true
  LIMIT 1
  INTO teacher_record;

  IF teacher_record.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_valid', true,
      'teacher_id', teacher_record.id,
      'teacher_name', teacher_record.name,
      'id_last4', teacher_record.id_last4,
      'id_hash', teacher_record.id_hash,
      'national_id', '***' || teacher_record.id_last4
    );
  ELSE
    RETURN jsonb_build_object('is_valid', false);
  END IF;
END;
$function$;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.allowed_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_pre_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_admins_approved_only" ON public.allowed_admins;
CREATE POLICY "allowed_admins_approved_only" ON public.allowed_admins FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM allowed_admins a
  WHERE (lower(a.email) = lower((auth.jwt() ->> 'email'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM allowed_admins a
  WHERE (lower(a.email) = lower((auth.jwt() ->> 'email'::text))))));

DROP POLICY IF EXISTS "carts_admin" ON public.carts;
CREATE POLICY "carts_admin" ON public.carts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "carts_select" ON public.carts;
CREATE POLICY "carts_select" ON public.carts FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "device_loans_admin" ON public.device_loans;
CREATE POLICY "device_loans_admin" ON public.device_loans FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "device_loans_insert" ON public.device_loans;
CREATE POLICY "device_loans_insert" ON public.device_loans FOR INSERT TO anon  WITH CHECK (true);

DROP POLICY IF EXISTS "device_loans_select" ON public.device_loans;
CREATE POLICY "device_loans_select" ON public.device_loans FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "devices_admin" ON public.devices;
CREATE POLICY "devices_admin" ON public.devices FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "devices_select" ON public.devices;
CREATE POLICY "devices_select" ON public.devices FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "event_log_admin" ON public.event_log;
CREATE POLICY "event_log_admin" ON public.event_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "event_log_insert" ON public.event_log;
CREATE POLICY "event_log_insert" ON public.event_log FOR INSERT TO anon  WITH CHECK (true);

DROP POLICY IF EXISTS "event_log_select" ON public.event_log;
CREATE POLICY "event_log_select" ON public.event_log FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "lesson_participants_admin" ON public.lesson_participants;
CREATE POLICY "lesson_participants_admin" ON public.lesson_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lesson_participants_insert" ON public.lesson_participants;
CREATE POLICY "lesson_participants_insert" ON public.lesson_participants FOR INSERT TO anon  WITH CHECK (true);

DROP POLICY IF EXISTS "lesson_participants_select" ON public.lesson_participants;
CREATE POLICY "lesson_participants_select" ON public.lesson_participants FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "lesson_participants_update" ON public.lesson_participants;
CREATE POLICY "lesson_participants_update" ON public.lesson_participants FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lesson_pre_assignments_admin" ON public.lesson_pre_assignments;
CREATE POLICY "lesson_pre_assignments_admin" ON public.lesson_pre_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lesson_pre_assignments_select_anon" ON public.lesson_pre_assignments;
CREATE POLICY "lesson_pre_assignments_select_anon" ON public.lesson_pre_assignments FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "lessons_admin" ON public.lessons;
CREATE POLICY "lessons_admin" ON public.lessons FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lessons_insert" ON public.lessons;
CREATE POLICY "lessons_insert" ON public.lessons FOR INSERT TO anon  WITH CHECK (true);

DROP POLICY IF EXISTS "lessons_select" ON public.lessons;
CREATE POLICY "lessons_select" ON public.lessons FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "lessons_update" ON public.lessons;
CREATE POLICY "lessons_update" ON public.lessons FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_group_members_admin" ON public.student_group_members;
CREATE POLICY "student_group_members_admin" ON public.student_group_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_group_members_select_anon" ON public.student_group_members;
CREATE POLICY "student_group_members_select_anon" ON public.student_group_members FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "student_groups_admin" ON public.student_groups;
CREATE POLICY "student_groups_admin" ON public.student_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_groups_select_anon" ON public.student_groups;
CREATE POLICY "student_groups_select_anon" ON public.student_groups FOR SELECT TO anon USING (true) ;

DROP POLICY IF EXISTS "students_admin" ON public.students;
CREATE POLICY "students_admin" ON public.students FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "teachers_admin" ON public.teachers;
CREATE POLICY "teachers_admin" ON public.teachers FOR ALL TO authenticated USING (true) WITH CHECK (true);
