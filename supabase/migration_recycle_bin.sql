-- ========================================================
-- מיגרציה עבור מנגנון סל מיחזור (Soft Delete) ומחיקה סופית
-- ========================================================

-- 1. הוספת שדה deleted_at לטבלאות עגלות ומחשבים
ALTER TABLE carts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. עדכון ה-VIEW cart_status לסנן עגלות ומחשבים מחוקים לוגית
CREATE OR REPLACE VIEW cart_status AS
SELECT
  c.id,
  c.name,
  c.display_name,
  c.location,
  c.total_devices,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL) AS registered_devices,
  COUNT(dl.id) FILTER (WHERE dl.status = 'active' AND dl.checkin_at IS NULL) AS active_loans,
  (c.total_devices - COUNT(dl.id) FILTER (WHERE dl.status = 'active' AND dl.checkin_at IS NULL)) AS available_devices,
  c.deleted_at
FROM carts c
LEFT JOIN devices d ON c.id = d.cart_id AND d.deleted_at IS NULL
LEFT JOIN device_loans dl ON dl.device_id = d.id AND dl.status = 'active' AND dl.checkin_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.display_name, c.location, c.total_devices, c.deleted_at;

-- 3. עדכון ה-VIEW unreturned_loans לסנן עגלות ומחשבים מחוקים לוגית
CREATE OR REPLACE VIEW unreturned_loans AS
SELECT
  dl.id AS loan_id,
  s.name AS student_name,
  s.national_id,
  s.class_name,
  d.device_number,
  d.id AS device_id,
  c.name AS cart_name,
  c.id AS cart_id,
  dl.checkout_at,
  dl.checkout_method,
  dl.digital_login_at,
  EXTRACT(EPOCH FROM (NOW() - dl.checkout_at))/60 AS minutes_out
FROM device_loans dl
JOIN students s ON s.id = dl.student_id
JOIN devices d ON d.id = dl.device_id
JOIN carts c ON c.id = d.cart_id
WHERE dl.checkin_at IS NULL 
  AND dl.status = 'active'
  AND d.deleted_at IS NULL 
  AND c.deleted_at IS NULL;
