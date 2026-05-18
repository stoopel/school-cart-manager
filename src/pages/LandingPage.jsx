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
    </div>
  )
}
