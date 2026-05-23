-- ============================================================
-- migration_student_groups.sql
-- מערכת קבוצות תלמידים ושיוך מראש לשיעורים
-- ============================================================

-- ── 1. טבלת קבוצות תלמידים ──────────────────────────────────
CREATE TABLE IF NOT EXISTS student_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,            -- למשל: "הקבצה א מתמטיקה"
    description TEXT,                            -- תיאור חופשי
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. טבלת חברי קבוצה ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_group_members (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_student ON student_group_members(student_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON student_group_members(group_id);

-- ── 3. טבלת שיוך מראש לשיעור ─────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_pre_assignments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lesson_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_pre_assignments_lesson ON lesson_pre_assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_pre_assignments_student ON lesson_pre_assignments(student_id);

-- ── 4. פונקציית בדיקת שיוך פעיל עבור ה-Agent ──────────────────
CREATE OR REPLACE FUNCTION get_pre_assigned_active_lesson(entered_id TEXT)
RETURNS TABLE (
    lesson_id UUID,
    lesson_code TEXT,
    subject TEXT,
    teacher_name TEXT,
    end_time TIMESTAMPTZ,
    server_now TIMESTAMPTZ,
    is_locked BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.lesson_code,
        COALESCE(l.subject, 'שיעור'),
        COALESCE(t.name, 'מורה'),
        l.end_time,
        NOW() as server_now,
        l.is_locked
    FROM lessons l
    JOIN lesson_pre_assignments lpa ON lpa.lesson_id = l.id
    JOIN students s ON s.id = lpa.student_id
    LEFT JOIN teachers t ON t.id = l.teacher_id
    WHERE s.national_id = entered_id 
      AND l.status = 'active'
    ORDER BY l.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ── 5. הרשאות Row Level Security (RLS) ───────────────────────
ALTER TABLE student_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_pre_assignments   ENABLE ROW LEVEL SECURITY;

-- מדיניות פתוחה לבדיקות ופיתוח
CREATE POLICY "open_student_groups"           ON student_groups           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_student_group_members"     ON student_group_members     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_lesson_pre_assignments"   ON lesson_pre_assignments   FOR ALL USING (true) WITH CHECK (true);

-- הרשאת גישה של אנונימיים לעמודות הנדרשות
GRANT SELECT ON student_groups TO anon, authenticated;
GRANT SELECT ON student_group_members TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_pre_assignments TO anon, authenticated;
