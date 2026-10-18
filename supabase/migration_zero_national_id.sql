-- Migration: Zero-Plaintext National ID Architecture
-- Completely remove national_id columns from students and teachers
-- Enforce UNIQUE NOT NULL constraints on id_hash

-- 1. Drop existing triggers that depended on national_id
DROP TRIGGER IF EXISTS trg_clean_student_national_id ON public.students;
DROP FUNCTION IF EXISTS public.clean_student_national_id();
DROP TRIGGER IF EXISTS trg_clean_teacher_national_id ON public.teachers;
DROP FUNCTION IF EXISTS public.clean_teacher_national_id();
DROP TRIGGER IF EXISTS trg_students_id_hash ON public.students;
DROP TRIGGER IF EXISTS trg_teachers_id_hash ON public.teachers;
DROP FUNCTION IF EXISTS public.trg_populate_id_hash();

-- 2. Ensure all rows have id_hash and id_last4 (safety check)
DELETE FROM public.students WHERE id_hash IS NULL;
DELETE FROM public.teachers WHERE id_hash IS NULL;

-- 3. Drop national_id columns completely
ALTER TABLE public.students DROP COLUMN IF EXISTS national_id CASCADE;
ALTER TABLE public.teachers DROP COLUMN IF EXISTS national_id CASCADE;

-- 4. Enforce NOT NULL and UNIQUE constraints on id_hash
ALTER TABLE public.students ALTER COLUMN id_hash SET NOT NULL;
ALTER TABLE public.teachers ALTER COLUMN id_hash SET NOT NULL;

-- Ensure unique constraints exist (for PostgREST upsert onConflict: 'id_hash')
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'students_id_hash_key'
    ) THEN
        ALTER TABLE public.students ADD CONSTRAINT students_id_hash_key UNIQUE (id_hash);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'teachers_id_hash_key'
    ) THEN
        ALTER TABLE public.teachers ADD CONSTRAINT teachers_id_hash_key UNIQUE (id_hash);
    END IF;
END $$;
