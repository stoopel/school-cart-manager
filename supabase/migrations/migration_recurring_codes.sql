-- Migration: Recurring Lesson Codes & Global Collision Prevention
-- 1. Add lesson_code column to recurring_lesson_rules
ALTER TABLE public.recurring_lesson_rules 
ADD COLUMN IF NOT EXISTS lesson_code TEXT;

-- 2. Create unique index on active recurring lesson codes
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_recurring_lesson_code 
ON public.recurring_lesson_rules(lesson_code) 
WHERE (lesson_code IS NOT NULL AND is_active = true);

-- 3. Update generate_lesson_code() RPC to guarantee NO collisions with:
--    A) Any currently active lesson (status = 'active' AND end_time > NOW())
--    B) Any active recurring lesson code (is_active = true)
CREATE OR REPLACE FUNCTION public.generate_lesson_code()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
    code    TEXT;
    taken   BOOLEAN;
BEGIN
    -- Expire ended lessons
    UPDATE public.lessons
    SET status = 'ended'
    WHERE status = 'active' AND end_time <= NOW();

    LOOP
        code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

        SELECT EXISTS (
            SELECT 1 FROM public.lessons
            WHERE lesson_code = code AND status = 'active' AND end_time > NOW()
            UNION ALL
            SELECT 1 FROM public.recurring_lesson_rules
            WHERE lesson_code = code AND is_active = true
        ) INTO taken;

        EXIT WHEN NOT taken;
    END LOOP;
    RETURN code;
END;
$function$;

-- 4. Drop and recreate recurring_lessons_overview view to include lesson_code
DROP VIEW IF EXISTS public.recurring_lessons_overview CASCADE;

CREATE VIEW public.recurring_lessons_overview AS
SELECT
    r.id,
    r.teacher_id,
    t.name AS teacher_name,
    t.id_last4 AS teacher_id_last4,
    r.cart_id,
    c.name AS cart_name,
    c.display_name AS cart_display_name,
    r.day_of_week,
    r.period_id,
    p.period_number,
    p.name AS period_name,
    p.start_time,
    p.end_time,
    r.subject,
    r.class_name,
    r.status,
    r.is_active,
    r.lesson_code,
    r.admin_notes,
    r.created_at,
    r.updated_at
FROM public.recurring_lesson_rules r
LEFT JOIN public.teachers t ON t.id = r.teacher_id
LEFT JOIN public.carts c ON c.id = r.cart_id
LEFT JOIN public.school_periods p ON p.id = r.period_id;

GRANT SELECT ON public.recurring_lessons_overview TO anon, authenticated;
