// /api/payment-cancel.js
// ইউজার নিজে পেমেন্ট বাতিল করলে SSLCommerz এখানে POST করে।

module.exports = async (req, res) => {
  const body = req.body || {};
  const orderId = body.value_a || '';
  return res.redirect(302, `${process.env.SITE_URL}/order-fail.html?orderId=${encodeURIComponent(orderId)}&reason=cancelled`);
};
