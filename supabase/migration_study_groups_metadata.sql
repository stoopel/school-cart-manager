-- ============================================================
-- migration_study_groups_metadata.sql
-- הרחבת קבוצות לימוד עם מספר קבוצה ומורה אחראי
-- ============================================================

-- 1. הרחבת טבלת student_groups
ALTER TABLE student_groups 
ADD COLUMN IF NOT EXISTS group_number TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS subject TEXT,
ADD COLUMN IF NOT EXISTS class_name TEXT;

-- 2. יצירת אינדקס לביצועים וקישורים מהירים לפי מספר קבוצה
CREATE INDEX IF NOT EXISTS idx_student_groups_number ON student_groups(group_number);

-- 3. עדכון הרשאות RLS של student_groups
-- (מבטיח שה-Agent יוכל לשלוף נתונים באנונימיות והמנהל/מורים יוכלו לעדכן)
ALTER TABLE student_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_groups_select_anon" ON student_groups;
DROP POLICY IF EXISTS "student_groups_admin" ON student_groups;

CREATE POLICY "student_groups_select_anon" ON student_groups FOR SELECT TO anon USING (true);
CREATE POLICY "student_groups_admin" ON student_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON student_groups TO anon;
REVOKE INSERT, UPDATE, DELETE ON student_groups FROM anon;
