-- הוספת סטטוס 'scheduled' לשיעורים מתוכננים מראש
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('active','scheduled','ended','cancelled'));

-- עדכון view: הצג גם שיעורים מתוכננים שעדיין לא התחילו
CREATE OR REPLACE VIEW teacher_lessons AS
SELECT
  l.id,
  l.lesson_code,
  l.subject,
  l.duration_minutes,
  l.start_time,
  l.end_time,
  l.status,
  l.is_locked,
  l.teacher_id,
  t.name  AS teacher_name,
  EXTRACT(EPOCH FROM (l.start_time - NOW())) / 60  AS minutes_until_start,
  EXTRACT(EPOCH FROM (l.end_time   - NOW())) / 60  AS minutes_remaining,
  COUNT(lp.id) AS participant_count
FROM lessons l
LEFT JOIN teachers t    ON t.id = l.teacher_id
LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id
WHERE l.status IN ('active','scheduled')
  AND l.end_time > NOW()
GROUP BY l.id, t.name;
