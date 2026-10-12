-- ============================================================
-- migration_teacher_sync_triggers.sql
-- סנכרון אוטומטי של מורים לטבלת סטודנטים + ריפוד ת.ז ל-9 ספרות
-- ============================================================

-- ── 1. טריגר ריפוד אוטומטי של תעודות זהות ל-9 ספרות בטבלת הסטודנטים ──
CREATE OR REPLACE FUNCTION public.clean_student_national_id()
RETURNS TRIGGER AS $$
BEGIN
    -- ריפוד תעודת הזהות באפסים מובילים משמאל עד להגעה ל-9 ספרות
    NEW.national_id := lpad(NEW.national_id, 9, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clean_student_national_id ON public.students;
CREATE TRIGGER trg_clean_student_national_id
BEFORE INSERT OR UPDATE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.clean_student_national_id();


-- ── 2. טריגר סנכרון אוטומטי מטבלת המורים לטבלת הסטודנטים ──
CREATE OR REPLACE FUNCTION public.sync_teacher_to_student()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        -- אם המורה פעיל, נוסיף אותו לסטודנטים (הטריגר של students כבר ירפד אותו ל-9 ספרות)
        IF NEW.is_active = true THEN
            INSERT INTO public.students (national_id, name, class_name, grade)
            VALUES (NEW.national_id, NEW.name, 'מורה', 99)
            ON CONFLICT (national_id) DO UPDATE 
            SET name = EXCLUDED.name, class_name = 'מורה';
        END IF;
        RETURN NEW;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        -- אם המורה עודכן והוא פעיל
        IF NEW.is_active = true THEN
            INSERT INTO public.students (national_id, name, class_name, grade)
            VALUES (NEW.national_id, NEW.name, 'מורה', 99)
            ON CONFLICT (national_id) DO UPDATE 
            SET name = EXCLUDED.name, class_name = 'מורה';
        -- אם המורה הושבת (is_active = false), נסיר אותו מטבלת הסטודנטים כדי לחסום לקיחת מחשב
        ELSE
            DELETE FROM public.students 
            WHERE lpad(national_id, 9, '0') = lpad(OLD.national_id, 9, '0');
        END IF;
        RETURN NEW;
        
    ELSIF (TG_OP = 'DELETE') THEN
        -- אם המורה נמחק, נסיר אותו אוטומטית מטבלת הסטודנטים
        DELETE FROM public.students 
        WHERE lpad(national_id, 9, '0') = lpad(OLD.national_id, 9, '0');
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_teacher_to_student ON public.teachers;
CREATE TRIGGER trg_sync_teacher_to_student
AFTER INSERT OR UPDATE OR DELETE ON public.teachers
FOR EACH ROW
EXECUTE FUNCTION public.sync_teacher_to_student();


-- ── 3. טריגר הגנה מפני מחיקה ידנית שגויה של מורה מטבלת הסטודנטים ──
CREATE OR REPLACE FUNCTION public.protect_teacher_student_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- אם מנסים למחוק רשומה שהיא 'מורה' מתוך רשימת התלמידים
    IF OLD.class_name = 'מורה' THEN
        -- נבדוק האם המורה עדיין קיים בטבלת המורים והוא עדיין פעיל (is_active = true)
        IF EXISTS (
            SELECT 1 FROM public.teachers 
            WHERE lpad(national_id, 9, '0') = lpad(OLD.national_id, 9, '0')
              AND is_active = true
        ) THEN
            -- נחסום את המחיקה עם הודעת שגיאה ברורה
            RAISE EXCEPTION 'אי אפשר למחוק מורה מרשימת התלמידים. יש לבצע את המחיקה אך ורק דרך ניהול המורים.';
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_teacher_student_delete ON public.students;
CREATE TRIGGER trg_protect_teacher_student_delete
BEFORE DELETE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.protect_teacher_student_delete();


-- ── 4. ריפוד חד-פעמי ראשוני של כל תעודות הזהות של התלמידים הקיימים ──
UPDATE public.students 
SET national_id = lpad(national_id, 9, '0')
WHERE length(national_id) < 9;


-- ── 5. סנכרון חד-פעמי ראשוני של כל המורים הפעילים הקיימים כיום ──
INSERT INTO public.students (national_id, name, class_name, grade)
SELECT national_id, name, 'מורה', 99
FROM public.teachers
WHERE is_active = true
ON CONFLICT (national_id) DO UPDATE 
SET name = EXCLUDED.name, class_name = 'מורה';
