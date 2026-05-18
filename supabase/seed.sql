-- נתוני דוגמה לבדיקה
INSERT INTO carts (name, location, total_devices) VALUES
  ('עגלה א', 'ספריה – קומה א', 38),
  ('עגלה ב', 'חדר מחשבים 101', 36),
  ('עגלה ג', 'אולם מדעים', 40)
ON CONFLICT DO NOTHING;

INSERT INTO students (national_id, name, class_name, grade) VALUES
  ('123456789', 'ישראל ישראלי', 'ח''2', 8),
  ('987654321', 'שרה כהן', 'ז''1', 7),
  ('111222333', 'דוד לוי', 'ט''3', 9),
  ('444555666', 'מרים אברהם', 'ח''2', 8),
  ('777888999', 'יוסף מזרחי', 'ז''1', 7)
ON CONFLICT DO NOTHING;
