import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'

export default function Labels() {
  const [carts, setCarts]       = useState([])
  const [selected, setSelected] = useState(null)
  const [devices, setDevices]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [schoolName, setSchoolName] = useState('בית הספר')
  const printRef = useRef()

  useEffect(() => {
    supabase.from('carts').select('*').order('name').then(({ data }) => setCarts(data ?? []))
  }, [])

  async function loadDevices(cart) {
    setSelected(cart)
    setLoading(true)
    const { data } = await supabase.from('devices').select('*').eq('cart_id', cart.id).order('device_number')
    // Generate QR codes for each device
    const withQR = await Promise.all((data ?? []).map(async d => ({
      ...d,
      qrDataUrl: await QRCode.toDataURL(d.id, { width: 160, margin: 1, color: { dark: '#000', light: '#fff' } })
    })))
    setDevices(withQR)
    setLoading(false)
  }

  function handlePrint() {
    const content = printRef.current.innerHTML
    const win = window.open('', '_blank')
    win.document.write(`
      <html dir="rtl">
        <head>
          <title>תוויות QR – ${selected?.name}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: white; margin: 0; }
            .grid { 
              display: grid; 
              grid-template-columns: repeat(3, 70mm);
              grid-template-rows: repeat(8, 35mm);
              gap: 0; 
              padding-top: 8.5mm; 
              width: 210mm; 
              margin: 0 auto;
            }
            /* Override inline styles from React */
            .label {
              width: 70mm !important; 
              height: 35mm !important;
              border: none !important; 
              border-radius: 0 !important;
              padding: 2mm 3mm !important;
              margin: 0 !important;
              display: flex !important;
              flex-direction: row !important;
              align-items: center !important;
              justify-content: space-between !important;
              page-break-inside: avoid;
            }
            .label-text {
              display: flex !important;
              flex-direction: column !important;
              justify-content: center !important;
              width: calc(100% - 28mm) !important;
            }
            .school { font-size: 11px !important; font-weight: bold; color: #333; margin-bottom: 3px; }
            .device-info { font-size: 15px !important; font-weight: 900; color: #000; line-height: 1.2; }
            .asset-tag { font-size: 10px !important; color: #666; margin-top: 2px; }
            img { width: 28mm !important; height: 28mm !important; }
            
            @media print {
              @page { margin: 0; size: A4; }
              html, body { width: 210mm; height: 297mm; }
            }
          </style>
        </head>
        <body>
          <div class="grid">${content}</div>
          <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `)
    win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">🖨️ הדפסת תוויות QR</h2>
        <p className="page-subtitle">בחר עגלה, צור תוויות והדפס</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
        {/* Settings & Cart list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>הגדרות</h3>
            <div className="form-group">
              <label className="form-label">שם בית הספר</label>
              <input className="form-input" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>בחר עגלה</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {carts.map(c => (
                <button
                  key={c.id}
                  className={`btn ${selected?.id === c.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => loadDevices(c)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  🛒 {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div>
          {selected && (
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ fontWeight: 700 }}>תוויות ל{selected.name} ({devices.length} מחשבים)</h3>
              <button className="btn btn-primary" onClick={handlePrint} disabled={loading || devices.length === 0}>
                🖨️ הדפס
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading-center"><div className="spinner" /><span>מייצר קודי QR...</span></div>
          ) : (
            <div
              ref={printRef}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}
            >
              {devices.map(dev => (
                <div
                  key={dev.id}
                  className="label"
                  style={{
                    background: 'white', color: '#111',
                    border: '1px dashed #ccc', borderRadius: 4,
                    padding: '8px 12px',
                    display: 'flex', flexDirection: 'row',
                    alignItems: 'center', justifyContent: 'space-between',
                    minHeight: 100
                  }}
                >
                  <div className="label-text" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="school" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#333', marginBottom: 4 }}>
                      {schoolName}
                    </div>
                    <div className="device-info" style={{ fontSize: '1.1rem', fontWeight: 900, color: '#111', lineHeight: 1.2 }}>
                      {selected?.name}<br/>מחשב {dev.device_number}
                    </div>
                    {dev.asset_tag && (
                      <div className="asset-tag" style={{ fontSize: '0.7rem', color: '#666', marginTop: 4 }}>
                        {dev.asset_tag}
                      </div>
                    )}
                  </div>
                  <img src={dev.qrDataUrl} alt={`QR`} style={{ width: 80, height: 80 }} />
                </div>
              ))}
            </div>
          )}

          {!selected && (
            <div className="empty-state">
              <div className="empty-icon">🖨️</div>
              <p>בחר עגלה מהרשימה כדי לייצר תוויות</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
