import { getAuthContext } from '../_lib/supabase.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  // 虎皮椒 doesn't have a customer portal. Memberships are managed manually.
  return json(res, 400, {
    ok: false,
    error: 'PORTAL_NOT_AVAILABLE'
  });
}
