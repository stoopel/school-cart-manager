-- Migration: Step 5 - Recurring Weekly Lessons & Admin Approval
-- Table: recurring_lesson_rules

CREATE TABLE IF NOT EXISTS public.recurring_lesson_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    cart_id UUID REFERENCES public.carts(id) ON DELETE SET NULL,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    period_id UUID NOT NULL REFERENCES public.school_periods(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    class_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.recurring_lesson_rules ENABLE ROW LEVEL SECURITY;

-- Drop previous policies if any
DROP POLICY IF EXISTS "recurring_rules_admin" ON public.recurring_lesson_rules;
DROP POLICY IF EXISTS "recurring_rules_select_anon" ON public.recurring_lesson_rules;
DROP POLICY IF EXISTS "recurring_rules_insert_anon" ON public.recurring_lesson_rules;

-- 1. Full access for authenticated admins
CREATE POLICY "recurring_rules_admin" ON public.recurring_lesson_rules
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- 2. Read access for anonymous users (teachers, kiosk, matrix explorer)
CREATE POLICY "recurring_rules_select_anon" ON public.recurring_lesson_rules
    FOR SELECT TO anon
    USING (true);

-- 3. Teachers / anonymous can insert requests (defaults to status = 'pending')
CREATE POLICY "recurring_rules_insert_anon" ON public.recurring_lesson_rules
    FOR INSERT TO anon
    WITH CHECK (true);

-- Collision Prevention Index:
-- No two approved, active recurring rules can claim the same cart during the same day_of_week and period_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_approved_recurring_cart
ON public.recurring_lesson_rules (cart_id, day_of_week, period_id)
WHERE (is_active = true AND status = 'approved' AND cart_id IS NOT NULL);

-- Index for fast lookup by day_of_week and cart_id
CREATE INDEX IF NOT EXISTS idx_recurring_rules_day_cart
ON public.recurring_lesson_rules (day_of_week, cart_id)
WHERE (is_active = true);

-- Helper view for rich queries
CREATE OR REPLACE VIEW public.recurring_lessons_overview AS
SELECT
    r.id,
    r.teacher_id,
    t.name AS teacher_name,
    t.id_last4 AS teacher_id_last4,
    r.cart_id,
    c.name AS cart_name,
    c.display_name AS cart_display_name,
    r.day_of_week,
    r.period_id,
    p.period_number,
    p.name AS period_name,
    p.start_time,
    p.end_time,
    r.subject,
    r.class_name,
    r.status,
    r.is_active,
    r.admin_notes,
    r.created_at,
    r.updated_at
FROM public.recurring_lesson_rules r
LEFT JOIN public.teachers t ON t.id = r.teacher_id
LEFT JOIN public.carts c ON c.id = r.cart_id
LEFT JOIN public.school_periods p ON p.id = r.period_id;

GRANT SELECT ON public.recurring_lessons_overview TO anon, authenticated;
