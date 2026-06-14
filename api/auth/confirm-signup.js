import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const { userId, email } = req.body || {};
  if (!userId) {
    return res.status(400).json({ ok: false, error: 'MISSING_USER_ID' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 直接确认用户邮箱
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    email_confirm: true
  });

  if (error) {
    console.warn('Failed to confirm user:', error);
    return res.status(500).json({ ok: false, error: 'CONFIRM_FAILED' });
  }

  return res.status(200).json({ ok: true });
}
