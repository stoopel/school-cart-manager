-- ==============================================================================
-- school-cart-manager: Consolidated Latest Migrations
-- קובץ מיגרציות מרוכז - להרצה ב-Supabase SQL Editor
-- כל הפקודות בקובץ זה הן Idempotent (בטוחות להרצה חוזרת ללא שגיאות)
-- ==============================================================================

-- ==============================================================================
-- 1. תמיכה בהשאלת מורים שיטתית (Systematic Teacher Loans)
-- ==============================================================================

-- הוספת עמודת teacher_id לטבלת השאלות
ALTER TABLE public.device_loans 
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL;

-- אינדקסים לשליפה מהירה
CREATE INDEX IF NOT EXISTS idx_device_loans_teacher_id ON public.device_loans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_device_loans_teacher_status ON public.device_loans(teacher_id, status);

-- אילוץ תקינות: לווה הוא או תלמיד או מורה
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_loan_borrower'
    ) THEN
        ALTER TABLE public.device_loans
        ADD CONSTRAINT chk_loan_borrower CHECK (
            (student_id IS NOT NULL AND teacher_id IS NULL) OR
            (student_id IS NULL AND teacher_id IS NOT NULL) OR
            (student_id IS NULL AND teacher_id IS NULL)
        );
    END IF;
END $$;


-- ==============================================================================
-- 2. השבתה רכה (Soft Delete) ושלמות מפתחות זרים בתלמידים ומורים
-- ==============================================================================

-- הוספת עמודות is_active ו-deleted_at לטבלת תלמידים
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- אינדקסים לביצועים מהירים בעת חיפוש תלמידים פעילים
CREATE INDEX IF NOT EXISTS idx_students_is_active ON public.students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_active_nid ON public.students(national_id) WHERE is_active = true;

-- עדכון מפתח זר של student_id ל-ON DELETE SET NULL למניעת שגיאות 23503
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'device_loans_student_id_fkey' 
        AND table_name = 'device_loans'
    ) THEN
        ALTER TABLE public.device_loans DROP CONSTRAINT device_loans_student_id_fkey;
        ALTER TABLE public.device_loans ADD CONSTRAINT device_loans_student_id_fkey 
            FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;
    END IF;
END $$;


-- ==============================================================================
-- 3. סנכרון טריגר עגלות וספירת מחשבים זמינים (Cart Status Counts)
-- ==============================================================================

-- פונקציית טריגר לסנכרון אוטומטי של סה"כ מחשבים בעגלה בעת הוספה, עדכון, מחיקה או העברה
CREATE OR REPLACE FUNCTION public.sync_cart_total_devices()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cart_total_devices ON public.devices;
CREATE TRIGGER trg_sync_cart_total_devices
AFTER INSERT OR UPDATE OR DELETE ON public.devices
FOR EACH ROW EXECUTE FUNCTION public.sync_cart_total_devices();

-- סנכרון מיידי של כל העגלות הקיימות לכמות המחשבים הרשומים בפועל
UPDATE public.carts c
SET total_devices = COALESCE((
  SELECT COUNT(*)::INT FROM public.devices d WHERE d.cart_id = c.id AND d.deleted_at IS NULL
), 0);

-- עדכון ה-VIEW של סטטוס העגלות
DROP VIEW IF EXISTS public.cart_status CASCADE;

CREATE VIEW public.cart_status AS
SELECT
  c.id,
  c.name,
  c.display_name,
  c.location,
  COUNT(d.id)::INT AS total_devices,
  COUNT(d.id)::INT AS registered_devices,
  COUNT(dl.id)::INT AS active_loans,
  GREATEST(0, (COUNT(d.id)::INT - COUNT(dl.id)::INT)) AS available_devices,
  c.deleted_at,
  c.allow_manual_entry,
  c.enable_charge_tracking
FROM public.carts c
LEFT JOIN public.devices d ON c.id = d.cart_id AND d.deleted_at IS NULL
LEFT JOIN public.device_loans dl ON dl.device_id = d.id AND dl.status = 'active' AND dl.checkin_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.display_name, c.location, c.deleted_at, c.allow_manual_entry, c.enable_charge_tracking;


-- ==============================================================================
-- 4. מניעת מרוצי תהליכים בהשאלות (Race Condition Locks)
-- ==============================================================================

-- מניעת השאלות כפולות לאותו מחשב במקביל
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_device_loan 
ON public.device_loans(device_id) WHERE (status = 'active');

-- מניעת השאלות מרובות לאותו תלמיד במקביל
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_student_loan 
ON public.device_loans(student_id) WHERE (status = 'active');


-- ==============================================================================
-- 5. תמיכה בנרמול תעודות זהות (אפסים מובילים) בפונקציות RPC
-- ==============================================================================

-- פונקציה מאובטחת לשיוך מראש של תלמידים לשיעור (תומכת באפסים מובילים)
CREATE OR REPLACE FUNCTION public.secure_pre_assign_students(
    entered_teacher_id TEXT,
    target_lesson_id UUID,
    student_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    is_valid_teacher BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.teachers
        WHERE (
            national_id = entered_teacher_id
            OR LTRIM(national_id, '0') = LTRIM(entered_teacher_id, '0')
            OR LPAD(national_id, 9, '0') = LPAD(entered_teacher_id, 9, '0')
        )
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

-- שיוך יוצר לקבוצת לימוד
ALTER TABLE public.student_groups 
ADD COLUMN IF NOT EXISTS created_by_teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL;

-- הרשאות RLS מוקשחות לקבוצות ושיוכים
DROP POLICY IF EXISTS "student_groups_admin" ON public.student_groups;
DROP POLICY IF EXISTS "student_group_members_admin" ON public.student_group_members;
DROP POLICY IF EXISTS "lesson_pre_assignments_admin" ON public.lesson_pre_assignments;
DROP POLICY IF EXISTS "student_groups_select_anon" ON public.student_groups;
DROP POLICY IF EXISTS "student_group_members_select_anon" ON public.student_group_members;
DROP POLICY IF EXISTS "lesson_pre_assignments_select_anon" ON public.lesson_pre_assignments;

CREATE POLICY "student_groups_admin" ON public.student_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "student_group_members_admin" ON public.student_group_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lesson_pre_assignments_admin" ON public.lesson_pre_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "student_groups_select_anon" ON public.student_groups FOR SELECT TO anon USING (true);
CREATE POLICY "student_group_members_select_anon" ON public.student_group_members FOR SELECT TO anon USING (true);
CREATE POLICY "lesson_pre_assignments_select_anon" ON public.lesson_pre_assignments FOR SELECT TO anon USING (true);

GRANT SELECT ON public.student_groups TO anon;
GRANT SELECT ON public.student_group_members TO anon;
GRANT SELECT ON public.lesson_pre_assignments TO anon;

REVOKE INSERT, UPDATE, DELETE ON public.student_groups FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.student_group_members FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_pre_assignments FROM anon;
