/**
 * reseed.mjs – תיקון קידוד נתוני הדוגמה
 * מריץ: node supabase/reseed.mjs
 *
 * מעדכן שמות עברים שנשמרו כסימני שאלה בעקבות
 * בעיית קידוד בהרצת seed.sql דרך PowerShell.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zxggjorfknageseqlway.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Z2dqb3Jma25hZ2VzZXFsd2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDEyNDcsImV4cCI6MjA5NDMxNzI0N30.rs1L95gK0RDy64Ppi97nZW_RBPJzyWuIAKSthOKkj1E'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── נתוני עגלות ──────────────────────────────────────────────
// ה-IDs לקוחים מ-seed_devices.sql שהוכנסו עם UUIDs ספציפיים
const CARTS = [
  { id: '14a68b75-5a0d-4b00-af16-7e6fee481658', name: 'עגלה א', location: 'ספריה – קומה א',  total_devices: 38 },
  { id: 'ff80f18d-e0fa-4938-823e-a49bf9f8e780', name: 'עגלה ב', location: 'חדר מחשבים 101', total_devices: 36 },
  { id: 'd01cfd1d-aba7-4195-816c-eb7fe193aa6c', name: 'עגלה ג', location: 'אולם מדעים',       total_devices: 40 },
]

// ─── נתוני תלמידים ────────────────────────────────────────────
const STUDENTS = [
  { national_id: '123456789', name: 'ישראל ישראלי', class_name: "ח'2", grade: 8 },
  { national_id: '987654321', name: 'שרה כהן',      class_name: "ז'1", grade: 7 },
  { national_id: '111222333', name: 'דוד לוי',       class_name: "ט'3", grade: 9 },
  { national_id: '444555666', name: 'מרים אברהם',    class_name: "ח'2", grade: 8 },
  { national_id: '777888999', name: 'יוסף מזרחי',    class_name: "ז'1", grade: 7 },
]

async function run() {
  let errors = 0

  // ── תיקון עגלות ───────────────────────────────────────────────
  console.log('\n📦 מעדכן עגלות...')
  for (const cart of CARTS) {
    // נסה לעדכן לפי ID
    const { data: existing } = await supabase
      .from('carts').select('id').eq('id', cart.id).single()

    if (existing) {
      const { error } = await supabase
        .from('carts')
        .update({ name: cart.name, location: cart.location, total_devices: cart.total_devices })
        .eq('id', cart.id)
      if (error) { console.error(`  ❌ ${cart.name}: ${error.message}`); errors++ }
      else        console.log(`  ✅ עודכן: ${cart.name}`)
    } else {
      // לא קיים – הכנס
      const { error } = await supabase
        .from('carts')
        .insert({ id: cart.id, name: cart.name, location: cart.location, total_devices: cart.total_devices })
      if (error) { console.error(`  ❌ ${cart.name}: ${error.message}`); errors++ }
      else        console.log(`  ✅ הוכנס: ${cart.name}`)
    }
  }

  // ── תיקון תלמידים ─────────────────────────────────────────────
  console.log('\n👥 מעדכן תלמידים...')
  for (const s of STUDENTS) {
    const { error } = await supabase
      .from('students')
      .update({ name: s.name, class_name: s.class_name, grade: s.grade })
      .eq('national_id', s.national_id)
    if (error) { console.error(`  ❌ ${s.national_id}: ${error.message}`); errors++ }
    else        console.log(`  ✅ עודכן: ${s.name} (${s.class_name})`)
  }

  // ── סיכום ─────────────────────────────────────────────────────
  console.log('')
  if (errors === 0) {
    console.log('🎉 כל הנתונים תוקנו בהצלחה! רענן את הדפדפן.')
  } else {
    console.log(`⚠️  הסתיים עם ${errors} שגיאות.`)
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1) })
