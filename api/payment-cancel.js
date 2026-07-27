// /api/payment-cancel.js
// ইউজার নিজে পেমেন্ট বাতিল করলে SSLCommerz এখানে POST করে।

const querystring = require('querystring');

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
    return res.redirect(302, `${siteUrl}/order-fail.html?orderId=${encodeURIComponent(orderId)}&reason=cancelled`);
  } catch (err) {
    console.error('payment-cancel error:', err);
    return res.redirect(302, `${siteUrl}/order-fail.html?reason=cancelled`);
  }
};
