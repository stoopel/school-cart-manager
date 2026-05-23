-- ============================================================
-- migration_kiosk_auth.sql
-- מנגנון קוד גישה מאובטח לקיוסק של כל עגלה
-- ============================================================

-- 1. הוספת עמודת קוד קיוסק לטבלת העגלות
ALTER TABLE public.carts ADD COLUMN IF NOT EXISTS kiosk_code TEXT;

-- 2. יצירת קוד ברירת מחדל אקראי בן 4 ספרות לעגלות קיימות שאין להן קוד עדיין
UPDATE public.carts 
SET kiosk_code = lpad(floor(random()*10000)::text, 4, '0')
WHERE kiosk_code IS NULL;

-- 3. יצירת פונקציית שרת מאובטחת לאימות קוד קיוסק ללא חשיפת הקודים לדפדפן
CREATE OR REPLACE FUNCTION public.verify_kiosk_code(p_cart_id UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- הרצה בהרשאות גבוהות המעוקפות מ-RLS
AS $$
DECLARE
    v_db_code TEXT;
BEGIN
    SELECT kiosk_code FROM public.carts
    WHERE id = p_cart_id AND deleted_at IS NULL
    INTO v_db_code;

    -- החזרת true אם הקוד נכון, אחרת false
    RETURN (v_db_code IS NOT NULL AND v_db_code = p_code);
END;
$$;

-- 4. הגבלת הרשאות ברמת עמודה (Column-Level Security)
-- משתמשים מחוברים (authenticated) יכולים לקרוא ולכתוב את כל העמודות
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carts TO authenticated;

-- משתמשי קצה אנונימיים (anon) יכולים לקרוא את פרטי העגלה אך חסומים מלקרוא את קוד הקיוסק ישירות
-- תחילה נסיר את זכות ה-SELECT הגורפת של anon על כל הטבלה
REVOKE SELECT ON public.carts FROM anon;

-- כעת נעניק ל-anon הרשאת SELECT אך ורק על העמודות הציבוריות והלא-רגישות
GRANT SELECT (id, name, display_name, location, created_at, deleted_at) ON public.carts TO anon;
