// /api/_sslcz-helpers.js
// শেয়ার্ড হেল্পার — যেকোনো ফাইল (যেমন payment-ipn.js) এটা ব্যবহার করতে পারে
// ফাইলের নামের শুরুতে আন্ডারস্কোর (_) থাকায় Vercel এটাকে আলাদা route হিসেবে গণ্য করবে না
//
// NOTE: এখন এটা আলাদা করে Firebase init করে না — firebaseAdmin.js এর
// getDb() ব্যবহার করে, যাতে পুরো প্রজেক্টে একটাই init path থাকে
// (env var মিসম্যাচ বা load-order এর উপর নির্ভর করার ঝুঁকি থাকে না)

const { admin, getDb } = require('./_lib/firebaseAdmin');

const db = getDb();

const IS_SANDBOX = process.env.SSLCZ_IS_SANDBOX !== 'false';
const SSLCZ_BASE = IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com';

/**
 * SSLCommerz-এর কাছে val_id দিয়ে সত্যতা যাচাই করে (spoofed POST ঠেকানোর জন্য এটা বাধ্যতামূলক)
 */
async function validateTransaction(valId) {
  const params = new URLSearchParams({
    val_id: valId,
    store_id: process.env.SSLCZ_STORE_ID,
    store_passwd: process.env.SSLCZ_STORE_PASSWORD,
    v: '1',
    format: 'json',
  });
  const url = `${SSLCZ_BASE}/validator/api/validationserverAPI.php?${params.toString()}`;
  const response = await fetch(url);
  return response.json();
}

/**
 * যাচাই সফল হলে Firestore-এ payment_status: "Paid" করে দেয়।
 * মূল অর্ডার status ("New") স্পর্শ করা হয় না, যাতে অ্যাডমিন প্যানেল ফ্লো অক্ষত থাকে।
 */
async function markOrderPaid(orderId, tranId, validationData) {
  const orderRef = db.collection('orders').doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new Error('Order not found: ' + orderId);

  const order = snap.data();
  // একই অর্ডার দুইবার Paid না হয়ে যায় সেটা নিশ্চিত করা (duplicate IPN ঠেকানো)
  if (order.payment_status === 'Paid') return { alreadyPaid: true };

  await orderRef.set(
    {
      payment_status: 'Paid',
      paymentGateway: 'SSLCommerz',
      payment_verified_tran_id: tranId,
      payment_card_type: validationData.card_type || null,
      payment_bank_tran_id: validationData.bank_tran_id || null,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { alreadyPaid: false };
}

module.exports = { validateTransaction, markOrderPaid, db, admin };
