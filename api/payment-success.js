// /api/payment-success.js
const admin = require('firebase-admin');
const querystring = require('querystring');

// Firebase ইনিশিয়ালাইজেশনকে পুরোপুরি সুরক্ষিত (Crash-Proof) রাখা
let db = null;
if (!admin.apps.length) {
  try {
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawAccount) {
      // New line issue handle kora
      const formattedAccount = rawAccount.replace(/\n/g, '\\n');
      const serviceAccount = JSON.parse(formattedAccount);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
    }
  } catch (err) {
    console.error('Firebase init failed gracefully:', err.message);
  }
} else {
  db = admin.firestore();
}

// Vercel Form-Body Parser
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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const siteUrl = process.env.SITE_URL || 'https://luxe-bit.github.io/Dgghhh';

  try {
    // Body Parse করা (GET/POST দুইটার জন্যই সেফ)
    const body = (req.method === 'POST') ? await parseFormBody(req) : (req.query || {});
    const val_id = body.val_id || req.query.val_id;
    const tran_id = body.tran_id || req.query.tran_id;
    const orderId = body.value_a || req.query.value_a || body.orderId || req.query.orderId;

    // ১. প্রয়োজনীয় তথ্য মিসিং চেক
    if (!val_id || !orderId) {
      console.log('Missing val_id or orderId in payload');
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=missing_data`);
    }

    // ২. SSLCommerz Validation Call
    const isSandbox = process.env.SSLCZ_IS_SANDBOX !== 'false';
    const sslczBaseUrl = isSandbox 
      ? 'https://sandbox.sslcommerz.com' 
      : 'https://securepay.sslcommerz.com';

    const storeId = process.env.SSLCZ_STORE_ID;
    const storePass = process.env.SSLCZ_STORE_PASSWORD;

    const validationUrl = `${sslczBaseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${storeId}&store_passwd=${storePass}&v=1&format=json`;

    let valData = {};
    try {
      const response = await fetch(validationUrl);
      valData = await response.json();
    } catch (fErr) {
      console.error('SSLCommerz fetch error:', fErr);
    }

    // পেমেন্ট আসল নাকি ভুয়া চেক
    if (valData.status !== 'VALID' && valData.status !== 'VALIDATED') {
      console.log('Validation status not valid:', valData.status);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=unauthorized_payment`);
    }

    // ৩. Firestore Update (Firebase ঠিক থাকলে আপডেট করবে)
    if (db) {
      try {
        await db.collection('orders').doc(orderId).set({
          payment_status: 'Paid',
          payment_method: valData.card_type || 'SSLCommerz',
          payment_tran_id: tran_id,
          val_id: val_id,
          paid_amount: valData.amount || 0,
          paidAt: new Date().toISOString()
        }, { merge: true });
      } catch (dbErr) {
        console.error('Firestore doc update failed:', dbErr);
      }
    }

    // ৪. Success পেজে রিডাইরেক্ট
    return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);

  } catch (err) {
    console.error('Unhandled Server Exception:', err);
    // কোনো জটিল এরর হলেও সার্ভার ৫০০ মারবে না, সেফলি রিডাইরেক্ট করবে
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=server_error`);
  }
};
