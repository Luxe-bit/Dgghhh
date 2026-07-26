// /api/payment-ipn.js
// SSLCommerz সার্ভার-টু-সার্ভার IPN পাঠায় — ইউজার ব্রাউজার বন্ধ করে দিলেও এটা payment_status
// আপডেট করে দেবে, তাই এটাই সবচেয়ে নির্ভরযোগ্য উৎস। payment-success.js কে "primary" এবং
// এটাকে "backup / guarantee" হিসেবে ধরা হচ্ছে।

const { validateTransaction, markOrderPaid } = require('./_sslcz-helpers');

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    const { val_id, tran_id, value_a: orderId, status } = body;

    if (!val_id || !orderId) return res.status(400).send('Missing data');
    if (status !== 'VALID') return res.status(200).send('Ignored non-valid status');

    const validation = await validateTransaction(val_id);
    if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
      return res.status(400).send('Validation failed');
    }

    await markOrderPaid(orderId, tran_id, validation);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('payment-ipn error:', err);
    return res.status(500).send('Server error');
  }
};
