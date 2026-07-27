// /api/initiate-payment.js
const querystring = require('querystring');

const IS_SANDBOX = process.env.SSLCZ_IS_SANDBOX !== 'false';
const SSLCZ_BASE = IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com';

// Vercel Body Parser Helper
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch(e) {}
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(querystring.parse(body));
      }
    });
  });
}

// Firebase Project ID (আপনার প্রজেক্ট আইডি বসান অথবা Env থেকে নেবে)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'designtub';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const orderId = body ? body.orderId : null;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    // Firestore REST API দিয়ে সরাসরি ডাটা রিড (No SDK Crash Risk)
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderId}`;
    const fsResponse = await fetch(firestoreUrl);
    
    if (!fsResponse.ok) {
      return res.status(404).json({ error: 'Order not found in Database' });
    }

    const fsData = await fsResponse.json();
    const fields = fsData.fields || {};

    // Extract Order Data Safely
    const paymentStatus = fields.payment_status ? fields.payment_status.stringValue : '';
    if (paymentStatus === 'Paid') {
      return res.status(400).json({ error: 'This order has already been paid' });
    }

    const totalPrice = fields.totalPrice ? Number(fields.totalPrice.doubleValue || fields.totalPrice.integerValue || 0) : 0;
    const totalAmount = totalPrice || Number(fields.total_amount ? fields.total_amount.integerValue || fields.total_amount.doubleValue : 0);

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const addressMap = fields.address ? (fields.address.mapValue ? fields.address.mapValue.fields : {}) : {};
    const cusName = addressMap.name ? addressMap.name.stringValue : 'Customer';
    const cusPhone = addressMap.phone ? addressMap.phone.stringValue : '01700000000';
    const cusAdd = addressMap.address ? addressMap.address.stringValue : 'N/A';
    const cusCity = addressMap.city ? addressMap.city.stringValue : 'Dhaka';
    const cusEmail = fields.customerEmail ? fields.customerEmail.stringValue : 'customer@designtub.com';

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

    const params = new URLSearchParams(postData);
    const sslczResponse = await fetch(`${SSLCZ_BASE}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const sslczData = await sslczResponse.json();

    if (sslczData.status !== 'SUCCESS') {
      console.error('SSLCommerz Error:', sslczData);
      return res.status(400).json({ error: 'SSLCommerz initiation failed', details: sslczData });
    }

    return res.status(200).json({ url: sslczData.GatewayPageURL });

  } catch (err) {
    console.error('Fatal initiate-payment Error:', err);
    return res.status(500).json({ error: 'Server Internal Error', message: err.message });
  }
};  }
};
