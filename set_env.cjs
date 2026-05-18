const { execSync } = require('child_process');

try {
  console.log('Setting URL...');
  try { execSync('npx vercel env rm VITE_SUPABASE_URL production -y', { stdio: 'ignore' }); } catch (e) {}
  execSync('npx vercel env add VITE_SUPABASE_URL production', { 
    input: 'https://zxggjorfknageseqlway.supabase.co',
    stdio: ['pipe', 'inherit', 'inherit']
  });

  console.log('Setting KEY...');
  try { execSync('npx vercel env rm VITE_SUPABASE_ANON_KEY production -y', { stdio: 'ignore' }); } catch (e) {}
  execSync('npx vercel env add VITE_SUPABASE_ANON_KEY production', { 
    input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Z2dqb3Jma25hZ2VzZXFsd2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDEyNDcsImV4cCI6MjA5NDMxNzI0N30.rs1L95gK0RDy64Ppi97nZW_RBPJzyWuIAKSthOKkj1E',
    stdio: ['pipe', 'inherit', 'inherit']
  });
  
  console.log('Done!');
} catch (e) {
  console.error(e.message);
}
