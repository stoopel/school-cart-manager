-- ============================================================
-- secure_policies.sql
-- מערכת ניהול השאלת עגלות מחשבים – הגדרות אבטחה RLS ו-RPC
-- ============================================================

-- ── 1. הפעלת RLS על כלל הטבלאות ──────────────────────────────
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_participants ENABLE ROW LEVEL SECURITY;

-- ── 2. הסרת מדיניות פתוחה קודמת (אם קיימת) ───────────────────
DROP POLICY IF EXISTS "open_teachers" ON teachers;
DROP POLICY IF EXISTS "open_lessons" ON lessons;
DROP POLICY IF EXISTS "open_lesson_participants" ON lesson_participants;

DROP POLICY IF EXISTS "carts_select" ON carts;
DROP POLICY IF EXISTS "devices_select" ON devices;
DROP POLICY IF EXISTS "devices_update" ON devices;
DROP POLICY IF EXISTS "students_select" ON students;
DROP POLICY IF EXISTS "students_update" ON students;
DROP POLICY IF EXISTS "device_loans_select" ON device_loans;
DROP POLICY IF EXISTS "device_loans_insert" ON device_loans;
DROP POLICY IF EXISTS "device_loans_update" ON device_loans;
DROP POLICY IF EXISTS "event_log_insert" ON event_log;
DROP POLICY IF EXISTS "event_log_select" ON event_log;
DROP POLICY IF EXISTS "lessons_select" ON lessons;
DROP POLICY IF EXISTS "lessons_insert" ON lessons;
DROP POLICY IF EXISTS "lessons_update" ON lessons;
DROP POLICY IF EXISTS "lesson_participants_select" ON lesson_participants;
DROP POLICY IF EXISTS "lesson_participants_insert" ON lesson_participants;
DROP POLICY IF EXISTS "lesson_participants_update" ON lesson_participants;

DROP POLICY IF EXISTS "teachers_admin" ON teachers;
DROP POLICY IF EXISTS "carts_admin" ON carts;
DROP POLICY IF EXISTS "devices_admin" ON devices;
DROP POLICY IF EXISTS "students_admin" ON students;
DROP POLICY IF EXISTS "device_loans_admin" ON device_loans;
DROP POLICY IF EXISTS "event_log_admin" ON event_log;
DROP POLICY IF EXISTS "lessons_admin" ON lessons;
DROP POLICY IF EXISTS "lesson_participants_admin" ON lesson_participants;

-- ── 3. הגדרת מדיניות גישה (RLS Policies) למפתח Anon ───────────

-- עגלות (carts): הרשאת קריאה בלבד לכולם
CREATE POLICY "carts_select" ON carts FOR SELECT TO anon USING (true);

-- מחשבים (devices): הרשאות קריאה ועדכון (לצורך עדכון סוללה ו-heartbeat)
CREATE POLICY "devices_select" ON devices FOR SELECT TO anon USING (true);
CREATE POLICY "devices_update" ON devices FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- תלמידים (students): הרשאות קריאה ועדכון (לצורך שליפה ועדכון strikes)
CREATE POLICY "students_select" ON students FOR SELECT TO anon USING (true);
CREATE POLICY "students_update" ON students FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- השאלות (device_loans): הרשאות קריאה, יצירה ועדכון (לצורך השאלה/החזרה)
CREATE POLICY "device_loans_select" ON device_loans FOR SELECT TO anon USING (true);
CREATE POLICY "device_loans_insert" ON device_loans FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "device_loans_update" ON device_loans FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- לוג אירועים (event_log): הרשאות קריאה וכתיבה
CREATE POLICY "event_log_insert" ON event_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "event_log_select" ON event_log FOR SELECT TO anon USING (true);

