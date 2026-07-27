// /api/payment-success.js
// Production-Ready & Secure Payment Validation for SSLCommerz

const admin = require('firebase-admin');
const querystring = require('querystring');

// Firebase Admin Init
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (err) {
    console.error('Firebase init error in payment-success:', err);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

// Form Body Parser for Serverless Environment
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const siteUrl = process.env.SITE_URL || 'https://luxe-bit.github.io/Dgghhh';

  try {
    const body = await parseFormBody(req);
    const { val_id, tran_id, value_a: orderId } = body;

    // ১. প্রয়োজনীয় তথ্য অনুপস্থিত থাকলে Fail পেজে পাঠানো
    if (!val_id || !orderId) {
      console.error('Missing val_id or orderId in callback payload');
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=missing_data`);
    }

    // ২. SSLCommerz Server-to-Server Validation (নিরাপত্তার আসল অংশ)
    const isSandbox = process.env.SSLCZ_IS_SANDBOX !== 'false';
    const sslczBaseUrl = isSandbox 
      ? 'https://sandbox.sslcommerz.com' 
      : 'https://securepay.sslcommerz.com';

    const validationUrl = `${sslczBaseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${process.env.SSLCZ_STORE_ID}&store_passwd=${process.env.SSLCZ_STORE_PASSWORD}&v=1&format=json`;

    const valResponse = await fetch(validationUrl);
    const valData = await valResponse.json();

    // টাকা সত্যি জমা হয়েছে কি না যাচাই
    if (valData.status !== 'VALID' && valData.status !== 'VALIDATED') {
      console.error('SSLCommerz payment validation failed:', valData.status);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=unauthorized_payment`);
    }

    // ৩. আসল পেমেন্ট নিশ্চিত হলে কেবল তখনই Firebase Database আপডেট হবে
    if (db) {
      await db.collection('orders').doc(orderId).set({
        payment_status: 'Paid',
        payment_method: valData.card_type || 'SSLCommerz',
        payment_tran_id: tran_id,
        val_id: val_id,
        paid_amount: valData.amount,
        paidAt: new Date().toISOString()
      }, { merge: true });
    }

    // ৪. কাস্টমারকে আসল Success পেজে পাঠানো
    return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);

  } catch (err) {
    console.error('Server error in payment-success:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=server_error`);
  }
};
