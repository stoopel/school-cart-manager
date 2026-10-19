-- migration_fix_pre_assignment_eager_insert.sql
-- מניעת הכנסה מוקדמת אוטומטית ל-lesson_participants.
-- התלמיד ייכנס ל-lesson_participants רק כשיבחר בפועל להיכנס לשיעור.

CREATE OR REPLACE FUNCTION public.sync_pre_assignment_to_active_loan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    active_loan RECORD;
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        -- חיפוש השאלה פעילה של התלמיד
        SELECT id, device_id, lesson_id INTO active_loan
        FROM public.device_loans
        WHERE student_id = NEW.student_id AND status = 'active' AND checkin_at IS NULL;

        -- אם קיימת השאלה פעילה ועדיין לא משויך לה שיעור
        IF active_loan.id IS NOT NULL AND active_loan.lesson_id IS NULL THEN
            -- עדכון ההשאלה עם מזהה השיעור (כדי שהמחשב יקבל Realtime)
            UPDATE public.device_loans
            SET lesson_id = NEW.lesson_id
            WHERE id = active_loan.id;

            -- בוטל ה-INSERT האוטומטי המוקדם ל-lesson_participants!
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
$function$;
