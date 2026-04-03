// /api/test-fn.js — minimal test to verify Vercel serverless functions work
module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, ts: Date.now(), env_keys: Object.keys(process.env).filter(k => k.startsWith('SUPA') || k.startsWith('DATA') || k.startsWith('JWT')) });
};