-- שיעורים (lessons): הרשאות קריאה, יצירה ועדכון (לצורך ניהול שיעורים ע"י Kiosk ו-Teacher)
CREATE POLICY "lessons_select" ON lessons FOR SELECT TO anon USING (true);
CREATE POLICY "lessons_insert" ON lessons FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lessons_update" ON lessons FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- משתתפי שיעור (lesson_participants): הרשאות קריאה, יצירה ועדכון
CREATE POLICY "lesson_participants_select" ON lesson_participants FOR SELECT TO anon USING (true);
CREATE POLICY "lesson_participants_insert" ON lesson_participants FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lesson_participants_update" ON lesson_participants FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- הערה: טבלת מורים (teachers) תישאר ללא מדיניות עבור anon!
-- הדבר יחסום לחלוטין כל גישת SELECT ישירה על הטבלה על מנת למנוע זליגת תעודות זהות.
-- הגישה היחידה של משתמשי anon תהיה דרך פונקציית השרת המאובטחת verify_teacher_id.

-- ── 4. הגדרת מדיניות גישה (RLS Policies) למנהלים מחוברים (authenticated) ───
CREATE POLICY "teachers_admin" ON teachers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "carts_admin" ON carts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "devices_admin" ON devices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "students_admin" ON students FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "device_loans_admin" ON device_loans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "event_log_admin" ON event_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lessons_admin" ON lessons FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lesson_participants_admin" ON lesson_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 5. עדכון ה-View של שיעורים פעילים (להסרת ת.ז מורים למניעת זליגה) ───
DROP VIEW IF EXISTS active_lessons CASCADE;
CREATE OR REPLACE VIEW active_lessons AS
SELECT
    l.id,
    l.lesson_code,
    l.subject,
    l.duration_minutes,
    l.start_time,
    l.end_time,
    l.is_locked,
    t.name  AS teacher_name,
    EXTRACT(EPOCH FROM (l.end_time - NOW())) / 60 AS minutes_remaining,
    COUNT(lp.id) AS participant_count
FROM lessons l
LEFT JOIN teachers t ON t.id = l.teacher_id
LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id
WHERE l.status = 'active'
GROUP BY l.id, t.name;

-- ── 6. פונקציית שרת לאימות מורה מאובטח (verify_teacher_id) ────
CREATE OR REPLACE FUNCTION verify_teacher_id(entered_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- הרצת הפונקציה בהרשאות גבוהות המעוקפות מ-RLS של teachers
AS $$
DECLARE
    teacher_record RECORD;
BEGIN
    SELECT id, name, is_active FROM teachers
    WHERE national_id = entered_id AND is_active = true
    INTO teacher_record;

    IF teacher_record.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'is_valid', true,
            'teacher_id', teacher_record.id,
            'teacher_name', teacher_record.name
        );
    ELSE
        RETURN jsonb_build_object(
            'is_valid', false
        );
    END IF;
END;
$$;

-- ── 7. פונקציית שרת לקבלת זמן שרת מדויק ───────────────────────
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT NOW();
$$;

-- ── 8. הקשחת אבטחת רישום מנהלים (Supabase Auth Hardening) ───────────

-- יצירת טבלת מנהלים מורשים
CREATE TABLE IF NOT EXISTS public.allowed_admins (
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- הפעלת RLS על טבלת מנהלים מורשים
ALTER TABLE public.allowed_admins ENABLE ROW LEVEL SECURITY;

-- פוליסי המאפשר למנהלים מחוברים לנהל את רשימת המורשים
DROP POLICY IF EXISTS "allowed_admins_admin" ON public.allowed_admins;
CREATE POLICY "allowed_admins_admin" ON public.allowed_admins FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- פונקציית שרת לניהול רישום ואימות מנהלים אוטומטי
CREATE OR REPLACE FUNCTION public.handle_auth_signup_restriction()
RETURNS TRIGGER AS $$
DECLARE
    allowed_count INT;
BEGIN
    -- אישור אימייל וטלפון אוטומטי כדי לחסוך צורך באישור ידני ב-Dashboard
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());

    -- בדיקת כמות המנהלים הרשומים במערכת
    SELECT COUNT(*) FROM public.allowed_admins INTO allowed_count;

    -- אם אין אף מנהל מורשם, נאפשר את הרישום של המנהל הראשון ונוסיף אותו לרשימה
    IF allowed_count = 0 THEN
        INSERT INTO public.allowed_admins (email) VALUES (NEW.email);
    ELSE
        -- אם כבר קיים מנהל, נבדוק האם האימייל הנוכחי נמצא ברשימת המורשים
        IF NOT EXISTS (SELECT 1 FROM public.allowed_admins WHERE email = NEW.email) THEN
            RAISE EXCEPTION 'הרשמה חסומה. כתובת האימייל % אינה נמצאת ברשימת המנהלים המורשים.', NEW.email;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- חיבור הטריגר לטבלת המשתמשים של Supabase
DROP TRIGGER IF EXISTS restrict_auth_signups ON auth.users;
CREATE TRIGGER restrict_auth_signups
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_signup_restriction();

