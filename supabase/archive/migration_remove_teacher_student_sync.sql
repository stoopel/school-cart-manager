-- ============================================================
-- migration_remove_teacher_student_sync.sql
-- הסרת סנכרון כפול של מורים לטבלת תלמידים, ניקוי רשומות המורים ושיפור RPC
-- ============================================================

-- 1. הסרת הטריגרים הישנים שסנכרנו מורים לתלמידים וחסמו מחיקה
DROP TRIGGER IF EXISTS trg_sync_teacher_to_student ON public.teachers;
DROP FUNCTION IF EXISTS public.sync_teacher_to_student();

DROP TRIGGER IF EXISTS trg_protect_teacher_student_delete ON public.students;
DROP FUNCTION IF EXISTS public.protect_teacher_student_delete();

-- 2. ניקוי שיוך תלמידים בטבלאות מקושרות עבור רשומות מורים ישנות (למניעת שגיאות Foreign Key)
UPDATE public.device_loans
SET student_id = NULL
WHERE student_id IN (
    SELECT id FROM public.students
    WHERE grade = 99 OR class_name = 'מורה'
);

DELETE FROM public.student_group_members
WHERE student_id IN (
    SELECT id FROM public.students
    WHERE grade = 99 OR class_name = 'מורה'
);

DELETE FROM public.lesson_participants
WHERE student_id IN (
    SELECT id FROM public.students
    WHERE grade = 99 OR class_name = 'מורה'
);

DELETE FROM public.lesson_pre_assignments
WHERE student_id IN (
    SELECT id FROM public.students
    WHERE grade = 99 OR class_name = 'מורה'
);

-- 3. מחיקת רשומות המורים המיותרות מטבלת התלמידים
DELETE FROM public.students
WHERE grade = 99 OR class_name = 'מורה';

-- 4. שדרוג פונקציית אימות מורה (verify_teacher_id) לתמיכה מלאה בריפוד / נרמול אפסים
CREATE OR REPLACE FUNCTION public.verify_teacher_id(entered_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    teacher_record RECORD;
    trimmed_id TEXT;
    cleaned_input TEXT;
BEGIN
    trimmed_id := TRIM(entered_id);
    cleaned_input := LTRIM(trimmed_id, '0');

    SELECT id, name, is_active, national_id FROM public.teachers
    WHERE (
        national_id = trimmed_id
        OR (cleaned_input <> '' AND LTRIM(national_id, '0') = cleaned_input)
        OR (trimmed_id <> '' AND LPAD(LTRIM(national_id, '0'), 9, '0') = LPAD(cleaned_input, 9, '0'))
    )
    AND is_active = true
    LIMIT 1
    INTO teacher_record;

    IF teacher_record.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'is_valid', true,
            'teacher_id', teacher_record.id,
            'teacher_name', teacher_record.name,
            'national_id', teacher_record.national_id
        );
    ELSE
        RETURN jsonb_build_object(
            'is_valid', false
        );
    END IF;
END;
$$;

-- 5. שדרוג פונקציית יצירת קבוצת מורה (secure_create_teacher_group) לנרמול תעודת זהות
CREATE OR REPLACE FUNCTION public.secure_create_teacher_group(entered_teacher_id TEXT, group_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    new_group_id UUID;
    random_num TEXT;
    trimmed_id TEXT;
    clean_id TEXT;
BEGIN
    trimmed_id := TRIM(entered_teacher_id);
    clean_id := LTRIM(trimmed_id, '0');

    SELECT id FROM public.teachers 
    WHERE (
        national_id = trimmed_id
        OR (clean_id <> '' AND LTRIM(national_id, '0') = clean_id)
        OR (trimmed_id <> '' AND LPAD(LTRIM(national_id, '0'), 9, '0') = LPAD(clean_id, 9, '0'))
    )
    AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    LOOP
        random_num := 'G-' || floor(random() * 90000 + 10000)::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM student_groups WHERE group_number = random_num);
    END LOOP;

    INSERT INTO student_groups (name, teacher_id, created_by_teacher_id, group_number)
    VALUES (group_name, res_teacher_id, res_teacher_id, random_num)
    RETURNING id INTO new_group_id;

    RETURN jsonb_build_object('success', true, 'group_id', new_group_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'קבוצה בשם זה כבר קיימת בבית הספר. בחר שם אחר.');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 6. שדרוג פונקציית מחיקת קבוצת מורה (secure_delete_teacher_group) לנרמול תעודת זהות
