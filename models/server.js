// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const User = require('./models/User');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/account-transfer-demo';

// Connect to MongoDB
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

/**
 * Helper responses:
 * - 400: bad request
 * - 404: resource not found
 * - 409: conflict (insufficient funds)
 * - 500: server error
 */

// Create a new user (for testing)
app.post('/users', async (req, res) => {
  try {
    const { name, balance } = req.body || {};
    if (!name || typeof balance !== 'number') {
      return res.status(400).json({ message: 'Provide name (string) and balance (number)' });
    }
    const user = new User({ name, balance });
    await user.save();
    res.status(201).json({ message: 'User created', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's balance
app.get('/users/:id/balance', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ id: user._id, name: user.name, balance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * Transfer endpoint (no DB transactions)
 * Steps:
 *  1) Validate input and existence of both accounts
 *  2) Atomically decrement sender's balance only if balance >= amount using findOneAndUpdate with balance >= amount
 *  3) Credit recipient with an increment
 *  4) If crediting recipient fails (rare), attempt to refund the sender (best-effort)
 */
app.post('/transfer', async (req, res) => {
  const sessionTraceId = Date.now(); // tiny identifier for logs in this request
  try {
    const { fromUserId, toUserId, amount } = req.body || {};

    // Basic validation
    if (!fromUserId || !toUserId || typeof amount !== 'number') {
      return res.status(400).json({ message: 'Provide fromUserId, toUserId, and amount (number)' });
    }
    if (fromUserId === toUserId) {
      return res.status(400).json({ message: 'fromUserId and toUserId cannot be same' });
    }
    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be > 0' });
    }

    // Ensure both users exist
    const [fromUserExists, toUserExists] = await Promise.all([
      User.exists({ _id: fromUserId }),
      User.exists({ _id: toUserId })
    ]);
    if (!fromUserExists) return res.status(404).json({ message: 'Sender account not found' });
    if (!toUserExists) return res.status(404).json({ message: 'Recipient account not found' });

    // Atomically decrement sender's balance if sufficient funds
    const senderUpdate = await User.findOneAndUpdate(
      { _id: fromUserId, balance: { $gte: amount } }, // condition ensures no overdraft
      { $inc: { balance: -amount } },
      { new: true } // return the updated document
    ).lean();

    if (!senderUpdate) {
      // condition failed -> insufficient funds
      return res.status(409).json({ message: 'Insufficient balance' });
    }

    // At this point sender's balance decreased by amount.
    // Now credit the recipient.
    try {
      const recipientUpdate = await User.findByIdAndUpdate(
        toUserId,
        { $inc: { balance: amount } },
        { new: true }
      ).lean();

      if (!recipientUpdate) {
        // extremely unlikely because we checked existence earlier, but handle anyway.
        // Attempt to refund the sender (best-effort)
        await User.findByIdAndUpdate(fromUserId, { $inc: { balance: amount } });
        return res.status(500).json({ message: 'Recipient not found during crediting; transfer rolled back' });
      }

      // Success
      return res.json({
        message: 'Transfer successful',
        from: { id: senderUpdate._id, newBalance: senderUpdate.balance },
        to: { id: recipientUpdate._id, newBalance: recipientUpdate.balance }
      });
    } catch (creditErr) {
      // If crediting fails (network / write error), attempt to refund the sender.
      console.error(`[${sessionTraceId}] Error crediting recipient:`, creditErr);
      try {
        const refund = await User.findByIdAndUpdate(fromUserId, { $inc: { balance: amount } }, { new: true }).lean();
        console.log(`[${sessionTraceId}] Refund applied:`, refund ? refund.balance : 'refund failed');
      } catch (refundErr) {
        // If refund also fails, we are in a bad state. Log and inform client.
        console.error(`[${sessionTraceId}] Refund failed after credit error:`, refundErr);
        return res.status(500).json({
          message: 'Critical error: credit failed and refund failed - manual reconciliation required'
        });
      }
      return res.status(500).json({ message: 'Credit failed; sender refunded (best-effort)' });
    }
  } catch (err) {
    console.error('Transfer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Simple endpoint to list all users (for testing)
app.get('/users', async (req, res) => {
  try {
    const users = await User.find().lean();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
