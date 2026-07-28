// /api/cron-check-pending-payments.js
// Vercel Cron প্রতি কিছুক্ষণ পরপর এই endpoint কল করবে।
// যেসব order 15+ মিনিট ধরে "Initiated" অবস্থায় আটকে আছে (মানে browser
// redirect বা IPN কোনোটাই আসেনি), সেগুলো SSLCommerz-এর সাথে সরাসরি
// re-verify করে payment_status ঠিক করে দেয়।

const { getDb } = require('./_lib/firebaseAdmin');

const IS_SANDBOX = process.env.SSLCZ_IS_SANDBOX !== 'false';
const SSLCZ_BASE = IS_SANDBOX
  ? 'https://sandbox.sslcommerz.com'
  : 'https://securepay.sslcommerz.com';

// SSLCommerz-এ tran_id দিয়ে সরাসরি status query (val_id ছাড়াই সম্ভব)
async function queryByTranId(tranId) {
  const params = new URLSearchParams({
    tran_id: tranId,
    store_id: process.env.SSLCZ_STORE_ID,
    store_passwd: process.env.SSLCZ_STORE_PASSWORD,
    v: '1',
    format: 'json',
  });
  const url = `${SSLCZ_BASE}/validator/api/merchantTransIDvalidationAPI.php?${params.toString()}`;
  const response = await fetch(url);
  return response.json();
}

module.exports = async (req, res) => {
  // Vercel Cron ছাড়া অন্য কেউ যেন এই endpoint কল করতে না পারে
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getDb();
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const snapshot = await db.collection('orders')
      .where('payment_status', '==', 'Initiated')
      .get();

    const results = [];

    for (const doc of snapshot.docs) {
      const order = doc.data();

      // ১৫ মিনিটের কম পুরনো হলে এখনই touch করার দরকার নেই (হয়তো এখনো process হচ্ছে)
      if (order.initiatedAt && order.initiatedAt > fifteenMinAgo) continue;
      if (!order.payment_tran_id) continue;

      try {
        const result = await queryByTranId(order.payment_tran_id);
        const txnList = Array.isArray(result) ? result : (result.element || []);
        const txn = txnList[0] || result;

        if (txn && (txn.status === 'VALID' || txn.status === 'VALIDATED')) {
          const paidAmount = Number(txn.amount || 0);
          const expectedAmount = Number(order.expected_amount || 0);
          if (expectedAmount && Math.abs(paidAmount - expectedAmount) <= 1) {
            await doc.ref.set({
              payment_status: 'Paid',
              payment_method: txn.card_type || 'SSLCommerz',
              val_id: txn.val_id || null,
              paid_amount: paidAmount,
              paidAt: new Date().toISOString(),
              recoveredByCron: true,
            }, { merge: true });
            results.push({ orderId: doc.id, result: 'marked_paid' });
            continue;
          }
        }

        // SSLCommerz-এ transaction পাওয়া গেলো না বা invalid — Unpaid ধরে নেওয়া নিরাপদ
        await doc.ref.set({ payment_status: 'Unpaid' }, { merge: true });
        results.push({ orderId: doc.id, result: 'marked_unpaid' });

      } catch (txnErr) {
        console.error('cron: error checking order', doc.id, txnErr.message);
        results.push({ orderId: doc.id, result: 'error', message: txnErr.message });
      }
    }

    return res.status(200).json({ checked: results.length, results });
  } catch (err) {
    console.error('cron-check-pending-payments error:', err);
    return res.status(500).json({ error: err.message });
  }
};
