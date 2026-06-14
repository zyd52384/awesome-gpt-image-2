import crypto from 'crypto';

const DEFAULT_API_URL = 'https://api.xunhupay.com/payment/do.html';

export function isHupijiaoConfigured() {
  return Boolean(process.env.HUPIJIAO_APPID && process.env.HUPIJIAO_APPSECRET);
}

export function getHupijiaoConfig() {
  return {
    appid: process.env.HUPIJIAO_APPID || '',
    appsecret: process.env.HUPIJIAO_APPSECRET || '',
    apiUrl: process.env.HUPIJIAO_API_URL || DEFAULT_API_URL
  };
}

/**
 * Generate 虎皮椒 MD5 sign
 * Sorted by key, joined with &, appended with &key=appsecret, then MD5
 */
export function generateSign(params, appsecret) {
  const keys = Object.keys(params).sort();
  const parts = keys
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .map((k) => `${k}=${params[k]}`);
  parts.push(`key=${appsecret}`);
  const raw = parts.join('&');
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toLowerCase();
}

/**
 * Verify 虎皮椒 notify sign
 */
export function verifySign(params, appsecret) {
  const sign = params.sign;
  if (!sign) return false;
  const expected = generateSign(params, appsecret);
  return sign.toLowerCase() === expected.toLowerCase();
}

/**
 * Create a payment order with 虎皮椒
 * Returns { ok, url, trade_order_id } or throws
 */
export async function createHupijiaoPayment({
  tradeOrderId,
  totalFee,
  title,
  notifyUrl,
  returnUrl,
  type = '' // empty = auto, 'wechat' / 'alipay'
}) {
  const config = getHupijiaoConfig();
  if (!config.appid || !config.appsecret) {
    throw new Error('HUPIJIAO_NOT_CONFIGURED');
  }

  const time = Math.floor(Date.now() / 1000);
  const nonceStr = crypto.randomBytes(16).toString('hex');

  const params = {
    appid: config.appid,
    trade_order_id: tradeOrderId,
    total_fee: totalFee.toFixed(2),
    title,
    time,
    notify_url: notifyUrl,
    return_url: returnUrl,
    nonce_str: nonceStr
  };

  if (type) {
    params.type = type;
  }

  params.sign = generateSign(params, config.appsecret);

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HUPIJIAO_INVALID_RESPONSE: ${text.slice(0, 200)}`);
  }

  if (data.errcode !== 0) {
    throw new Error(`HUPIJIAO_ERROR: ${data.errmsg || data.errcode}`);
  }

  if (!data.url) {
    throw new Error('HUPIJIAO_NO_PAYMENT_URL');
  }

  return {
    ok: true,
    url: data.url,
    tradeOrderId: data.trade_order_id || tradeOrderId
  };
}
