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
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- השאלות – הטבלה המרכזית
CREATE TABLE IF NOT EXISTS device_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES devices(id),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,

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
  COUNT(d.id)::INT AS total_devices,
  COUNT(d.id)::INT AS registered_devices,
  COUNT(dl.id)::INT AS active_loans,
  GREATEST(0, (COUNT(d.id)::INT - COUNT(dl.id)::INT)) AS available_devices,
  c.deleted_at,
  c.allow_manual_entry,
  c.enable_charge_tracking
FROM carts c
LEFT JOIN devices d ON c.id = d.cart_id AND d.deleted_at IS NULL
LEFT JOIN device_loans dl ON dl.device_id = d.id AND dl.status = 'active' AND dl.checkin_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.display_name, c.location, c.deleted_at, c.allow_manual_entry, c.enable_charge_tracking;

-- Auto-sync carts.total_devices
CREATE OR REPLACE FUNCTION sync_cart_total_devices()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.cart_id IS NOT NULL THEN
      UPDATE carts
      SET total_devices = (
        SELECT COUNT(*)::INT FROM devices WHERE cart_id = OLD.cart_id AND deleted_at IS NULL
      )
      WHERE id = OLD.cart_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If device was moved to another cart, sync OLD.cart_id as well
    IF OLD.cart_id IS DISTINCT FROM NEW.cart_id AND OLD.cart_id IS NOT NULL THEN
      UPDATE carts
      SET total_devices = (
        SELECT COUNT(*)::INT FROM devices WHERE cart_id = OLD.cart_id AND deleted_at IS NULL
      )
      WHERE id = OLD.cart_id;
    END IF;

    IF NEW.cart_id IS NOT NULL THEN
      UPDATE carts
      SET total_devices = (
        SELECT COUNT(*)::INT FROM devices WHERE cart_id = NEW.cart_id AND deleted_at IS NULL
      )
      WHERE id = NEW.cart_id;
    END IF;
    RETURN NEW;
  ELSE -- INSERT
    IF NEW.cart_id IS NOT NULL THEN
      UPDATE carts
      SET total_devices = (
        SELECT COUNT(*)::INT FROM devices WHERE cart_id = NEW.cart_id AND deleted_at IS NULL
      )
      WHERE id = NEW.cart_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_cart_total_devices ON devices;
CREATE TRIGGER trg_sync_cart_total_devices
AFTER INSERT OR UPDATE OR DELETE ON devices
FOR EACH ROW EXECUTE FUNCTION sync_cart_total_devices();

-- ================================================
-- Row Level Security (RLS) – להפעיל בסביבת ייצור
-- ================================================
-- ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE students ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE device_loans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
