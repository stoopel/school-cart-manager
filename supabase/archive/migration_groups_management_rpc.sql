-- ============================================================
-- migration_groups_management_rpc.sql
-- פונקציות מאובטחות לניהול קבוצות לימוד ותלמידים על ידי המורים (גרסה מאובטחת ומורחבת)
-- ============================================================

-- 1. הרחבת טבלת student_groups עם עמודת יוצר הקבוצה
ALTER TABLE student_groups 
ADD COLUMN IF NOT EXISTS created_by_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;

-- 2. פונקציה ליצירת קבוצה חדשה המשוייכת אוטומטית למורה הן כיוצר והן כאחראי
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
    -- שליפת מזהה מורה לפי תעודת זהות ואימות שהוא פעיל
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

-- 3. פונקציה למחיקת קבוצה אך ורק אם המורה המוחק הוא זה שיצר אותה בפועל והוא המורה האחראי עליה כעת
CREATE OR REPLACE FUNCTION secure_delete_teacher_group(entered_teacher_id TEXT, target_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    group_record RECORD;
BEGIN
    -- שליפת מזהה מורה לפי תעודת זהות ואימות שהוא פעיל
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


-- 4. פונקציה לשיוך/עדכון של רשימת התלמידים בקבוצה (מותר לכל מורה שאחראי על הקבוצה)
CREATE OR REPLACE FUNCTION secure_set_group_members(entered_teacher_id TEXT, target_group_id UUID, student_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    res_teacher_id UUID;
    s_id UUID;
BEGIN
    -- שליפת מזהה מורה לפי תעודת זהות ואימות שהוא פעיל
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

-- 5. הענקת הרשאות הרצה לתפקידים הנדרשים
GRANT EXECUTE ON FUNCTION secure_create_teacher_group(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_delete_teacher_group(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_set_group_members(TEXT, UUID, UUID[]) TO anon, authenticated;
