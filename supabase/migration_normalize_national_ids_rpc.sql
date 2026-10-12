-- ============================================================
-- migration_normalize_national_ids_rpc.sql
-- תמיכה גמישה בנרמול תעודות זהות (כולל אפסים מובילים) בכל פונקציות ה-RPC
-- ============================================================

-- 1. יצירת קבוצה עם נרמול תעודת זהות מורה
CREATE OR REPLACE FUNCTION secure_create_teacher_group(entered_teacher_id TEXT, group_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    new_group_id UUID;
    random_num TEXT;
BEGIN
    -- שליפת מזהה מורה לפי תעודת זהות מנורמלת ואימות שהוא פעיל
    SELECT id FROM teachers
    WHERE (
        national_id = entered_teacher_id
        OR LTRIM(national_id, '0') = LTRIM(entered_teacher_id, '0')
        OR LPAD(national_id, 9, '0') = LPAD(entered_teacher_id, 9, '0')
    )
    AND is_active = true
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    -- ייצור קוד קבוצה ייחודי ואקראי למניעת התנגשויות (group_number)
    LOOP
        random_num := 'G-' || floor(random() * 90000 + 10000)::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM student_groups WHERE group_number = random_num);
    END LOOP;

    -- הכנסת הקבוצה החדשה
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

-- 2. מחיקת קבוצה עם נרמול תעודת זהות מורה
CREATE OR REPLACE FUNCTION secure_delete_teacher_group(entered_teacher_id TEXT, target_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    group_record RECORD;
BEGIN
    -- שליפת מזהה מורה לפי תעודת זהות מנורמלת ואימות שהוא פעיל
    SELECT id FROM teachers
    WHERE (
        national_id = entered_teacher_id
        OR LTRIM(national_id, '0') = LTRIM(entered_teacher_id, '0')
        OR LPAD(national_id, 9, '0') = LPAD(entered_teacher_id, 9, '0')
    )
    AND is_active = true
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל במערכת');
    END IF;

    -- שליפת הקבוצה הנוכחית לבדיקת בעלות ויוצר
    SELECT teacher_id, created_by_teacher_id FROM student_groups 
    WHERE id = target_group_id INTO group_record;

    IF group_record.teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'הקבוצה לא נמצאה במערכת');
    END IF;

    -- אימות שהמורה המוחק הוא המורה האחראי על הקבוצה כעת
    IF group_record.teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה לנהל או למחוק קבוצה זו מכיוון שאינך מוגדר כמורה שלה כעת.');
    END IF;

    -- בדיקת הרשאת מחיקה (רק היוצר יכול למחוק!)
    IF group_record.created_by_teacher_id IS NULL OR group_record.created_by_teacher_id != res_teacher_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'אין לך הרשאה למחוק קבוצה זו מכיוון שלא אתה יצרת אותה, אך באפשרותך לערוך את תלמידיה.');
    END IF;

    -- ביצוע מחיקה
    DELETE FROM student_groups WHERE id = target_group_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. עדכון חברי קבוצה עם נרמול תעודת זהות מורה
CREATE OR REPLACE FUNCTION secure_set_group_members(entered_teacher_id TEXT, target_group_id UUID, student_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    s_id UUID;
BEGIN
    -- שליפת מזהה מורה לפי תעודת זהות מנורמלת ואימות שהוא פעיל
    SELECT id FROM teachers
    WHERE (
        national_id = entered_teacher_id
        OR LTRIM(national_id, '0') = LTRIM(entered_teacher_id, '0')
        OR LPAD(national_id, 9, '0') = LPAD(entered_teacher_id, 9, '0')
    )
    AND is_active = true
    LIMIT 1
    INTO res_teacher_id;

    IF res_teacher_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'מורה לא נמצא או אינו פעיל');
    END IF;

    -- אימות שהקבוצה שייכת (או מוקצת) למורה המבצע
    IF NOT EXISTS (SELECT 1 FROM student_groups WHERE id = target_group_id AND teacher_id = res_teacher_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'קבוצה זו אינה שייכת למורה הנוכחי או שלא נמצאה');
    END IF;

    -- מחיקת חברי הקבוצה הקודמים
    DELETE FROM student_group_members WHERE group_id = target_group_id;

    -- הכנסת חברי הקבוצה החדשים
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

-- 4. שיוך תלמידים מראש עם נרמול תעודת זהות מורה
CREATE OR REPLACE FUNCTION secure_pre_assign_students(
    entered_teacher_id TEXT,
    target_lesson_id UUID,
    student_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    is_valid_teacher BOOLEAN;
BEGIN
    -- אימות זהות המורה מול טבלת המורים עם נרמול אפסים מובילים
    SELECT EXISTS (
        SELECT 1 FROM teachers
        WHERE (
            national_id = entered_teacher_id
            OR LTRIM(national_id, '0') = LTRIM(entered_teacher_id, '0')
            OR LPAD(national_id, 9, '0') = LPAD(entered_teacher_id, 9, '0')
        )
        AND is_active = true
    ) INTO is_valid_teacher;

    IF NOT is_valid_teacher THEN
        RAISE EXCEPTION 'Unauthorized: Invalid teacher credentials';
    END IF;

    -- ניקוי שיוכים קודמים עבור שיעור זה (מניעת כפילויות)
    DELETE FROM lesson_pre_assignments
    WHERE lesson_id = target_lesson_id;

    -- הכנסת השיוכים החדשים
    IF array_length(student_ids, 1) > 0 THEN
        INSERT INTO lesson_pre_assignments (lesson_id, student_id)
        SELECT target_lesson_id, unnest(student_ids);
    END IF;

    RETURN true;
END;
$$;

-- 5. שליפת שיעור משובץ עם נרמול תעודת זהות תלמיד
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
    WHERE (
        s.national_id = entered_id 
        OR LTRIM(s.national_id, '0') = LTRIM(entered_id, '0')
        OR LPAD(s.national_id, 9, '0') = LPAD(entered_id, 9, '0')
    )
    AND l.status = 'active'
    ORDER BY l.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 6. הרשאות ביצוע
GRANT EXECUTE ON FUNCTION secure_create_teacher_group(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_delete_teacher_group(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_set_group_members(TEXT, UUID, UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_pre_assign_students(TEXT, UUID, UUID[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_pre_assigned_active_lesson(TEXT) TO anon, authenticated;
