-- ================================================
-- מערכת ניהול השאלת עגלות מחשבים – סכמת DB
-- ================================================

-- עגלות
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,         -- "עגלה א"
  location TEXT,              -- "ספריה / קומה ב"
  total_devices INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- מחשבים
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID REFERENCES carts(id) ON DELETE CASCADE,
  device_number INT NOT NULL,         -- מספר על המדבקה
  asset_tag TEXT,                     -- מספר רכוש
  mac_address TEXT UNIQUE,
  hostname TEXT,
  last_seen TIMESTAMPTZ,
  battery_level INT,
  status TEXT DEFAULT 'locked' CHECK (status IN ('locked','active','offline')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cart_id, device_number)
);

-- תלמידים (מיובאים מ-Excel)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id TEXT UNIQUE NOT NULL,   -- ת.ז.
  name TEXT NOT NULL,
  class_name TEXT,
  grade INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- השאלות – הטבלה המרכזית
CREATE TABLE IF NOT EXISTS device_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES devices(id),
  student_id UUID REFERENCES students(id),

  -- לקיחה (תחנת עגלה)
  checkout_at TIMESTAMPTZ DEFAULT NOW(),
  checkout_method TEXT DEFAULT 'qr_scan' CHECK (checkout_method IN ('qr_scan','manual_number')),

  -- דיגיטלי (Agent)
  digital_login_at TIMESTAMPTZ,
  digital_logout_at TIMESTAMPTZ,

  -- החזרה (תחנת עגלה – כל אחד)
  checkin_at TIMESTAMPTZ,

  status TEXT DEFAULT 'active' CHECK (status IN ('active','returned','force_closed')),
  return_method TEXT CHECK (return_method IN ('cart_station','admin','force_close')),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- לוג אירועים (לביקורת)
CREATE TABLE IF NOT EXISTS event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES devices(id),
  loan_id UUID REFERENCES device_loans(id),
  source TEXT CHECK (source IN ('agent','cart_station','admin','system')),
  event_type TEXT,   -- heartbeat | lock | unlock | checkout | checkin | alert | login_attempt
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- אינדקסים לביצועים
-- ================================================
CREATE INDEX IF NOT EXISTS idx_loans_student_status ON device_loans(student_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_device_status ON device_loans(device_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_cart ON devices(cart_id);
CREATE INDEX IF NOT EXISTS idx_event_log_device ON event_log(device_id, created_at DESC);

-- ================================================
-- VIEW: מחשבים שלא הוחזרו
-- ================================================
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
WHERE dl.checkin_at IS NULL AND dl.status = 'active';

-- ================================================
-- VIEW: סטטוס עגלות
-- ================================================
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
  c.deleted_at,
  c.allow_manual_entry,
  c.enable_charge_tracking
FROM carts c
LEFT JOIN devices d ON c.id = d.cart_id AND d.deleted_at IS NULL
LEFT JOIN device_loans dl ON dl.device_id = d.id AND dl.status = 'active' AND dl.checkin_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.display_name, c.location, c.total_devices, c.deleted_at, c.allow_manual_entry, c.enable_charge_tracking;

-- ================================================
-- Row Level Security (RLS) – להפעיל בסביבת ייצור
-- ================================================
-- ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE students ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE device_loans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
