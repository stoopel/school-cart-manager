-- ============================================================
-- migration_sync_pre_assignment.sql
-- סנכרון אוטומטי של שיוכים מראש להשאלות פעילות ומשתתפי שיעור
-- מיושם לפי "אפשרות 2" - הגנה על שיעורים פעילים קיימים מדריסה
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_pre_assignment_to_active_loan()
RETURNS TRIGGER AS $$
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

            -- הצטרפות אוטומטית לשיעור (אם לא קיים כבר)
            INSERT INTO public.lesson_participants (lesson_id, loan_id, device_id, student_id)
            VALUES (NEW.lesson_id, active_loan.id, active_loan.device_id, NEW.student_id)
            ON CONFLICT (lesson_id, device_id) DO NOTHING;
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- הסרת טריגר ישן למניעת שגיאות כפל
DROP TRIGGER IF EXISTS trg_sync_pre_assignment_to_active_loan ON public.lesson_pre_assignments;

-- יצירת הטריגר
CREATE TRIGGER trg_sync_pre_assignment_to_active_loan
AFTER INSERT OR UPDATE OR DELETE ON public.lesson_pre_assignments
FOR EACH ROW
EXECUTE FUNCTION public.sync_pre_assignment_to_active_loan();
