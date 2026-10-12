-- ============================================================
-- migration_qa_fixes.sql
-- הקשחת אבטחה, אינדקסים ייחודיים ופונקציות שרת מאובטחות
-- ============================================================

-- ── 1. פונקציית שרת מאובטחת לשיוך תלמידים מראש ───────────────
CREATE OR REPLACE FUNCTION secure_pre_assign_students(
    entered_teacher_id TEXT,
    target_lesson_id UUID,
    student_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- הרצה בהרשאות שרת גבוהות לעקיפת RLS של pre-assignments
AS $$
DECLARE
    is_valid_teacher BOOLEAN;
BEGIN
    -- אימות זהות המורה מול טבלת המורים המאובטחת
    SELECT EXISTS (
        SELECT 1 FROM teachers
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

    -- ניקוי שיוכים קודמים עבור שיעור זה (מניעת כפילויות)
    DELETE FROM lesson_pre_assignments
    WHERE lesson_id = target_lesson_id;

    -- הכנסת השיוכים החדשים
    IF array_length(student_ids, 1) > 0 THEN
        INSERT INTO lesson_pre_assignments (lesson_id, student_id)
        SELECT target_lesson_id, unnest(student_ids);
    END IF;

    RETURN true;
END;
$$;

-- ── 2. הקשחת מדיניות RLS (Row Level Security) ───────────────

-- הסרת מדיניות פתוחה קודמת של anon וקודמת של אדמין למניעת שגיאות כפל
DROP POLICY IF EXISTS "open_student_groups" ON student_groups;
DROP POLICY IF EXISTS "open_student_group_members" ON student_group_members;
DROP POLICY IF EXISTS "open_lesson_pre_assignments" ON lesson_pre_assignments;
DROP POLICY IF EXISTS "student_groups_admin" ON student_groups;
DROP POLICY IF EXISTS "student_group_members_admin" ON student_group_members;
DROP POLICY IF EXISTS "lesson_pre_assignments_admin" ON lesson_pre_assignments;
DROP POLICY IF EXISTS "student_groups_select_anon" ON student_groups;
DROP POLICY IF EXISTS "student_group_members_select_anon" ON student_group_members;
DROP POLICY IF EXISTS "lesson_pre_assignments_select_anon" ON lesson_pre_assignments;

-- הגדרת מדיניות כתיבה למשתמשים מחוברים (authenticated / מנהלים) בלבד
CREATE POLICY "student_groups_admin" ON student_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "student_group_members_admin" ON student_group_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lesson_pre_assignments_admin" ON lesson_pre_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- אפשרות שליפה בלבד (SELECT) למשתמשי קצה אנונימיים (anon / Agent / קיוסק)
CREATE POLICY "student_groups_select_anon" ON student_groups FOR SELECT TO anon USING (true);
CREATE POLICY "student_group_members_select_anon" ON student_group_members FOR SELECT TO anon USING (true);
CREATE POLICY "lesson_pre_assignments_select_anon" ON lesson_pre_assignments FOR SELECT TO anon USING (true);

-- עדכון גראנטים ב-Postgres להסרת הרשאות כתיבה מאנונימיים
GRANT SELECT ON student_groups TO anon;
GRANT SELECT ON student_group_members TO anon;
GRANT SELECT ON lesson_pre_assignments TO anon;

REVOKE INSERT, UPDATE, DELETE ON student_groups FROM anon;
REVOKE INSERT, UPDATE, DELETE ON student_group_members FROM anon;
REVOKE INSERT, UPDATE, DELETE ON lesson_pre_assignments FROM anon;

-- ── 3. מניעת השאלות כפולות (Race Conditions) ────────────────

-- מניעת השאלות כפולות לאותו מחשב במקביל
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_device_loan 
ON device_loans(device_id) WHERE (status = 'active');

-- מניעת השאלות מרובות לאותו תלמיד במקביל
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_student_loan 
ON device_loans(student_id) WHERE (status = 'active');
