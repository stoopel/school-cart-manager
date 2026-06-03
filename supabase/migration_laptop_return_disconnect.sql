-- ============================================================
-- migration_laptop_return_disconnect.sql
-- סנכרון ניתוק מחשב מהשיעור הדיגיטלי בעת החזרתו הפיזית לעגלה
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_returned_laptop_disconnect()
RETURNS TRIGGER AS $$
BEGIN
    -- If the device loan status changes to 'returned' (checked-in)
    IF NEW.status = 'returned' AND OLD.status = 'active' THEN
        -- Set digital_logout_at to checkin_at if not already set
        IF NEW.digital_logout_at IS NULL THEN
            NEW.digital_logout_at := NEW.checkin_at;
        END IF;
        
        -- Remove from lesson_participants for any active lesson
        DELETE FROM public.lesson_participants
        WHERE device_id = NEW.device_id
          AND lesson_id IN (SELECT id FROM public.lessons WHERE status = 'active');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_handle_returned_laptop_disconnect ON public.device_loans;

CREATE TRIGGER trg_handle_returned_laptop_disconnect
BEFORE UPDATE ON public.device_loans
FOR EACH ROW
EXECUTE FUNCTION public.handle_returned_laptop_disconnect();
