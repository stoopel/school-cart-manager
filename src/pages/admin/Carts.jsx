import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function Carts() {
  const [carts, setCarts]         = useState([])
  const [devices, setDevices]     = useState([])
  const [selectedCart, setSelectedCart] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [showAddCart, setShowAddCart]   = useState(false)
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [cartForm, setCartForm]   = useState({ name: '', location: '', total_devices: '' })
  const [deviceForm, setDeviceForm] = useState({ device_number: '', asset_tag: '' })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => { loadCarts() }, [])
  useEffect(() => { if (selectedCart) loadDevices(selectedCart.id) }, [selectedCart])

  async function loadCarts() {
    setLoading(true)
    const { data } = await supabase.from('cart_status').select('*').order('name')
    setCarts(data ?? [])
    if (data?.length && !selectedCart) setSelectedCart(data[0])
    setLoading(false)
  }

  async function loadDevices(cartId) {
    const { data } = await supabase
      .from('devices').select(`
        *,
        device_loans!inner(id, student_id, checkout_at, checkin_at, status,
          students(name, class_name))
      `)
      .eq('cart_id', cartId)
      .order('device_number')

    // Get all devices including those without active loans
    const { data: allDevices } = await supabase
      .from('devices')
      .select('*')
      .eq('cart_id', cartId)
      .order('device_number')

    // Enrich with active loan info
    const { data: activeLoans } = await supabase
      .from('unreturned_loans')
      .select('*')
      .eq('cart_id', cartId)

    const loanMap = {}
    activeLoans?.forEach(l => { loanMap[l.device_id] = l })

    setDevices((allDevices ?? []).map(d => ({ ...d, activeLoan: loanMap[d.id] || null })))
  }

  async function addCart(e) {
    e.preventDefault(); setError(''); setSaving(true)
    const { error: err } = await supabase.from('carts').insert({
      name: cartForm.name.trim(),
      location: cartForm.location.trim(),
      total_devices: Number(cartForm.total_devices) || 0,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowAddCart(false)
    setCartForm({ name: '', location: '', total_devices: '' })
    loadCarts()
  }

  async function addDevice(e) {
    e.preventDefault(); setError(''); setSaving(true)
    const { error: err } = await supabase.from('devices').insert({
      cart_id: selectedCart.id,
      device_number: Number(deviceForm.device_number),
      asset_tag: deviceForm.asset_tag.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowAddDevice(false)
    setDeviceForm({ device_number: '', asset_tag: '' })
    loadDevices(selectedCart.id)
    loadCarts()
  }

  async function deleteDevice(id) {
    if (!confirm('למחוק מחשב זה?')) return
    await supabase.from('devices').delete().eq('id', id)
    loadDevices(selectedCart.id)
  }

  async function forceReturn(loanId) {
    if (!confirm('לסגור השאלה זו בכוח?')) return
    await supabase.from('device_loans').update({ status: 'force_closed', checkin_at: new Date().toISOString(), return_method: 'admin' }).eq('id', loanId)
    loadDevices(selectedCart.id)
    loadCarts()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">🛒 עגלות ומחשבים</h2>
        <p className="page-subtitle">ניהול עגלות וציוד</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Carts list */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>עגלות</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddCart(true)}>+ הוסף</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? <div className="loading-center"><div className="spinner" /></div> :
              carts.map(cart => (
                <div
                  key={cart.id}
                  className="card"
                  style={{
                    cursor: 'pointer', padding: '14px 16px',
                    borderColor: selectedCart?.id === cart.id ? 'var(--accent)' : undefined,
                    background: selectedCart?.id === cart.id ? 'var(--accent-glow)' : undefined,
                  }}
                  onClick={() => setSelectedCart(cart)}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{cart.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cart.location}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <span className="badge badge-success">{cart.available_devices ?? 0} זמין</span>
                    <span className="badge badge-warning">{cart.active_loans ?? 0} נלקח</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Devices */}
        <div>
          {selectedCart ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ fontWeight: 700 }}>{selectedCart.name} – מחשבים</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a href={`/station/${selectedCart.id}`} target="_blank" className="btn btn-ghost btn-sm" title="פתח את מסך העגלה לטאבלט">🔗 פתח עמדה</a>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowAddDevice(true)}>+ הוסף מחשב</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                {devices.map(dev => (
                  <div key={dev.id} className="card" style={{
                    padding: '16px',
                    borderColor: dev.activeLoan ? 'var(--warning)' : dev.status === 'offline' ? 'var(--danger)' : 'var(--border)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>#{dev.device_number}</div>
                      <span className={`badge ${dev.activeLoan ? 'badge-warning' : dev.status === 'offline' ? 'badge-danger' : 'badge-success'}`}>
                        {dev.activeLoan ? 'נלקח' : dev.status === 'offline' ? 'offline' : 'זמין'}
                      </span>
                    </div>
                    {dev.asset_tag && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{dev.asset_tag}</div>}
                    {dev.activeLoan && (
                      <div style={{ marginTop: 8, fontSize: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <div style={{ fontWeight: 600 }}>👤 {dev.activeLoan.student_name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{dev.activeLoan.class_name}</div>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 6, color: 'var(--danger-light)', fontSize: '0.7rem', padding: '3px 8px' }}
                          onClick={() => forceReturn(dev.activeLoan.loan_id)}
                        >סגור בכוח</button>
                      </div>
                    )}
                    {dev.battery_level && (
                      <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>🔋 {dev.battery_level}%</div>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, color: 'var(--danger-light)', fontSize: '0.7rem', width: '100%' }}
                      onClick={() => deleteDevice(dev.id)}
                    >🗑️ מחק</button>
                  </div>
                ))}
                {devices.length === 0 && (
                  <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                    <div className="empty-icon">🖥️</div>
                    <p>אין מחשבים רשומים בעגלה זו</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state"><div className="empty-icon">🛒</div><p>בחר עגלה מהרשימה</p></div>
          )}
        </div>
      </div>

      {/* Add Cart Modal */}
      {showAddCart && (
        <div className="modal-overlay" onClick={() => setShowAddCart(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">➕ הוסף עגלה</h3>
              <button className="modal-close" onClick={() => setShowAddCart(false)}>✕</button>
            </div>
            <form onSubmit={addCart}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">שם העגלה *</label>
                <input className="form-input" value={cartForm.name} onChange={e => setCartForm(f => ({ ...f, name: e.target.value }))} required placeholder="עגלה א" />
              </div>
              <div className="form-group">
                <label className="form-label">מיקום</label>
                <input className="form-input" value={cartForm.location} onChange={e => setCartForm(f => ({ ...f, location: e.target.value }))} placeholder="ספריה / קומה ב" />
              </div>
              <div className="form-group">
                <label className="form-label">מספר מחשבים</label>
                <input className="form-input" type="number" value={cartForm.total_devices} onChange={e => setCartForm(f => ({ ...f, total_devices: e.target.value }))} placeholder="38" />
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳...' : '✅ הוסף'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddCart(false)}>ביטול</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddDevice && selectedCart && (
        <div className="modal-overlay" onClick={() => setShowAddDevice(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">➕ הוסף מחשב ל{selectedCart.name}</h3>
              <button className="modal-close" onClick={() => setShowAddDevice(false)}>✕</button>
            </div>
            <form onSubmit={addDevice}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">מספר מחשב *</label>
                <input className="form-input" type="number" value={deviceForm.device_number} onChange={e => setDeviceForm(f => ({ ...f, device_number: e.target.value }))} required placeholder="1" min="1" />
              </div>
              <div className="form-group">
                <label className="form-label">מספר רכוש (Asset Tag)</label>
                <input className="form-input" value={deviceForm.asset_tag} onChange={e => setDeviceForm(f => ({ ...f, asset_tag: e.target.value }))} placeholder="SCH-001" />
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳...' : '✅ הוסף'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddDevice(false)}>ביטול</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
