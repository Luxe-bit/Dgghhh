// /api/_lib/firebaseAdmin.js
// Shared Firebase Admin SDK initializer.
// IMPORTANT: Admin SDK calls bypass Firestore security rules entirely
// (it authenticates as a service account, not as a client), so this is
// the correct way to read/write `orders` from a serverless function —
// no need for public REST reads or loosening your security rules.

const admin = require('firebase-admin');

let db = null;

function getDb() {
  if (db) return db;

  if (!admin.apps.length) {
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT env var is missing');
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(rawAccount);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + e.message);
    }

    // Fix escaped newlines in the private key AFTER parsing JSON.
    // (Doing a raw string .replace(/\n/g, '\\n') BEFORE JSON.parse — like the
    // old code did — actually breaks a correctly-escaped key, which was
    // likely a real cause of your intermittent "Firebase init error" logs.)
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  db = admin.firestore();
  return db;
}

module.exports = { admin, getDb };
