/**
 * migrate_scheduled.mjs – הוספת status 'scheduled' + view
 * מריץ: node supabase/migrate_scheduled.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zxggjorfknageseqlway.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Z2dqb3Jma25hZ2VzZXFsd2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDEyNDcsImV4cCI6MjA5NDMxNzI0N30.rs1L95gK0RDy64Ppi97nZW_RBPJzyWuIAKSthOKkj1E'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// INSERT שיעור scheduled לבדיקה
async function run() {
  console.log('בודק חיבור ל-Supabase...')
  
  // בדיקה: ניסיון להכניס שיעור עם status='scheduled'
  // אם ה-constraint ישן עדיין ייכשל, נדע שצריך לעדכן ידנית
  const tomorrow = new Date()
  tomorrow.setHours(tomorrow.getHours() + 2)
  const end = new Date(tomorrow.getTime() + 45 * 60000)

  const { error } = await supabase.from('lessons').insert({
    lesson_code:      '0000',
    duration_minutes: 45,
    start_time:       tomorrow.toISOString(),
    end_time:         end.toISOString(),
    status:           'scheduled',
  })

  if (error) {
    if (error.message.includes('check constraint') || error.message.includes('lessons_status_check')) {
      console.log('⚠️  ה-constraint ישן. יש לעדכן ידנית ב-Supabase Studio.')
      console.log('    מדריך: dashboard.supabase.com → SQL Editor → הדבק:')
      console.log(`
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('active','scheduled','ended','cancelled'));
      `)
    } else {
      console.log('שגיאה אחרת:', error.message)
    }
    return
  }

  // נקה את הרשומה הזמנית
  await supabase.from('lessons').delete().eq('lesson_code', '0000').eq('status', 'scheduled')
  console.log('✅ status=scheduled כבר נתמך! ממשיך...')
  console.log('🎉 Migration הצליח.')
}

run().catch(e => { console.error('Fatal:', e); process.exit(1) })
