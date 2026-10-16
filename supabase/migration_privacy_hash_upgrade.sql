-- Migration: Privacy Hash & Security Lockdown
-- Author: Antigravity Assistant
-- Date: 2026-10-16

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Cryptographic Pepper & Hash Helper Functions
CREATE OR REPLACE FUNCTION public.hash_id(raw_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_id_last4(raw_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
$$;

-- 2. Add id_hash and id_last4 columns
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS id_hash VARCHAR(64);
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS id_last4 VARCHAR(4);
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS id_hash VARCHAR(64);
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS id_last4 VARCHAR(4);

-- 3. Populate existing rows
UPDATE public.students
SET id_hash = public.hash_id(national_id),
    id_last4 = public.get_id_last4(national_id)
WHERE national_id IS NOT NULL AND (id_hash IS NULL OR id_last4 IS NULL);

UPDATE public.teachers
SET id_hash = public.hash_id(national_id),
    id_last4 = public.get_id_last4(national_id)
WHERE national_id IS NOT NULL AND (id_hash IS NULL OR id_last4 IS NULL);

-- 4. Create unique indexes for ultra-fast single index lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_id_hash ON public.students(id_hash);
CREATE INDEX IF NOT EXISTS idx_students_id_last4 ON public.students(id_last4);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_id_hash ON public.teachers(id_hash);
CREATE INDEX IF NOT EXISTS idx_teachers_id_last4 ON public.teachers(id_last4);

-- 5. Auto-populate triggers
CREATE OR REPLACE FUNCTION public.trg_populate_id_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.national_id IS NOT NULL AND trim(NEW.national_id) <> '' THEN
    NEW.id_hash := public.hash_id(NEW.national_id);
    NEW.id_last4 := public.get_id_last4(NEW.national_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_id_hash ON public.students;
CREATE TRIGGER trg_students_id_hash
BEFORE INSERT OR UPDATE OF national_id ON public.students
FOR EACH ROW EXECUTE FUNCTION public.trg_populate_id_hash();

DROP TRIGGER IF EXISTS trg_teachers_id_hash ON public.teachers;
CREATE TRIGGER trg_teachers_id_hash
BEFORE INSERT OR UPDATE OF national_id ON public.teachers
FOR EACH ROW EXECUTE FUNCTION public.trg_populate_id_hash();

-- 6. Update verify_teacher_id RPC
DROP FUNCTION IF EXISTS public.verify_teacher_id(text);
CREATE OR REPLACE FUNCTION public.verify_teacher_id(entered_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 7. Update get_pre_assigned_active_lesson RPC
DROP FUNCTION IF EXISTS public.get_pre_assigned_active_lesson(text);
CREATE OR REPLACE FUNCTION public.get_pre_assigned_active_lesson(entered_id text)
RETURNS TABLE(
    id uuid,
    lesson_code text,
    subject text,
    teacher_name text,
    end_time timestamptz,
    server_now timestamptz,
    is_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    computed_hash text;
BEGIN
    IF entered_id IS NULL OR trim(entered_id) = '' THEN
        RETURN;
    END IF;

    IF length(trim(entered_id)) = 64 THEN
        computed_hash := lower(trim(entered_id));
    ELSE
        computed_hash := public.hash_id(entered_id);
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
    JOIN public.students s ON s.id = lpa.student_id
    LEFT JOIN public.teachers t ON t.id = l.teacher_id
    WHERE s.id_hash = computed_hash
      AND l.status = 'active'
      AND l.end_time > NOW()
    ORDER BY l.created_at DESC;
END;
$$;

-- 8. Update secure_create_teacher_group RPC
DROP FUNCTION IF EXISTS public.secure_create_teacher_group(text, text);
CREATE OR REPLACE FUNCTION public.secure_create_teacher_group(
    entered_teacher_id text,
    group_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 9. Update secure_delete_teacher_group RPC
DROP FUNCTION IF EXISTS public.secure_delete_teacher_group(text, uuid);
CREATE OR REPLACE FUNCTION public.secure_delete_teacher_group(
    entered_teacher_id text,
    target_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 10. Update secure_pre_assign_students RPC
DROP FUNCTION IF EXISTS public.secure_pre_assign_students(text, uuid, uuid[]);
CREATE OR REPLACE FUNCTION public.secure_pre_assign_students(
    entered_teacher_id text,
    target_lesson_id uuid,
    student_ids uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 11. Update secure_set_group_members RPC
DROP FUNCTION IF EXISTS public.secure_set_group_members(text, uuid, uuid[]);
CREATE OR REPLACE FUNCTION public.secure_set_group_members(
    entered_teacher_id text,
    target_group_id uuid,
    student_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- 12. Helper RPC for Teacher: list active students securely (NO plaintext national_id)
DROP FUNCTION IF EXISTS public.get_teacher_student_list(text);
CREATE OR REPLACE FUNCTION public.get_teacher_student_list(p_teacher_id text DEFAULT NULL)
RETURNS TABLE (
    id uuid,
    name text,
    class_name text,
    id_last4 varchar(4)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT s.id, s.name, s.class_name, s.id_last4
    FROM public.students s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
      AND s.class_name NOT IN ('צוות', 'איש צוות', 'מורה')
    ORDER BY s.name;
$$;

-- 13. Update unreturned_loans View (Use id_last4 instead of national_id)
DROP VIEW IF EXISTS public.unreturned_loans CASCADE;
CREATE VIEW public.unreturned_loans AS
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
FROM device_loans dl
LEFT JOIN students s ON s.id = dl.student_id
LEFT JOIN teachers t ON t.id = dl.teacher_id
JOIN devices d ON d.id = dl.device_id
JOIN carts c ON c.id = d.cart_id
WHERE dl.checkin_at IS NULL 
  AND dl.status = 'active' 
  AND d.deleted_at IS NULL 
  AND c.deleted_at IS NULL;

-- 14. Lockdown: Remove Public/Anon Direct SELECT from students & unreturned_loans
DROP POLICY IF EXISTS "students_select" ON public.students;
REVOKE ALL ON public.students FROM anon;
REVOKE ALL ON public.unreturned_loans FROM anon;

-- Ensure authenticated admins retain full access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT SELECT ON public.unreturned_loans TO authenticated;
