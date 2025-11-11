// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // using Number for currency is fine for demo; in production use integer cents or Decimal128
  balance: { type: Number, required: true, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
