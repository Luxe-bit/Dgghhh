// /api/payment-success.js
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

// Form Body Parser for Vercel
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
    console.log('1. Payload Received:', JSON.stringify(body));

    const { val_id, tran_id, value_a: orderId } = body;

    // ১. ডাটা চেক
    if (!val_id || !orderId) {
      console.error('ERROR: Missing val_id or orderId', { val_id, orderId });
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=missing_data`);
    }

    // ২. SSLCommerz Validation URL
    const isSandbox = process.env.SSLCZ_IS_SANDBOX !== 'false';
    const sslczBaseUrl = isSandbox 
      ? 'https://sandbox.sslcommerz.com' 
      : 'https://securepay.sslcommerz.com';

    const storeId = process.env.SSLCZ_STORE_ID;
    const storePass = process.env.SSLCZ_STORE_PASSWORD;

    console.log('2. Validating with Store ID:', storeId);

    const validationUrl = `${sslczBaseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${storeId}&store_passwd=${storePass}&v=1&format=json`;

    // Fetch call with Try/Catch
    let valData = {};
    try {
      const valResponse = await fetch(validationUrl);
      valData = await valResponse.json();
      console.log('3. SSLCommerz Response:', JSON.stringify(valData));
    } catch (fetchErr) {
      console.error('Fetch to SSLCommerz failed:', fetchErr);
    }

    // পেমেন্ট স্ট্যাটাস চেক
    if (valData.status !== 'VALID' && valData.status !== 'VALIDATED') {
      console.error('4. Validation Failed! Status:', valData.status);
      return res.redirect(302, `${siteUrl}/order-fail.html?reason=unauthorized_payment`);
    }

    // ৩. Firestore Update
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
        console.log('5. Firebase Order Updated Successfully!');
      } catch (dbErr) {
        console.error('Firebase update error:', dbErr);
      }
    }

    // ৪. Redirect
    return res.redirect(302, `${siteUrl}/order-success.html?orderId=${encodeURIComponent(orderId)}`);

  } catch (err) {
    console.error('CRITICAL SERVER ERROR:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=server_error`);
  }
};
