// /api/payment-fail.js
const querystring = require('querystring');
const { getDb } = require('./_lib/firebaseAdmin');

const siteUrl = process.env.SITE_URL || 'https://luxe-bit.github.io/Dgghhh';

async function parseBody(req) {
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
    const body = (req.method === 'POST') ? await parseBody(req) : (req.query || {});
    const orderId = body.value_a || req.query.value_a || '';

    // ---- Firestore-এ payment_status ফিরিয়ে আনা, যাতে admin panel-এ ঠিক status দেখা যায় ----
    if (orderId) {
      try {
        const db = getDb();
        const orderRef = db.collection('orders').doc(String(orderId));
        const orderSnap = await orderRef.get();
        if (orderSnap.exists && orderSnap.data().payment_status !== 'Paid') {
          await orderRef.set({ payment_status: 'Unpaid' }, { merge: true });
        }
      } catch (dbErr) {
        console.error('payment-fail: could not update Firestore', dbErr);
        // এই এরর হলেও ইউজারকে redirect করতে দিচ্ছি, যাতে UX ভাঙে না
      }
    }

    return res.redirect(302, `${siteUrl}/order-fail.html?orderId=${encodeURIComponent(orderId)}&reason=payment_failed`);
  } catch (err) {
    console.error('payment-fail error:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=payment_failed`);
  }
};
