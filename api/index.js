'use strict';

// Explicit Vercel Function entrypoint.
// Vercel routes /auth/* and /api/* here, preserving the original request URL.
module.exports = require('../server.js');
