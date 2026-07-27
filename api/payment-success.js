// /api/initiate-payment.js
const admin = require('firebase-admin');

// Firebase Admin init (Safe Parse with Try-Catch)
if (!admin.apps.length) {
  try {
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawAccount) {
      const formattedAccount = rawAccount.replace(/\n/g, '\\n');
      const serviceAccount = JSON.parse(formattedAccount);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
  } catch (err) {
    console.error('Firebase Admin init error in initiate-payment:', err.message);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

const IS_SANDBOX = process.env.SSLCZ_IS_SANDBOX !== 'false';
const SSLCZ_BASE = IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    if (!db) return res.status(500).json({ error: 'Database connection failed' });

    // Firestore থেকে অর্ডার লোড
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

    const order = orderSnap.data();

    if (order.payment_status === 'Paid') {
      return res.status(400).json({ error: 'This order has already been paid' });
    }

    const totalAmount = Number(order.totalPrice || order.total_amount || 0);
    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const address = order.address || {};
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
      product_name: (order.items || []).map(i => i.name).join(', ').slice(0, 250) || 'Designtub Order',
      product_category: 'Ceramics',
      product_profile: 'general',
      cus_name: address.name || 'Customer',
      cus_email: order.customerEmail || 'noemail@designtub.com',
      cus_add1: address.address || 'N/A',
      cus_city: address.city || 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: address.phone || '01700000000',
      ship_name: address.name || 'Customer',
      ship_add1: address.address || 'N/A',
      ship_city: address.city || 'Dhaka',
      ship_postcode: '1000',
      ship_country: 'Bangladesh',
      value_a: orderId, // Callback-এ ফেরত পাওয়ার জন্য
    };

    const params = new URLSearchParams(postData);
    const sslczResponse = await fetch(`${SSLCZ_BASE}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const sslczData = await sslczResponse.json();

    if (sslczData.status !== 'SUCCESS') {
      console.error('SSLCommerz init failed:', sslczData);
      return res.status(400).json({ error: 'Failed to initiate payment', details: sslczData });
    }

    await orderRef.set({ payment_tran_id: tranId }, { merge: true });

    return res.status(200).json({ url: sslczData.GatewayPageURL });
  } catch (err) {
    console.error('initiate-payment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
