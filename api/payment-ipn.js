// /api/payment-ipn.js
// SSLCommerz সার্ভার-টু-সার্ভার IPN পাঠায় — ইউজার ব্রাউজার বন্ধ করে দিলেও এটা payment_status
// আপডেট করে দেবে, তাই এটাই সবচেয়ে নির্ভরযোগ্য উৎস। payment-success.js কে "primary" এবং
// এটাকে "backup / guarantee" হিসেবে ধরা হচ্ছে।
//
// payment-success.js এর মতোই anti-tamper checks (tran_id বাইন্ডিং + amount মিলছে কিনা)
// এখানেও করা হচ্ছে — নাহলে একটা ভ্যালিড val_id দিয়ে ভুল অর্ডার Paid করে ফেলা সম্ভব ছিল।

const querystring = require('querystring');
const { getDb } = require('./_lib/firebaseAdmin');
const { validateTransaction, markOrderPaid } = require('./_sslcz-helpers');

async function parseFormBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    return req.body;
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

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const body = await parseFormBody(req);
    const { val_id, tran_id, value_a: orderId, status } = body;

    if (!val_id || !orderId || !tran_id) return res.status(400).send('Missing data');
    if (status !== 'VALID') return res.status(200).send('Ignored non-valid status');

    // ---- অর্ডারের সাথে tran_id bind করা আছে কিনা যাচাই (anti-tamper) ----
    const db = getDb();
    const orderRef = db.collection('orders').doc(String(orderId));
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      console.error('IPN: order not found', orderId);
      return res.status(404).send('Order not found');
    }

    const order = orderSnap.data();

    if (order.payment_status === 'Paid') {
      return res.status(200).send('Already paid'); // duplicate IPN — idempotent
    }

    if (order.payment_tran_id !== tran_id) {
      console.error('IPN: tran_id mismatch', { orderId, expected: order.payment_tran_id, got: tran_id });
      return res.status(400).send('tran_id mismatch');
    }

    // ---- SSLCommerz-এর সাথে সরাসরি val_id validate ----
    const validation = await validateTransaction(val_id);
    if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
      return res.status(400).send('Validation failed');
    }

    if (validation.tran_id && validation.tran_id !== order.payment_tran_id) {
      console.error('IPN: validated tran_id mismatch', orderId);
      return res.status(400).send('tran_id mismatch');
    }

    // ---- amount মিলছে কিনা যাচাই ----
    const paidAmount = Number(validation.amount || 0);
    const expectedAmount = Number(order.expected_amount || 0);
    if (!expectedAmount || Math.abs(paidAmount - expectedAmount) > 1) {
      console.error('IPN: amount mismatch', orderId, { paidAmount, expectedAmount });
      return res.status(400).send('Amount mismatch');
    }

    await markOrderPaid(orderId, tran_id, validation);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('payment-ipn error:', err);
    return res.status(500).send('Server error');
  }
};
