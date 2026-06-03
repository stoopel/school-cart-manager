import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AdminLayout from './layouts/AdminLayout'
import Dashboard   from './pages/admin/Dashboard'
import Students    from './pages/admin/Students'
import Teachers    from './pages/admin/Teachers'
import Lessons     from './pages/admin/Lessons'
import Carts       from './pages/admin/Carts'
import Loans       from './pages/admin/Loans'
import Labels      from './pages/admin/Labels'
import StationHome from './pages/station/StationHome'
import TeacherApp  from './pages/teacher/TeacherApp'
import TeacherAppPremium from './pages/teacher/TeacherAppPremium'
import LandingPage from './pages/LandingPage'
import AdminLogin  from './components/AdminLogin'
import AllowedAdmins from './pages/admin/AllowedAdmins'
import ImportCenter from './pages/admin/ImportCenter'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* עמוד ראשי (Landing Page) */}
        <Route path="/" element={<LandingPage />} />

        {/* ממשק ניהול (מוגן בסיסמה) */}
        <Route path="/admin" element={<AdminLogin><AdminLayout /></AdminLogin>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="students"  element={<Students />} />
          <Route path="teachers"  element={<Teachers />} />
          <Route path="lessons"   element={<Lessons />} />
          <Route path="carts"     element={<Carts />} />
          <Route path="loans"     element={<Loans />} />
          <Route path="labels"    element={<Labels />} />
          <Route path="admins"    element={<AllowedAdmins />} />
          <Route path="import"    element={<ImportCenter />} />
        </Route>

        {/* תחנת עגלה – Kiosk */}
        <Route path="/station/:cartId" element={<StationHome />} />
        <Route path="/station"         element={<StationHome />} />

        {/* פורטל מורים */}
        <Route path="/teacher" element={<TeacherAppPremium />} />
        <Route path="/teacher-legacy" element={<TeacherApp />} />

        {/* ברירת מחדל */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
