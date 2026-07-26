// /api/payment-success.js
// SSLCommerz সফল পেমেন্টের পর ব্রাউজারকে POST দিয়ে এখানে রিডাইরেক্ট করে।
// এখানে যাচাই করে payment_status: "Paid" করে দেওয়া হয়, তারপর order-success.html-এ পাঠানো হয়।

const { validateTransaction, markOrderPaid } = require('./_sslcz-helpers');

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    const { val_id, tran_id, value_a: orderId } = body;

    if (!val_id || !orderId) {
      return res.redirect(302, `${process.env.SITE_URL}/order-fail.html?reason=missing_data`);
    }

    const validation = await validateTransaction(val_id);

    if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
      return res.redirect(302, `${process.env.SITE_URL}/order-fail.html?reason=invalid_transaction`);
    }

    await markOrderPaid(orderId, tran_id, validation);

    // ফ্রন্ট-এন্ডের বিদ্যমান order-success.html পেজে রিডাইরেক্ট — orderId কুয়েরি প্যারামে পাঠানো হচ্ছে
    return res.redirect(302, `${process.env.SITE_URL}/order-success.html?orderId=${encodeURIComponent(orderId)}`);
  } catch (err) {
    console.error('payment-success error:', err);
    return res.redirect(302, `${process.env.SITE_URL}/order-fail.html?reason=server_error`);
  }
};
