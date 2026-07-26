// /api/payment-fail.js
// পেমেন্ট ব্যর্থ হলে SSLCommerz এখানে POST করে। অর্ডার status অপরিবর্তিত থাকে (payment_status: "Unpaid" থেকে যায়)।

module.exports = async (req, res) => {
  const body = req.body || {};
  const orderId = body.value_a || '';
  return res.redirect(302, `${process.env.SITE_URL}/order-fail.html?orderId=${encodeURIComponent(orderId)}&reason=payment_failed`);
};