CREATE OR REPLACE FUNCTION public.secure_delete_teacher_group(entered_teacher_id TEXT, target_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    group_record RECORD;
    trimmed_id TEXT;
    clean_id TEXT;
BEGIN
    trimmed_id := TRIM(entered_teacher_id);
    clean_id := LTRIM(trimmed_id, '0');

    SELECT id FROM public.teachers 
    WHERE (
        national_id = trimmed_id
        OR (clean_id <> '' AND LTRIM(national_id, '0') = clean_id)
        OR (trimmed_id <> '' AND LPAD(LTRIM(national_id, '0'), 9, '0') = LPAD(clean_id, 9, '0'))
    )
    AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    SELECT teacher_id, created_by_teacher_id FROM student_groups 
    WHERE id = target_group_id INTO group_record;

    IF group_record.teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'הקבוצה לא נמצאה במערכת');
    END IF;

    IF group_record.teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה לנהל או למחוק קבוצה זו מכיוון שאינך מוגדר כמורה שלה כעת.');
    END IF;

    IF group_record.created_by_teacher_id IS NULL OR group_record.created_by_teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה למחוק קבוצה זו מכיוון שלא אתה יצרת אותה, אך באפשרותך לערוך את תלמידיה.');
    END IF;

    DELETE FROM student_groups WHERE id = target_group_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 7. שדרוג פונקציית עדכון חברי קבוצה (secure_set_group_members) לנרמול תעודת זהות
CREATE OR REPLACE FUNCTION public.secure_set_group_members(entered_teacher_id TEXT, target_group_id UUID, student_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    s_id UUID;
    trimmed_id TEXT;
    clean_id TEXT;
BEGIN
    trimmed_id := TRIM(entered_teacher_id);
    clean_id := LTRIM(trimmed_id, '0');

    SELECT id FROM public.teachers 
    WHERE (
        national_id = trimmed_id
        OR (clean_id <> '' AND LTRIM(national_id, '0') = clean_id)
        OR (trimmed_id <> '' AND LPAD(LTRIM(national_id, '0'), 9, '0') = LPAD(clean_id, 9, '0'))
    )
    AND is_active = true 
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM student_groups WHERE id = target_group_id AND teacher_id = res_teacher_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'קבוצה זו אינה שייכת למורה הנוכחי או שלא נמצאה');
    END IF;

    DELETE FROM student_group_members WHERE group_id = target_group_id;

    FOREACH s_id IN ARRAY student_ids LOOP
        IF s_id IS NOT NULL THEN
            INSERT INTO student_group_members (group_id, student_id)
            VALUES (target_group_id, s_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 8. שדרוג פונקציית איתור שיעור משויך מראש (get_pre_assigned_active_lesson) לנרמול תעודת זהות
CREATE OR REPLACE FUNCTION public.get_pre_assigned_active_lesson(entered_id TEXT)
RETURNS TABLE(lesson_id UUID, lesson_code TEXT, subject TEXT, teacher_name TEXT, end_time TIMESTAMP WITH TIME ZONE, server_now TIMESTAMP WITH TIME ZONE, is_locked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    trimmed_id TEXT;
    clean_id TEXT;
BEGIN
    trimmed_id := TRIM(entered_id);
    clean_id := LTRIM(trimmed_id, '0');

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
    WHERE (
        s.national_id = trimmed_id 
        OR (clean_id <> '' AND LTRIM(s.national_id, '0') = clean_id)
        OR (trimmed_id <> '' AND LPAD(LTRIM(s.national_id, '0'), 9, '0') = LPAD(clean_id, 9, '0'))
    )
      AND l.status = 'active'
    ORDER BY l.created_at DESC;
END;
$$;

-- 9. הגדרת הרשאות הרצה לפונקציות השרת
GRANT EXECUTE ON FUNCTION public.verify_teacher_id(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.secure_create_teacher_group(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.secure_delete_teacher_group(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.secure_set_group_members(TEXT, UUID, UUID[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pre_assigned_active_lesson(TEXT) TO anon, authenticated, service_role;
