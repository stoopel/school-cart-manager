import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function Carts() {
  const [carts, setCarts]         = useState([])
  const [deletedCarts, setDeletedCarts] = useState([])
  const [viewDeleted, setViewDeleted] = useState(false)
  const [devices, setDevices]     = useState([])
  const [selectedCart, setSelectedCart] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [showAddCart, setShowAddCart]   = useState(false)
  const [showEditCart, setShowEditCart] = useState(false)
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [cartForm, setCartForm]   = useState({ id: '', name: '', display_name: '', location: '', total_devices: '', kiosk_code: '' })
  const [deviceForm, setDeviceForm] = useState({ device_number: '', asset_tag: '' })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // מודאלים למחיקה
  const [cartToDelete, setCartToDelete] = useState(null)
  const [cartToHardDelete, setCartToHardDelete] = useState(null)

  useEffect(() => {
    loadCarts()
  }, [])

  useEffect(() => {
    if (selectedCart) {
      loadDevices(selectedCart.id)
    }
  }, [selectedCart])

  // Realtime subscription for automatic updates on carts, devices, and loans
  useEffect(() => {
    const channel = supabase
      .channel('carts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carts' }, () => {
        loadCarts()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        loadCarts()
        if (selectedCart && (payload.new?.cart_id === selectedCart.id || payload.old?.cart_id === selectedCart.id)) {
          loadDevices(selectedCart.id)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_loans' }, () => {
        loadCarts()
        if (selectedCart) {
          loadDevices(selectedCart.id)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedCart])

  async function loadCarts() {
    setLoading(true)
    
    // טעינת עגלות פעילות
    const { data: activeData } = await supabase
      .from('cart_status')
      .select('*')
      .order('name')
    
    const activeList = activeData ?? []
    setCarts(activeList)

    // טעינת עגלות מחוקות לוגית ישירות מטבלת carts
    const { data: deletedData } = await supabase
      .from('carts')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('name')

    if (deletedData) {
      const enrichedDeleted = await Promise.all(
        deletedData.map(async (c) => {
          const { count } = await supabase
            .from('devices')
            .select('*', { count: 'exact', head: true })
            .eq('cart_id', c.id)
          return { ...c, registered_devices: count ?? 0 }
        })
      )
      setDeletedCarts(enrichedDeleted)
    } else {
      setDeletedCarts([])
    }

    // בחירת עגלה ראשונה פעילה במידה ואין עגלה נבחרת או שהעגלה שנבחרה נמחקה
    if (activeList.length) {
      if (!selectedCart || !activeList.some(c => c.id === selectedCart.id)) {
        setSelectedCart(activeList[0])
      }
    } else {
      setSelectedCart(null)
    }
    
    setLoading(false)
  }

  async function loadDevices(cartId) {
    if (!cartId) return

    // שליפת מכשירים שלא נמחקו לוגית בעגלה זו
    const { data: allDevices } = await supabase
      .from('devices')
      .select('*')
      .eq('cart_id', cartId)
      .is('deleted_at', null)
      .order('device_number')

    // שליפת השאלות פעילות
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
    const code = cartForm.kiosk_code.trim() || String(Math.floor(1000 + Math.random() * 9000))
    const { error: err } = await supabase.from('carts').insert({
      name: cartForm.name.trim(),
      display_name: cartForm.display_name.trim() || null,
      location: cartForm.location.trim(),
      total_devices: Number(cartForm.total_devices) || 0,
      kiosk_code: code
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowAddCart(false)
    setCartForm({ id: '', name: '', display_name: '', location: '', total_devices: '', kiosk_code: '' })
    loadCarts()
  }

  async function editCart(e) {
    e.preventDefault(); setError(''); setSaving(true)
    const code = cartForm.kiosk_code.trim() || String(Math.floor(1000 + Math.random() * 9000))
    const { error: err } = await supabase.from('carts').update({
      display_name: cartForm.display_name.trim() || null,
      location: cartForm.location.trim(),
      total_devices: Number(cartForm.total_devices) || 0,
      kiosk_code: code
    }).eq('id', cartForm.id)
    
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowEditCart(false)
    setCartForm({ id: '', name: '', display_name: '', location: '', total_devices: '', kiosk_code: '' })
    loadCarts()
  }

  function openEditModal(cart) {
    setCartForm({
      id: cart.id,
      name: cart.name,
      display_name: cart.display_name || '',
      location: cart.location || '',
      total_devices: cart.total_devices || '',
      kiosk_code: cart.kiosk_code || ''
    })
    setShowEditCart(true)
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

  // מחיקה לוגית של עגלה וכל המחשבים שלה
  async function softDeleteCart(cartId) {
    setError(''); setSaving(true)
    const now = new Date().toISOString()

    const { error: errCart } = await supabase
      .from('carts')
      .update({ deleted_at: now })
      .eq('id', cartId)

    if (errCart) {
      setError(errCart.message)
      setSaving(false)
      return
    }

    const { error: errDevices } = await supabase
      .from('devices')
      .update({ deleted_at: now })
      .eq('cart_id', cartId)

    setSaving(false)
    if (errDevices) {
      setError(errDevices.message)
      return
    }

    setCartToDelete(null)
    loadCarts()
  }

  // שחזור עגלה וכל המחשבים שלה
  async function restoreCart(cartId) {
    setError(''); setSaving(true)

    const { error: errCart } = await supabase
      .from('carts')
      .update({ deleted_at: null })
      .eq('id', cartId)

    if (errCart) {
      setError(errCart.message)
      setSaving(false)
      return
    }

    const { error: errDevices } = await supabase
      .from('devices')
      .update({ deleted_at: null })
      .eq('cart_id', cartId)

    setSaving(false)
    if (errDevices) {
      setError(errDevices.message)
      return
    }

    loadCarts()
  }

  // מחיקה סופית לצמיתות של עגלה (מחיקה משורשרת של המחשבים מבוצעת ע"י ON DELETE CASCADE)
  async function hardDeleteCart(cartId) {
    setError(''); setSaving(true)

    const { error: errCart } = await supabase
      .from('carts')
      .delete()
      .eq('id', cartId)

    setSaving(false)
    if (errCart) {
      setError(errCart.message)
      return
    }

    setCartToHardDelete(null)
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
          {/* Header & Tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            <div className="flex items-center justify-between">
              <h3 style={{ fontWeight: 800, fontSize: '0.95rem' }}>עגלות</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddCart(true)}>+ הוסף</button>
            </div>
            
            <div style={{ display: 'flex', background: 'var(--bg-light)', padding: 4, borderRadius: 8, gap: 4 }}>
              <button 
                className={`btn btn-sm ${!viewDeleted ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, padding: '6px 8px', fontSize: '0.8rem', borderRadius: 6 }}
                onClick={() => setViewDeleted(false)}
              >
                📁 פעילות ({carts.length})
              </button>
              <button 
                className={`btn btn-sm ${viewDeleted ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, padding: '6px 8px', fontSize: '0.8rem', borderRadius: 6, color: viewDeleted ? '#fff' : 'var(--danger-light)' }}
                onClick={() => setViewDeleted(true)}
              >
                ♻️ סל מיחזור ({deletedCarts.length})
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? <div className="loading-center"><div className="spinner" /></div> :
              !viewDeleted ? (
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontWeight: 700 }}>{cart.display_name || cart.name}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ padding: '2px 6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}
                          onClick={(e) => { e.stopPropagation(); openEditModal(cart); }}
                          title="ערוך עגלה"
                        >✏️</button>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ padding: '2px 6px', fontSize: '0.8rem', color: 'var(--danger-light)' }}
                          onClick={(e) => { e.stopPropagation(); setCartToDelete(cart); }}
                          title="העבר לסל מיחזור"
                        >🗑️</button>
                      </div>
                    </div>
                    {cart.display_name && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>שם מערכת: {cart.name}</div>}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{cart.location || 'אין מיקום'}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                      <span className="badge badge-success">{cart.available_devices ?? 0} זמין</span>
                      <span className="badge badge-warning">{cart.active_loans ?? 0} נלקח</span>
                    </div>
                  </div>
                ))
              ) : (
                deletedCarts.map(cart => (
                  <div
                    key={cart.id}
                    className="card"
                    style={{
                      padding: '14px 16px',
                      borderColor: 'var(--border)',
                      background: 'var(--bg-light)',
                      opacity: 0.9
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{cart.display_name || cart.name}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ padding: '2px 6px', fontSize: '0.75rem', color: 'var(--success-light)', border: '1px solid var(--border)' }}
                          onClick={() => restoreCart(cart.id)}
                          title="שחזר עגלה ומחשבים"
                        >🔄</button>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ padding: '2px 6px', fontSize: '0.75rem', color: 'var(--danger-light)', border: '1px solid var(--border)' }}
                          onClick={() => setCartToHardDelete(cart)}
                          title="מחק לצמיתות מהמערכת"
                        >🗑️</button>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cart.location || 'אין מיקום'}</div>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: '0.75rem', color: '#ff8a8a', fontWeight: 600 }}>
                        📦 {cart.registered_devices ?? 0} מחשבים ימחקו
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        נמחק ב: {new Date(cart.deleted_at).toLocaleString('he-IL')}
                      </div>
                    </div>
                  </div>
                ))
              )
            }
            {!loading && !viewDeleted && carts.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 10px' }}><p>אין עגלות פעילות</p></div>
            )}
            {!loading && viewDeleted && deletedCarts.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 10px' }}><p>סל המיחזור ריק ♻️</p></div>
            )}
          </div>
        </div>

        {/* Devices */}
        <div>
          {selectedCart && !viewDeleted ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ fontWeight: 700 }}>{selectedCart.display_name || selectedCart.name} – מחשבים</h3>
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
          ) : viewDeleted ? (
            <div className="empty-state">
              <div className="empty-icon">♻️</div>
              <p style={{ fontWeight: 600 }}>סל המיחזור פעיל</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                בחר בלשונית "פעילות" כדי לנהל את המחשבים בעגלות הפעילות, או שחזר עגלה מסל המיחזור.
              </p>
            </div>
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
                <label className="form-label">שם מערכת * (לזיהוי ע"י Agent)</label>
                <input className="form-input" value={cartForm.name} onChange={e => setCartForm(f => ({ ...f, name: e.target.value }))} required placeholder="עגלה א" />
              </div>
              <div className="form-group">
                <label className="form-label">שם תצוגה (למדבקות ולממשק)</label>
                <input className="form-input" value={cartForm.display_name} onChange={e => setCartForm(f => ({ ...f, display_name: e.target.value }))} placeholder="כיתה ט1 (אופציונלי)" />
              </div>
              <div className="form-group">
                <label className="form-label">מיקום</label>
                <input className="form-input" value={cartForm.location} onChange={e => setCartForm(f => ({ ...f, location: e.target.value }))} placeholder="ספריה / קומה ב" />
              </div>
              <div className="form-group">
                <label className="form-label">מספר מחשבים סך הכל</label>
                <input className="form-input" type="number" value={cartForm.total_devices} onChange={e => setCartForm(f => ({ ...f, total_devices: e.target.value }))} placeholder="38" />
              </div>
              <div className="form-group">
                <label className="form-label">קוד גישה לקיוסק (4 ספרות)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" style={{ flex: 1 }} value={cartForm.kiosk_code} onChange={e => setCartForm(f => ({ ...f, kiosk_code: e.target.value }))} placeholder="1234 (אופציונלי - ייווצר אוטומטית)" />
                  <button type="button" className="btn btn-ghost" onClick={() => setCartForm(f => ({ ...f, kiosk_code: String(Math.floor(1000 + Math.random() * 9000)) }))}>🎲 חולל</button>
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳...' : '✅ הוסף'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddCart(false)}>ביטול</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Cart Modal */}
      {showEditCart && (
        <div className="modal-overlay" onClick={() => setShowEditCart(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">✏️ ערוך עגלה</h3>
              <button className="modal-close" onClick={() => setShowEditCart(false)}>✕</button>
            </div>
            <form onSubmit={editCart}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">שם מערכת (לא ניתן לשינוי)</label>
                <input className="form-input" value={cartForm.name} disabled style={{ background: '#f5f5f5', color: '#666' }} />
                <div style={{ fontSize: '0.7rem', color: '#888', marginTop: 4 }}>משמש את סקריפט ההתקנה לזיהוי המחשבים.</div>
              </div>
              <div className="form-group">
                <label className="form-label">שם תצוגה (למדבקות ולממשק)</label>
                <input className="form-input" value={cartForm.display_name} onChange={e => setCartForm(f => ({ ...f, display_name: e.target.value }))} placeholder="כיתה ט1 (אופציונלי)" />
              </div>
              <div className="form-group">
                <label className="form-label">מיקום</label>
                <input className="form-input" value={cartForm.location} onChange={e => setCartForm(f => ({ ...f, location: e.target.value }))} placeholder="ספריה / קומה ב" />
              </div>
              <div className="form-group">
                <label className="form-label">מספר מחשבים סך הכל</label>
                <input className="form-input" type="number" value={cartForm.total_devices} onChange={e => setCartForm(f => ({ ...f, total_devices: e.target.value }))} placeholder="38" />
              </div>
              <div className="form-group">
                <label className="form-label">קוד גישה לקיוסק (4 ספרות)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" style={{ flex: 1 }} value={cartForm.kiosk_code} onChange={e => setCartForm(f => ({ ...f, kiosk_code: e.target.value }))} placeholder="1234" required />
                  <button type="button" className="btn btn-ghost" onClick={() => setCartForm(f => ({ ...f, kiosk_code: String(Math.floor(1000 + Math.random() * 9000)) }))}>🎲 חולל</button>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#888', marginTop: 4 }}>שינוי הקוד ינתק באופן מיידי את הטאבלט הפיזי של העגלה וידרוש הזנת הקוד החדש.</div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳...' : '✅ שמור שינויים'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowEditCart(false)}>ביטול</button>
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
              <h3 className="modal-title">➕ הוסף מחשב ל{selectedCart.display_name || selectedCart.name}</h3>
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

      {/* מודאל אזהרת מחיקה לוגית - העברה לסל המיחזור */}
      {cartToDelete && (
        <div className="modal-overlay" onClick={() => setCartToDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
            <div className="modal-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <h3 className="modal-title" style={{ fontSize: '1.2rem', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 8 }}>
                ⚠️ מחיקת עגלה והעברה לסל מיחזור
              </h3>
              <button className="modal-close" onClick={() => setCartToDelete(null)}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ margin: 0, lineHeight: 1.6, fontSize: '0.95rem' }}>
                האם אתה בטוח שברצונך למחוק את עגלה <strong>"{cartToDelete.display_name || cartToDelete.name}"</strong>?
              </p>
              <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                פעולה זו תעביר את העגלה ואת <strong>כל המחשבים המשויכים אליה</strong> לסל המיחזור.
                העגלה והמחשבים יושבתו זמנית, אך תוכל לשחזר אותם בכל עת מתוך סל המיחזור.
              </p>
            </div>
            <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => softDeleteCart(cartToDelete.id)}
                disabled={saving}
              >
                {saving ? '⏳...' : '🗑️ העבר לסל מיחזור'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCartToDelete(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* מודאל אזהרת מחיקה פיזית - מחיקה סופית לצמיתות */}
      {cartToHardDelete && (
        <div className="modal-overlay" onClick={() => setCartToHardDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450, border: '1px solid #ff4d4d' }}>
            <div className="modal-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <h3 className="modal-title" style={{ fontSize: '1.2rem', color: '#ff4d4d', display: 'flex', alignItems: 'center', gap: 8 }}>
                🚨 מחיקה סופית ולצמיתות!
              </h3>
              <button className="modal-close" onClick={() => setCartToHardDelete(null)}>✕</button>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ margin: 0, lineHeight: 1.6, fontSize: '0.95rem', color: '#ff4d4d', fontWeight: 600 }}>
                אזהרה: פעולה זו היא בלתי הפיכה!
              </p>
              <p style={{ marginTop: 8, lineHeight: 1.6, fontSize: '0.95rem' }}>
                האם אתה בטוח שברצונך למחוק לצמיתות את עגלה <strong>"{cartToHardDelete.display_name || cartToHardDelete.name}"</strong>?
              </p>
              <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                עגלה זו וכל <strong>{cartToHardDelete.registered_devices ?? 0} המחשבים שלה יימחקו פיזית</strong> משרתי המערכת לצמיתות. 
                לא ניתן יהיה לשחזר אותם שוב בעתיד!
              </p>
            </div>
            <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: '#d32f2f', borderColor: '#d32f2f' }}
                onClick={() => hardDeleteCart(cartToHardDelete.id)}
                disabled={saving}
              >
                {saving ? '⏳...' : '🔥 מחק לצמיתות'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCartToHardDelete(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
