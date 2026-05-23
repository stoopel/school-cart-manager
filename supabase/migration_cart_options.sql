-- ============================================================
-- migration_cart_options.sql
-- הוספת הגדרות פרטניות לכל עגלה: הקלדה ידנית ומעקב טעינה
-- ============================================================

-- 1. הוספת העמודות החדשות לטבלת carts
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS allow_manual_entry BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS enable_charge_tracking BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. עדכון הרשאות ה-SELECT עבור המשתמש האנונימי (anon) בקיוסק
-- נסיר תחילה את הרשאות הסלקט הקודמות כדי למנוע כפילויות
REVOKE SELECT ON public.carts FROM anon;

-- כעת נעניק ל-anon הרשאות קריאה על כל העמודות הלא-רגישות כולל שתי ההגדרות החדשות (וללא קוד הקיוסק הסודי)
GRANT SELECT (id, name, display_name, location, created_at, deleted_at, allow_manual_entry, enable_charge_tracking) ON public.carts TO anon;
