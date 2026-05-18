-- תיקון נתוני דוגמה עם UTF-8 תקין
UPDATE carts SET name = N'עגלה א', location = N'ספריה – קומה א' WHERE asset_tag IS NULL AND id = '14a68b75-5a0d-4b00-af16-7e6fee481658';
UPDATE carts SET name = N'עגלה ב', location = N'חדר מחשבים 101'  WHERE id = 'ff80f18d-e0fa-4938-823e-a49bf9f8e780';
UPDATE carts SET name = N'עגלה ג', location = N'אולם מדעים'       WHERE id = 'd01cfd1d-aba7-4195-816c-eb7fe193aa6c';

UPDATE students SET name = N'ישראל ישראלי', class_name = N'ח2' WHERE national_id = '123456789';
UPDATE students SET name = N'שרה כהן',      class_name = N'ז1' WHERE national_id = '987654321';
UPDATE students SET name = N'דוד לוי',      class_name = N'ט3' WHERE national_id = '111222333';
UPDATE students SET name = N'מרים אברהם',   class_name = N'ח2' WHERE national_id = '444555666';
UPDATE students SET name = N'יוסף מזרחי',   class_name = N'ז1' WHERE national_id = '777888999';
