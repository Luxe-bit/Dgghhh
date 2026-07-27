// /api/initiate-payment.js
const querystring = require('querystring');
const { getDb } = require('./_lib/firebaseAdmin');

const IS_SANDBOX = process.env.SSLCZ_IS_SANDBOX !== 'false';
const SSLCZ_BASE = IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com';

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { /* fall through */ }
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(querystring.parse(body));
      }
    });
  });
}

// fetch() with a hard timeout so a slow SSLCommerz response can't hang
// the serverless function until Vercel kills it.
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ---- required env vars, fail fast with a clear message ----
    const required = ['FIREBASE_SERVICE_ACCOUNT', 'SSLCZ_STORE_ID', 'SSLCZ_STORE_PASSWORD'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error('Missing env vars:', missing.join(', '));
      return res.status(500).json({ error: 'Server misconfigured', missing });
    }

    const body = await parseBody(req);
    const orderId = body ? String(body.orderId || '').trim() : '';
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    // ---- Read order via Admin SDK (bypasses security rules — no public read needed) ----
    const db = getDb();
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({ error: 'Order not found in Database' });
    }

    const order = orderSnap.data();

    if (order.payment_status === 'Paid') {
      return res.status(400).json({ error: 'This order has already been paid' });
    }

    const totalAmount = Number(order.totalPrice ?? order.total_amount ?? 0);
    if (!totalAmount || totalAmount <= 0 || !Number.isFinite(totalAmount)) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const address = order.address || {};
    const cusName = String(address.name || 'Customer').slice(0, 100);
    const cusPhone = String(address.phone || '01700000000').slice(0, 20);
    const cusAdd = String(address.address || 'N/A').slice(0, 200);
    const cusCity = String(address.city || 'Dhaka').slice(0, 60);
    const cusEmail = String(order.customerEmail || 'customer@designtub.com').slice(0, 100);

    // tran_id is unique per attempt; it gets bound to this order below so
    // payment-success.js can verify the callback actually belongs to this
    // order and hasn't been forged/replayed with a mismatched tran_id.
    const tranId = `DTB-${orderId}-${Date.now()}`;
    const apiUrl = process.env.API_BASE_URL || 'https://dgghhh.vercel.app';

    const postData = {
      store_id: process.env.SSLCZ_STORE_ID,
      store_passwd: process.env.SSLCZ_STORE_PASSWORD,
      total_amount: totalAmount,
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${apiUrl}/api/payment-success`,
      fail_url: `${apiUrl}/api/payment-fail`,
      cancel_url: `${apiUrl}/api/payment-cancel`,
      ipn_url: `${apiUrl}/api/payment-ipn`,
      shipping_method: 'Courier',
      product_name: 'Designtub Order',
      product_category: 'Ceramics',
      product_profile: 'general',
      cus_name: cusName,
      cus_email: cusEmail,
      cus_add1: cusAdd,
      cus_city: cusCity,
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: cusPhone,
      ship_name: cusName,
      ship_add1: cusAdd,
      ship_city: cusCity,
      ship_postcode: '1000',
      ship_country: 'Bangladesh',
      value_a: orderId,
    };

    let sslczData;
    try {
      const params = new URLSearchParams(postData);
      const sslczResponse = await fetchWithTimeout(`${SSLCZ_BASE}/gwprocess/v4/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }, 10000);
      sslczData = await sslczResponse.json();
    } catch (fErr) {
      console.error('SSLCommerz request failed/timed out:', fErr.message);
      return res.status(502).json({ error: 'Payment gateway unreachable, please try again' });
    }

    if (sslczData.status !== 'SUCCESS') {
      console.error('SSLCommerz Error:', sslczData);
      return res.status(400).json({ error: 'SSLCommerz initiation failed', details: sslczData.failedreason || sslczData });
    }

    // Bind this tran_id to the order now, BEFORE returning the gateway URL,
    // so payment-success can later cross-check it. Also record amount so
    // a tampered client-side total can be caught during validation.
    await orderRef.set({
      payment_status: 'Initiated',
      payment_tran_id: tranId,
      expected_amount: totalAmount,
      initiatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.status(200).json({ url: sslczData.GatewayPageURL });

  } catch (err) {
    console.error('Fatal initiate-payment Error:', err);
    return res.status(500).json({ error: 'Server Internal Error', message: err.message });
  }
};
