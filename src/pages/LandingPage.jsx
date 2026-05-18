import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function LandingPage() {
  const cards = [
    {
      title: 'עמדת תלמידים',
      desc: 'השאלת והחזרת מחשבים על ידי תלמידים',
      icon: '🛒',
      link: '/station',
      color: '#22c55e',
      bg: 'rgba(34,197,94,0.1)',
      border: 'rgba(34,197,94,0.3)',
    },
    {
      title: 'פורטל מורים',
      desc: 'ניהול שיעורים חכמים ונעילת מסכים',
      icon: '👨‍🏫',
      link: '/teacher',
      color: '#6366f1',
      bg: 'rgba(99,102,241,0.1)',
      border: 'rgba(99,102,241,0.3)',
    },
    {
      title: 'ממשק ניהול',
      desc: 'ניהול עגלות, תלמידים והגדרות מערכת',
      icon: '⚙️',
      link: '/admin',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)',
      border: 'rgba(245,158,11,0.3)',
    }
  ]

  const [showDocs, setShowDocs] = useState(false)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#060d1f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Heebo, sans-serif',
      direction: 'rtl',
      padding: 24,
    }}>
      <div style={{ textAlign: 'center', marginBottom: 60 }}>
        <h1 style={{ color: '#f1f5f9', fontSize: '2.5rem', marginBottom: 12 }}>מערכת עגלות מחשבים</h1>
        <p style={{ color: '#94a3b8', fontSize: '1.2rem', margin: 0 }}>אנא בחר את הממשק אליו תרצה להיכנס</p>
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 30,
        justifyContent: 'center',
        maxWidth: 1000,
      }}>
        {cards.map(c => (
          <Link
            key={c.link}
            to={c.link}
            style={{
              textDecoration: 'none',
              background: '#0d1526',
              border: `2px solid ${c.border}`,
              borderRadius: 24,
              padding: 40,
              width: 300,
              textAlign: 'center',
              transition: 'all 0.2s',
              boxShadow: `0 8px 32px ${c.bg}`,
              cursor: 'pointer',
            }}
            onMouseOver={e => e.currentTarget.style.transform = 'translateY(-5px)'}
            onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <div style={{ fontSize: '4rem', marginBottom: 20 }}>{c.icon}</div>
            <h2 style={{ color: c.color, margin: '0 0 12px 0', fontSize: '1.8rem' }}>{c.title}</h2>
            <p style={{ color: '#94a3b8', fontSize: '1rem', margin: 0, lineHeight: 1.5 }}>{c.desc}</p>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 60 }}>
        <button 
          onClick={() => setShowDocs(true)}
          style={{
            background: 'transparent',
            border: '1px solid #475569',
            color: '#cbd5e1',
            padding: '10px 24px',
            borderRadius: '20px',
            cursor: 'pointer',
            fontSize: '1rem',
            fontFamily: 'inherit',
            transition: 'all 0.2s'
          }}
          onMouseOver={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.color = '#fff' }}
          onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#cbd5e1' }}
        >
          📖 הוראות שימוש במערכת
        </button>
      </div>

      {showDocs && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(2, 6, 23, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20
        }} onClick={() => setShowDocs(false)}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 24,
            padding: '40px',
            maxWidth: 800,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            position: 'relative',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setShowDocs(false)}
              style={{
                position: 'absolute', top: 24, left: 24,
                background: 'transparent', border: 'none', color: '#94a3b8',
                fontSize: '1.5rem', cursor: 'pointer'
              }}
            >✕</button>
            
            <h2 style={{ color: '#f8fafc', fontSize: '2rem', marginTop: 0, marginBottom: 8 }}>איך זה עובד?</h2>
            <p style={{ color: '#94a3b8', marginBottom: 32 }}>מדריך קצר למשתמשי המערכת</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ background: '#1e293b', padding: 24, borderRadius: 16 }}>
                <h3 style={{ color: '#22c55e', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🛒</span> עמדת תלמידים (לקיחה והחזרה)
                </h3>
                <ul style={{ color: '#cbd5e1', paddingRight: 20, margin: 0, lineHeight: 1.6 }}>
                  <li><strong>לקיחת מחשב:</strong> התלמיד ניגש לטאבלט שעל העגלה, בוחר "לקחתי מחשב", ומקליד את תעודת הזהות שלו. לאחר מכן הוא יכול לסרוק את ה-QR שעל המחשב או להקליד את מספרו כדי לשייך אותו אליו.</li>
                  <li><strong>החזרת מחשב:</strong> התלמיד בוחר "החזרתי מחשב" וסורק שוב את ה-QR (או מקליד את המספר). המערכת מוודאת שהמחשב הוחזר ומזכירה לתלמיד באנימציה בולטת <strong>לחבר את המחשב לחשמל!</strong></li>
                </ul>
              </div>

              <div style={{ background: '#1e293b', padding: 24, borderRadius: 16 }}>
                <h3 style={{ color: '#6366f1', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>👨‍🏫</span> פורטל מורים (ניהול שיעור)
                </h3>
                <ul style={{ color: '#cbd5e1', paddingRight: 20, margin: 0, lineHeight: 1.6 }}>
                  <li>המורה נכנס לפורטל, מתחבר, ויכול לפתוח שיעור חדש.</li>
                  <li>במסך השיעור ניתן לראות בזמן אמת איזה תלמיד לקח איזה מחשב, ומי עדיין לא החזיר.</li>
                  <li><strong>נעילת מסכים:</strong> בלחיצת כפתור אחת, המורה יכול לנעול את כל המסכים של התלמידים בכיתה כדי לרכז את תשומת הלב, ולשחרר אותם כשיסיים.</li>
                </ul>
              </div>

              <div style={{ background: '#1e293b', padding: 24, borderRadius: 16 }}>
                <h3 style={{ color: '#f59e0b', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚙️</span> ממשק ניהול
                </h3>
                <ul style={{ color: '#cbd5e1', paddingRight: 20, margin: 0, lineHeight: 1.6 }}>
                  <li><strong>דאשבורד:</strong> תמונת מצב חיה של כל העגלות, כמות המחשבים הזמינים, ואילו מחשבים נמצאים עם סוללה חלשה (שכחו להטעין).</li>
                  <li><strong>ניהול עגלות:</strong> יצירה ועריכה של עגלות ומחשבים. לכל עגלה ניתן לתת "שם תצוגה" שיופיע על המדבקות (למשל "כיתה ט1").</li>
                  <li><strong>הדפסת מדבקות:</strong> המערכת מייצרת דפי מדבקות מוכנים להדפסה עם ברקודים לכל מחשב.</li>
                  <li><strong>היסטוריית השאלות:</strong> תיעוד מלא של מי לקח איזה מחשב, מתי, ולכמה זמן, כולל אפשרות ייצוא ל-Excel.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
