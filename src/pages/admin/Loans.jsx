import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { format } from 'date-fns'

export default function Loans() {
  const [loans, setLoans]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState({ date: '', cart: '', status: '' })
  const [carts, setCarts]     = useState([])

  useEffect(() => {
    loadCarts()
    load()
  }, [])

  async function loadCarts() {
    const { data } = await supabase.from('carts').select('id, name').order('name')
    setCarts(data ?? [])
  }

  async function load() {
    setLoading(true)
    let q = supabase.from('device_loans').select(`
      id, checkout_at, checkin_at, status, checkout_method, digital_login_at,
      students(name, national_id, class_name),
      devices(device_number, carts(name))
    `).order('checkout_at', { ascending: false }).limit(500)

    if (filter.status) q = q.eq('status', filter.status)
    if (filter.date)   q = q.gte('checkout_at', filter.date + 'T00:00:00').lte('checkout_at', filter.date + 'T23:59:59')

    const { data } = await q
    setLoans(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  function fmt(ts) {
    if (!ts) return '—'
    return format(new Date(ts), 'dd/MM HH:mm')
  }

  function duration(from, to) {
    if (!from) return '—'
    const end = to ? new Date(to) : new Date()
    const mins = Math.floor((end - new Date(from)) / 60000)
    if (mins < 60) return `${mins} דק'`
    return `${Math.floor(mins/60)}ש' ${mins%60}ד'`
  }

  function exportExcel() {
    const rows = loans.map(l => ({
      'שם תלמיד':    l.students?.name ?? '',
      'תעודת זהות':  l.students?.national_id ?? '',
      'כיתה':        l.students?.class_name ?? '',
      'עגלה':        l.devices?.carts?.name ?? '',
      'מחשב':        l.devices?.device_number ?? '',
      'נלקח':        fmt(l.checkout_at),
      'הוחזר':       fmt(l.checkin_at),
      'משך':         duration(l.checkout_at, l.checkin_at),
      'סטטוס':       l.status,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'השאלות')
    XLSX.writeFile(wb, `השאלות_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }

  const statusLabel = { active: 'פעיל', returned: 'הוחזר', force_closed: 'נסגר בכוח' }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">📋 היסטוריית השאלות</h2>
        <p className="page-subtitle">{loans.length} רשומות</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <input
          type="date"
          className="form-input"
          style={{ maxWidth: 180 }}
          value={filter.date}
          onChange={e => setFilter(f => ({ ...f, date: e.target.value }))}
        />
        <select className="form-select" style={{ maxWidth: 180 }} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">כל הסטטוסים</option>
          <option value="active">פעיל</option>
          <option value="returned">הוחזר</option>
          <option value="force_closed">נסגר בכוח</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setFilter({ date: '', cart: '', status: '' })}>נקה</button>
        <button className="btn btn-success btn-sm" style={{ marginRight: 'auto' }} onClick={exportExcel}>📊 ייצא Excel</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : loans.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">📋</div><p>לא נמצאו השאלות</p></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>תלמיד</th>
                  <th>כיתה</th>
                  <th>עגלה</th>
                  <th>מחשב</th>
                  <th>נלקח</th>
                  <th>הוחזר</th>
                  <th>משך</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {loans.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.students?.name ?? '—'}</td>
                    <td><span className="badge badge-info">{l.students?.class_name ?? '—'}</span></td>
                    <td>{l.devices?.carts?.name ?? '—'}</td>
                    <td>מס' {l.devices?.device_number ?? '—'}</td>
                    <td className="text-muted">{fmt(l.checkout_at)}</td>
                    <td className="text-muted">{fmt(l.checkin_at)}</td>
                    <td>{duration(l.checkout_at, l.checkin_at)}</td>
                    <td>
                      <span className={`badge ${l.status === 'returned' ? 'badge-success' : l.status === 'active' ? 'badge-warning' : 'badge-danger'}`}>
                        {statusLabel[l.status] ?? l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
