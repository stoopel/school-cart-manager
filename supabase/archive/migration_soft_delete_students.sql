-- ==============================================================================
-- migration_soft_delete_students.sql
-- תמיכה בהשבתה (מחיקה רכה) של תלמידים ומניעת שגיאות מפתח זר
-- ==============================================================================

-- 1. הוספת עמודת is_active לטבלת students
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. הוספת עמודת deleted_at לטבלת students
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. אינדקסים לביצועים
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_active_nid ON students(national_id) WHERE is_active = true;

-- 4. עדכון מפתח זר ב-device_loans לתמיכה ב-ON DELETE SET NULL (מניעת שגיאות 23503 במחיקה פיזית)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'device_loans_student_id_fkey' 
        AND table_name = 'device_loans'
    ) THEN
        ALTER TABLE device_loans DROP CONSTRAINT device_loans_student_id_fkey;
        ALTER TABLE device_loans ADD CONSTRAINT device_loans_student_id_fkey 
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
    END IF;
END $$;
