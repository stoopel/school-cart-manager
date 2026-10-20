-- Update active_lessons view to count only active connected devices (last_seen within 2 minutes)
CREATE OR REPLACE VIEW public.active_lessons AS
SELECT l.id,
    l.lesson_code,
    l.subject,
    l.duration_minutes,
    l.start_time,
    l.end_time,
    l.is_locked,
    t.name AS teacher_name,
    (EXTRACT(epoch FROM (l.end_time - now())) / (60)::numeric) AS minutes_remaining,
    COUNT(CASE WHEN d.last_seen > (NOW() - INTERVAL '2 minutes') THEN 1 END) AS participant_count
   FROM lessons l
     LEFT JOIN teachers t ON t.id = l.teacher_id
     LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id
     LEFT JOIN devices d ON d.id = lp.device_id
  WHERE l.status = 'active' AND l.end_time > now()
  GROUP BY l.id, t.name;

GRANT SELECT ON public.active_lessons TO anon, authenticated, service_role;
