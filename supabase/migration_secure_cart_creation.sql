-- ============================================================
-- migration_secure_cart_creation.sql (Corrected)
-- פונקציות שרת מאובטחות (RPC) ליצירת עגלות ומחשבים מהמתקין
-- ============================================================

-- 1. פונקציה מאובטחת ליצירת עגלה חדשה רק באמצעות קוד מנהל תקין
CREATE OR REPLACE FUNCTION public.create_cart_securely(
    p_name TEXT,
    p_admin_code TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- הרצה בהרשאות גבוהות לעקיפת הגבלות RLS
AS $$
DECLARE
    v_cart_id UUID;
BEGIN
    -- אימות קוד מנהל (תומך באנגלית וגם במקלדת עברית בטעות)
    IF p_admin_code != 'admin2024' AND p_admin_code != 'שגצםמ2024' THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin passcode';
    END IF;

    -- הכנסת העגלה החדשה ומשיכת ה-UUID שלה
    INSERT INTO public.carts (name)
    VALUES (p_name)
    RETURNING id INTO v_cart_id;

    RETURN v_cart_id;
END;
$$;

-- 2. פונקציה מאובטחת לרישום או עדכון מחשב (Device) תחת עגלה
CREATE OR REPLACE FUNCTION public.register_device_securely(
    p_asset_tag TEXT,
    p_cart_id UUID,
    p_device_number INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- הרצה בהרשאות גבוהות לעקיפת הגבלות RLS
AS $$
DECLARE
    v_device_id UUID;
BEGIN
    -- חיפוש האם המחשב כבר קיים לפי ה-Asset Tag (שם המחשב ברשת)
    SELECT id FROM public.devices WHERE asset_tag = p_asset_tag INTO v_device_id;
    
    IF v_device_id IS NOT NULL THEN
        -- עדכון מחשב קיים
        UPDATE public.devices
        SET cart_id = p_cart_id,
            device_number = p_device_number,
            status = 'locked',
            is_charging = true,
            battery_level = 100
        WHERE id = v_device_id;
    ELSE
        -- יצירת מחשב חדש לחלוטין
        INSERT INTO public.devices (asset_tag, cart_id, device_number, status, is_charging, battery_level)
        VALUES (p_asset_tag, p_cart_id, p_device_number, 'locked', true, 100);
    END IF;
    
    RETURN true;
END;
$$;
