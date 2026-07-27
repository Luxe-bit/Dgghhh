// /api/payment-success.js
// SSLCommerz সফল পেমেন্টের পর ব্রাউজারকে POST দিয়ে এখানে রিডাইরেক্ট করে।

const { validateTransaction, markOrderPaid } = require('./_sslcz-helpers');
const querystring = require('querystring');

// Vercel-এর জন্য raw body পার্স করার ফাংশন
async function parseFormBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      resolve(querystring.parse(body));
    });
  });
}

module.exports = async (req, res) => {
  // CORS & Methods
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // SITE_URL না থাকলে সরাসরি আপনার GitHub Pages ডোমেইন ব্যবহার করবে
  const siteUrl = process.env.SITE_URL || 'https://luxe-bit.github.io/Dgghhh';

  try {
    // Body Parse করা
    const body = await parseFormBody(req);
    const { val_id, tran_id, value_a: orderId } = body;

    console.log('SSLCommerz Payload Received:', { val_id, tran_id, orderId });

    if (!val_id || !orderId) {
      console.error('Missing val_id or orderId');
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=missing_data`);
    }

    const validation = await validateTransaction(val_id);

    if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
      console.error('Validation status failed:', validation.status);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=invalid_transaction`);
    }

    await markOrderPaid(orderId, tran_id, validation);

    // ফ্রন্ট-এন্ডের order-success.html পেজে রিডাইরেক্ট
    return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);

  } catch (err) {
    console.error('payment-success error:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=server_error`);
  }
};
