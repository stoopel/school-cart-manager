CREATE OR REPLACE FUNCTION public.clean_student_national_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.national_id IS NOT NULL AND length(trim(NEW.national_id)) > 0 THEN
        NEW.national_id := lpad(trim(NEW.national_id), 9, '0');
    END IF;
    RETURN NEW;
END;
$$;
