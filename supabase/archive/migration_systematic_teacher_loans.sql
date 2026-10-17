-- ============================================================
-- migration_systematic_teacher_loans.sql
-- הסדרת מעמד המורה במערך ההשאלות (device_loans)
-- ============================================================

-- 1. הוספת עמודת teacher_id מקושרת לטבלת teachers
ALTER TABLE public.device_loans 
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL;

-- 2. יצירת אינדקסים מהירים לשליפות לפי מורה
CREATE INDEX IF NOT EXISTS idx_device_loans_teacher_id ON public.device_loans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_device_loans_teacher_status ON public.device_loans(teacher_id, status);

-- 3. הבטחת שלמות נתונים: השאלה חייבת להיות משויכת לתלמיד או למורה
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
