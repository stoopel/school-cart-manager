# מדריך התקנת Cart Agent על מחשבי העגלה

## דרישות מוקדמות
- Python 3.11 ומעלה מותקן על המחשב
- חיבור אינטרנט (לצורך תקשורת עם Supabase)
- הרשאות Administrator

---

## שלב 1 – הכנת הקבצים

העתק את התיקייה `agent/` לכל מחשב, לדוגמה:
```
C:\CartAgent\
```

---

## שלב 2 – עריכת config.json

פתח את `config.json` ועדכן **רק** את השדה `asset_tag` לפי מדבקת המחשב:

```json
{
  "asset_tag": "A-001",        ← שנה לפי מספר המחשב (A-001, A-002, B-001, ...)
  "cart_name": "עגלה א",       ← שם העגלה
  "school_name": "...",
  ...
}
```

> **חשוב:** כל מחשב חייב להיות עם `asset_tag` שמופיע במדבקת ה-QR שלו.

---

## שלב 3 – בניית ה-.exe (פעם אחת בלבד)

הרץ כ-Administrator:
```
build.bat
```
יווצר הקובץ: `dist\cart_agent.exe`

---

## שלב 4 – התקנת שירות Windows

הרץ כ-Administrator:
```
install_service.bat
```

השירות `CartAgent` יותקן וירוץ אוטומטית בכל הפעלה של Windows.

---

## פקודות ניהול השירות

```bat
nssm start CartAgent      # הפעלה ידנית
nssm stop CartAgent       # עצירה
nssm restart CartAgent    # הפעלה מחדש
nssm remove CartAgent     # הסרה
```

---

## קוד אדמין לגישה מנהלית

אם צריך לגשת למחשב ללא ת.ז. (לצורך תחזוקה):
הקש את קוד האדמין שמוגדר ב-`config.json` בשדה `admin_code`.

---

## קבצי לוג

הלוג נמצא בנתיב:
```
C:\CartAgent\agent.log
```

---

## פתרון בעיות

| בעיה | פתרון |
|------|-------|
| מסך הנעילה לא מופיע | בדוק שהשירות CartAgent רץ (services.msc) |
| "מחשב אינו רשום להשאלה" | בדוק שה-asset_tag ב-config.json תואם למה שב-DB |
| שגיאת חיבור | בדוק חיבור אינטרנט + שה-supabase_key תקין |
| לוג מציג שגיאות | שלח את agent.log למנהל המערכת |
