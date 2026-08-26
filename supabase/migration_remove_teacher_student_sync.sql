-- ============================================================
-- migration_remove_teacher_student_sync.sql
-- הסרת סנכרון כפול של מורים לטבלת תלמידים, ניקוי רשומות המורים ושיפור RPC
-- ============================================================

-- 1. הסרת הטריגרים הישנים שסנכרנו מורים לתלמידים וחסמו מחיקה
DROP TRIGGER IF EXISTS trg_sync_teacher_to_student ON public.teachers;
DROP FUNCTION IF EXISTS public.sync_teacher_to_student();

DROP TRIGGER IF EXISTS trg_protect_teacher_student_delete ON public.students;
DROP FUNCTION IF EXISTS public.protect_teacher_student_delete();

-- 2. ניקוי שיוך תלמידים בהשאלות ישנות עבור מורים (כדי למנוע שגיאות Foreign Key)
UPDATE public.device_loans
SET student_id = NULL
WHERE student_id IN (
    SELECT id FROM public.students
    WHERE grade = 99 OR class_name = 'מורה'
);

-- 3. מחיקת רשומות המורים מטבלת התלמידים
DELETE FROM public.students
WHERE grade = 99 OR class_name = 'מורה';

-- 4. שדרוג פונקציית אימות מורה (verify_teacher_id) לתמיכה מלאה בריפוד / נרמול אפסים
CREATE OR REPLACE FUNCTION public.verify_teacher_id(entered_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    teacher_record RECORD;
    cleaned_input TEXT;
BEGIN
    cleaned_input := LTRIM(entered_id, '0');

    SELECT id, name, is_active, national_id FROM teachers
    WHERE (
        national_id = entered_id
        OR LTRIM(national_id, '0') = cleaned_input
        OR LPAD(national_id, 9, '0') = LPAD(entered_id, 9, '0')
    )
    AND is_active = true
    LIMIT 1
    INTO teacher_record;

    IF teacher_record.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'is_valid', true,
            'teacher_id', teacher_record.id,
            'teacher_name', teacher_record.name,
            'national_id', teacher_record.national_id
        );
    ELSE
        RETURN jsonb_build_object(
            'is_valid', false
        );
    END IF;
END;
$$;
