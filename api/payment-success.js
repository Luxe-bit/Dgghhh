// /api/payment-success.js
const querystring = require('querystring');
const { getDb } = require('./_lib/firebaseAdmin');

const siteUrl = process.env.SITE_URL || 'https://luxe-bit.github.io/Dgghhh';

async function parseFormBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => resolve(querystring.parse(body)));
  });
}

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = (req.method === 'POST') ? await parseFormBody(req) : (req.query || {});

    const val_id = body.val_id || req.query.val_id;
    const tran_id = body.tran_id || req.query.tran_id;
    const orderId = body.value_a || req.query.value_a || body.orderId || req.query.orderId;

    if (!val_id || !orderId || !tran_id) {
      console.error('Missing val_id/tran_id/orderId:', { val_id, tran_id, orderId });
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=missing_data`);
    }

    const db = getDb();
    const orderRef = db.collection('orders').doc(String(orderId));
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      console.error('Order not found for id:', orderId);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=order_not_found`);
    }

    const order = orderSnap.data();

    // Idempotency: if a duplicate callback/IPN arrives after we already
    // marked this Paid, don't re-validate or re-charge logic — just show success.
    if (order.payment_status === 'Paid') {
      return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);
    }

    // Anti-tamper: the tran_id in this callback must match the one we
    // generated and stored when initiating payment for THIS order.
    if (order.payment_tran_id !== tran_id) {
      console.error('tran_id mismatch for order', orderId, { expected: order.payment_tran_id, got: tran_id });
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=tran_id_mismatch`);
    }

    // ---- Server-to-server validation with SSLCommerz ----
    const isSandbox = process.env.SSLCZ_IS_SANDBOX !== 'false';
    const sslczBaseUrl = isSandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';

    const storeId = process.env.SSLCZ_STORE_ID;
    const storePass = process.env.SSLCZ_STORE_PASSWORD;
    const validationUrl = `${sslczBaseUrl}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(val_id)}&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(storePass)}&v=1&format=json`;

    let valData;
    try {
      const response = await fetchWithTimeout(validationUrl, {}, 10000);
      valData = await response.json();
    } catch (fErr) {
      console.error('SSLCommerz validation request failed/timed out:', fErr.message);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=validation_unreachable`);
    }

    if (valData.status !== 'VALID' && valData.status !== 'VALIDATED') {
      console.error('Validation failed, status:', valData.status, valData);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=unauthorized_payment`);
    }

    // Anti-tamper: confirm the tran_id inside the *validated* SSLCommerz
    // response also matches (not just the query param), and the paid
    // amount matches what we expected when initiating.
    if (valData.tran_id && valData.tran_id !== order.payment_tran_id) {
      console.error('Validated tran_id mismatch for order', orderId);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=tran_id_mismatch`);
    }

    const paidAmount = Number(valData.amount || 0);
    const expectedAmount = Number(order.expected_amount || 0);
    if (!expectedAmount || Math.abs(paidAmount - expectedAmount) > 1) {
      console.error('Amount mismatch for order', orderId, { paidAmount, expectedAmount });
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=amount_mismatch`);
    }

    // ---- All checks passed: mark Paid ----
    await orderRef.set({
      payment_status: 'Paid',
      payment_method: valData.card_type || 'SSLCommerz',
      payment_tran_id: tran_id,
      val_id: val_id,
      paid_amount: paidAmount,
      paidAt: new Date().toISOString(),
    }, { merge: true });

    return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);

  } catch (err) {
    console.error('Unhandled Exception in payment-success:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=server_error`);
  }
};
