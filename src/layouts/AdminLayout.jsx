import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV_MANAGE = [
  { label: 'דשבורד',           icon: '📊', to: '/admin/dashboard' },
  { label: 'תלמידים',           icon: '👥', to: '/admin/students' },
  { label: 'עגלות ומחשבים',    icon: '🖥️', to: '/admin/carts' },
  { label: 'היסטוריית השאלות',  icon: '📋', to: '/admin/loans' },
  { label: 'הדפסת תוויות QR',   icon: '🖨️', to: '/admin/labels' },
  { label: 'מנהלים מורשים',     icon: '🛡️', to: '/admin/admins' },
  { label: 'ייבוא נתונים',       icon: '📥', to: '/admin/import' },
]

const NAV_CLASS = [
  { label: 'שיעורים',  icon: '📚', to: '/admin/lessons' },
  { label: 'מורים',    icon: '👩‍🏫', to: '/admin/teachers' },
]

export default function AdminLayout() {
  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>🏫 ניהול עגלות</h1>
          <span>מחשבים בית ספריים</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">ניהול</div>
          {NAV_MANAGE.map(item => (
            <NavLink
              key={item.to} to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          <div className="nav-section-label" style={{ marginTop: 16 }}>ניהול כיתה</div>
          {NAV_CLASS.map(item => (
            <NavLink
              key={item.to} to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          <div className="nav-section-label" style={{ marginTop: 16 }}>תחנות</div>
          <a className="nav-item" href="/station" target="_blank" rel="noreferrer">
            <span className="nav-icon">📱</span>
            פתח תחנת עגלה
          </a>
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <button 
            onClick={() => supabase.auth.signOut()} 
            style={{
              width: '100%',
              padding: '10px 0',
              background: 'rgba(239,68,68,0.1)',
              color: '#fca5a5',
              border: 'none',
              borderRadius: 10,
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontFamily: 'Heebo, sans-serif'
            }}
          >
            🔒 התנתק
          </button>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            גרסה 1.0.0
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
