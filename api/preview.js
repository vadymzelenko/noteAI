// Vercel Serverless Function: GET /api/preview?url=… (нужен заголовок Authorization: Bearer <токен Supabase>).
// Та же логика, что и в server.js — см. lib/preview.js.
'use strict';

const { handlePreview } = require('../lib/preview');

module.exports = (req, res) => handlePreview(req, res, {
  env: process.env,
  headers: { 'X-Content-Type-Options': 'nosniff' },
});
