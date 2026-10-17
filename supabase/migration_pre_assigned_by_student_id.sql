-- migration_pre_assigned_by_student_id.sql
-- Transition get_pre_assigned_active_lesson to accept student_id (UUID)

DROP FUNCTION IF EXISTS public.get_pre_assigned_active_lesson(text);
DROP FUNCTION IF EXISTS public.get_pre_assigned_active_lesson(uuid);

CREATE OR REPLACE FUNCTION public.get_pre_assigned_active_lesson(p_student_id uuid)
RETURNS TABLE(
    id uuid,
    lesson_code text,
    subject text,
    teacher_name text,
    end_time timestamptz,
    server_now timestamptz,
    is_locked boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_student_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        l.id,
        l.lesson_code,
        COALESCE(l.subject, 'שיעור'),
        COALESCE(t.name, 'מורה'),
        l.end_time,
        NOW() as server_now,
        l.is_locked
    FROM public.lessons l
    JOIN public.lesson_pre_assignments lpa ON lpa.lesson_id = l.id
    LEFT JOIN public.teachers t ON t.id = l.teacher_id
    WHERE lpa.student_id = p_student_id
      AND l.status = 'active'
      AND l.end_time > NOW()
    ORDER BY l.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pre_assigned_active_lesson(uuid) TO anon, authenticated, service_role;
