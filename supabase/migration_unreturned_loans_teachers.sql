-- ============================================================
-- migration_unreturned_loans_teachers.sql
-- תמיכה בהשאלות מורים ב-VIEW של מחשבים שלא הוחזרו
-- ============================================================

CREATE OR REPLACE VIEW public.unreturned_loans AS
SELECT
  dl.id AS loan_id,
  COALESCE(s.name, t.name) AS student_name,
  COALESCE(s.national_id, t.national_id) AS national_id,
  COALESCE(s.class_name, 'מורה') AS class_name,
  d.device_number,
  d.id AS device_id,
  c.name AS cart_name,
  c.id AS cart_id,
  dl.checkout_at,
  dl.checkout_method,
  dl.digital_login_at,
  EXTRACT(EPOCH FROM (NOW() - dl.checkout_at))/60 AS minutes_out
FROM public.device_loans dl
LEFT JOIN public.students s ON s.id = dl.student_id
LEFT JOIN public.teachers t ON t.id = dl.teacher_id
JOIN public.devices d ON d.id = dl.device_id
JOIN public.carts c ON c.id = d.cart_id
WHERE dl.checkin_at IS NULL 
  AND dl.status = 'active'
  AND d.deleted_at IS NULL 
  AND c.deleted_at IS NULL;
