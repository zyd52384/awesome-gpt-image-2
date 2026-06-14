import { getSupabaseAdminClient, isSupabaseServerConfigured } from '../_lib/supabase.js';
import {
  getAppUrl,
  grantCredits,
  readRawBody
} from '../_lib/billing.js';
import { verifySign, isHupijiaoConfigured } from '../_lib/hupijiao.js';

export const config = {
  api: {
    bodyParser: false
  }
};

function json(res, status, payload) {
  res.status(status).json(payload);
}

/**
 * Parse URL-encoded form body from raw buffer
 */
function parseFormBody(buffer) {
  const text = buffer.toString('utf8');
  const params = {};
  text.split('&').forEach((pair) => {
    const [key, value] = pair.split('=').map((s) => decodeURIComponent(s || ''));
    if (key) params[key] = value;
  });
  return params;
}

/**
 * Activate membership for a user
 * Creates/updates user_membership with 30-day period
 */
async function activateMembership(client, userId, planId) {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data, error } = await client
    .from('user_memberships')
    .upsert(
      {
        user_id: userId,
        plan_id: planId,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        monthly_credits_granted_at: now.toISOString()
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function handlePaymentSuccess(client, params) {
  const tradeOrderId = params.trade_order_id;
  if (!tradeOrderId) {
    console.warn('虎皮椒 notify missing trade_order_id');
    return;
  }

  console.log(`虎皮椒 payment success: order=${tradeOrderId}, fee=${params.total_fee}, status=${params.status}`);

  // Find the order in database
  const { data: order, error } = await client
    .from('payment_orders')
    .select('*')
    .eq('id', tradeOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) {
    console.warn(`Order not found: ${tradeOrderId}`);
    return;
  }

  // Idempotency: skip if already completed
  if (order.status === 'completed') {
    console.log(`Order already completed: ${tradeOrderId}`);
    return;
  }

  const productType = order.product_type;
  const productId = order.product_id;
  const credits = Number(order.credits || 0);

  // Grant credits
  if (credits > 0) {
    await grantCredits(client, {
      userId: order.user_id,
      amount: credits,
      type: productType === 'membership' ? 'membership_grant' : 'purchase',
      source: productType === 'membership' ? 'hupijiao_membership' : 'hupijiao_pack',
      referenceId: order.id,
      metadata: {
        hupijiaoTradeOrderId: tradeOrderId,
        productId: productId,
        totalFee: params.total_fee
      }
    });
  }

  // Activate membership if it's a membership plan
  if (productType === 'membership') {
    await activateMembership(client, order.user_id, productId);
  }

  // Mark order as completed
  const { error: updateError } = await client
    .from('payment_orders')
    .update({
      status: 'completed',
      metadata: {
        ...(order.metadata || {}),
        hupijiaoTradeOrderId: tradeOrderId,
        hupijiaoTotalFee: params.total_fee,
        hupijiaoPaidAt: new Date().toISOString()
      },
      completed_at: new Date().toISOString()
    })
    .eq('id', order.id);

  if (updateError) throw updateError;

  console.log(`Order completed: ${tradeOrderId} (${productType})`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSupabaseServerConfigured() || !isHupijiaoConfigured()) {
    return json(res, 500, { ok: false, error: 'PAYMENT_NOT_CONFIGURED' });
  }

  try {
    const rawBody = await readRawBody(req);
    const params = parseFormBody(rawBody);

    console.log(`虎皮椒 notify received: ${JSON.stringify(params)}`);

    // Verify signature
    const appsecret = process.env.HUPIJIAO_APPSECRET || '';
    if (!verifySign(params, appsecret)) {
      console.warn('虎皮椒 signature verification failed');
      return json(res, 200, 'sign error'); // 虎皮椒 expects this format
    }

    // Only process successful payments — 虎皮椒 uses 'OD' for paid
    if (params.status === 'OD') {
      const client = getSupabaseAdminClient();
      await handlePaymentSuccess(client, params);
    } else {
      console.log(`虎皮椒 payment not yet paid: status=${params.status}, order=${params.trade_order_id}`);
    }

    // 虎皮椒 expects "success" text on success, no JSON
    res.status(200).send('success');
  } catch (error) {
    console.warn('Failed to process 虎皮椒 webhook', {
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    // Return success to 虎皮椒 anyway (don't retry)
    res.status(200).send('success');
  }
}
