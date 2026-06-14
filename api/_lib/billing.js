const DEFAULT_APP_URL = 'https://image2.coffeeapi.online';

export function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
  return host ? `${protocol}://${host}` : DEFAULT_APP_URL;
}

export async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function normalizeCurrency(value) {
  return String(value || 'cny').toLowerCase();
}

function moneyLabel(amountCents, currency) {
  const cur = normalizeCurrency(currency).toUpperCase();
  if (cur === 'CNY') {
    return `¥${(Number(amountCents || 0) / 100).toFixed(0)}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur
  }).format(Number(amountCents || 0) / 100);
}

export function formatPlan(row) {
  return {
    id: row.id,
    type: 'membership',
    name: {
      en: row.name_en,
      zh: row.name_zh
    },
    description: {
      en: row.description_en,
      zh: row.description_zh
    },
    monthlyCredits: Number(row.monthly_credits || 0),
    amountCents: Number(row.amount_cents || 0),
    currency: normalizeCurrency(row.currency),
    interval: row.interval || 'month',
    priceLabel: moneyLabel(row.amount_cents, row.currency),
    active: Boolean(row.active)
  };
}

export function formatPack(row) {
  return {
    id: row.id,
    type: 'credit_pack',
    name: {
      en: row.name_en,
      zh: row.name_zh
    },
    description: {
      en: row.description_en,
      zh: row.description_zh
    },
    credits: Number(row.credits || 0),
    amountCents: Number(row.amount_cents || 0),
    currency: normalizeCurrency(row.currency),
    priceLabel: moneyLabel(row.amount_cents, row.currency),
    active: Boolean(row.active)
  };
}

export async function getBillingCatalog(client) {
  const [plansResult, packsResult] = await Promise.all([
    client
      .from('membership_plans')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    client
      .from('credit_packs')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
  ]);

  if (plansResult.error) throw plansResult.error;
  if (packsResult.error) throw packsResult.error;

  return {
    plans: (plansResult.data || []).map(formatPlan),
    packs: (packsResult.data || []).map(formatPack)
  };
}

export async function getBillingProduct(client, productType, productId) {
  const table = productType === 'membership' ? 'membership_plans' : 'credit_packs';
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return productType === 'membership' ? formatPlan(data) : formatPack(data);
}

export async function createPaymentOrder(client, { userId, product, customerId = null }) {
  const credits = product.type === 'membership' ? product.monthlyCredits : product.credits;
  const { data, error } = await client
    .from('payment_orders')
    .insert({
      user_id: userId,
      product_type: product.type,
      product_id: product.id,
      status: 'created',
      stripe_customer_id: customerId,
      amount_cents: product.amountCents,
      currency: product.currency,
      credits
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function markOrderCheckoutCreated(client, orderId, paymentInfo = {}) {
  const { data, error } = await client
    .from('payment_orders')
    .update({
      status: 'checkout_created',
      stripe_session_id: paymentInfo.tradeOrderId || null,
      metadata: paymentInfo
    })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function grantCredits(client, { userId, amount, type, source, referenceId = null, metadata = {} }) {
  const { data, error } = await client.rpc('grant_user_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_source: source,
    p_reference_id: referenceId,
    p_metadata: metadata
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
