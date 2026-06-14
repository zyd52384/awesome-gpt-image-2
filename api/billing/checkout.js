import { getAuthContext, getProfileById, isSupabaseServerConfigured } from '../_lib/supabase.js';
import {
  getAppUrl,
  getBillingProduct,
  createPaymentOrder,
  markOrderCheckoutCreated,
  readJsonBody
} from '../_lib/billing.js';
import {
  createHupijiaoPayment,
  isHupijiaoConfigured
} from '../_lib/hupijiao.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSupabaseServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  if (!isHupijiaoConfigured()) {
    return json(res, 500, { ok: false, error: 'PAYMENT_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_BILLING_PRODUCT' });
  }

  const productType = body.productType === 'credit_pack' ? 'credit_pack' : 'membership';
  const productId = String(body.productId || body.planId || '').trim();
  if (!productType || !productId) {
    return json(res, 400, { ok: false, error: 'INVALID_BILLING_PRODUCT' });
  }

  try {
    const product = await getBillingProduct(auth.client, productType, productId);
    if (!product) {
      return json(res, 404, { ok: false, error: 'BILLING_PRODUCT_NOT_FOUND' });
    }

    const appUrl = getAppUrl(req);

    // Create payment order in database
    const order = await createPaymentOrder(auth.client, {
      userId: auth.user.id,
      product,
      customerId: null // no Stripe customer for 虎皮椒
    });

    const title = getProductTitle(product, auth.user);
    const tradeOrderId = order.id;

    // Call 虎皮椒 to create payment
    const payment = await createHupijiaoPayment({
      tradeOrderId,
      totalFee: product.amountCents / 100,
      title,
      notifyUrl: `${appUrl}/api/billing/webhook`,
      returnUrl: `${appUrl}/?billing=success`
    });

    // Store 虎皮椒 trade info on the order
    await markOrderCheckoutCreated(auth.client, order.id, {
      tradeOrderId: payment.tradeOrderId
    });

    const refreshedProfile = await getProfileById(auth.user.id);

    return json(res, 200, {
      ok: true,
      url: payment.url,
      orderId: order.id,
      user: refreshedProfile
    });
  } catch (error) {
    console.warn('Failed to create checkout', {
      userId: auth.user?.id,
      productType,
      productId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'CHECKOUT_FAILED' });
  }
}

function getProductTitle(product, user) {
  const name = product.name?.zh || product.name?.en || '商品';
  if (product.type === 'membership') {
    const credits = product.monthlyCredits || 0;
    return `${name} - 每月${credits}积分`;
  }
  const credits = product.credits || 0;
  return `${name} - ${credits}积分`;
}
