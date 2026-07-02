-- ============================================================
-- migration_secure_student_disconnect.sql
-- פונקציית שרת מאובטחת להתנתקות תלמיד משיעור
-- ============================================================

CREATE OR REPLACE FUNCTION public.disconnect_student_from_lesson(
    p_loan_id UUID,
    p_student_id UUID,
    p_lesson_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_student_from_lesson(UUID, UUID, UUID) TO anon;
