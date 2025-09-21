const tslib = require('tslib/tslib.js');
// Ensure tslib.default references the full exports for ESM compatibility
tslib.default = tslib;
module.exports = tslib;
