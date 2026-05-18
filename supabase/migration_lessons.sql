-- ============================================================
-- migration_lessons.sql
-- מערכת שיעורים + מעקב טעינה
-- ============================================================

-- ── 1. טבלת מורים ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    national_id TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    email       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. טבלת שיעורים ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lessons (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id       UUID REFERENCES teachers(id) ON DELETE SET NULL,
    lesson_code      TEXT NOT NULL,          -- 4 ספרות, ייחודי בין שיעורים פעילים
    subject          TEXT,                   -- שם המקצוע (אופציונלי)
    duration_minutes INTEGER NOT NULL,
    start_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time         TIMESTAMPTZ NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','ended','cancelled')),
    is_locked        BOOLEAN NOT NULL DEFAULT false,  -- נעילה ידנית ע"י מורה
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- אינדקס לשאילתות מהירות על שיעורים פעילים
CREATE INDEX IF NOT EXISTS idx_lessons_active
    ON lessons (lesson_code, status)
    WHERE status = 'active';

-- ── 3. משתתפי שיעור ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_participants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id   UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    loan_id     UUID REFERENCES device_loans(id) ON DELETE SET NULL,
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lesson_id, device_id)   -- מחשב אחד = שיעור אחד בלבד
);

-- ── 4. קישור השאלה ← שיעור ───────────────────────────────────
ALTER TABLE device_loans
    ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL;

-- ── 5. מעקב טעינה בתלמידים ───────────────────────────────────
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS charge_strikes    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_charged_at   TIMESTAMPTZ;

-- ── 6. מעקב סוללה במחשבים ────────────────────────────────────
ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS battery_level          SMALLINT,   -- 0-100
    ADD COLUMN IF NOT EXISTS is_charging            BOOLEAN,
    ADD COLUMN IF NOT EXISTS last_battery_level     SMALLINT,   -- לפני שינה
    ADD COLUMN IF NOT EXISTS last_battery_recorded  TIMESTAMPTZ;

-- ── 7. פונקציית ייצור קוד שיעור ייחודי ──────────────────────
CREATE OR REPLACE FUNCTION generate_lesson_code()
RETURNS TEXT AS $$
DECLARE
    code    TEXT;
    taken   BOOLEAN;
BEGIN
    LOOP
        -- 4 ספרות אקראיות: 0000-9999
        code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

        SELECT EXISTS (
            SELECT 1 FROM lessons
            WHERE lesson_code = code AND status = 'active'
        ) INTO taken;

        EXIT WHEN NOT taken;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ── 8. View: שיעורים פעילים עם מידע מפורט ───────────────────
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
    t.national_id AS teacher_national_id,
    EXTRACT(EPOCH FROM (l.end_time - NOW())) / 60 AS minutes_remaining,
    COUNT(lp.id) AS participant_count
FROM lessons l
LEFT JOIN teachers t ON t.id = l.teacher_id
LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id
WHERE l.status = 'active'
GROUP BY l.id, t.name, t.national_id;

-- ── 9. הפעל RLS (placeholder – לא נאכף בשלב הבדיקות) ─────────
ALTER TABLE teachers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_participants ENABLE ROW LEVEL SECURITY;

-- מדיניות פתוחה לבדיקות
CREATE POLICY "open_teachers"            ON teachers            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_lessons"             ON lessons             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_lesson_participants" ON lesson_participants  FOR ALL USING (true) WITH CHECK (true);
