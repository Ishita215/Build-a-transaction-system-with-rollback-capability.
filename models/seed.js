// seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/account-transfer-demo';

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to DB for seeding');

  // Remove existing
  await User.deleteMany({});

  // Create two users
  const alice = new User({ name: 'Alice', balance: 1000 });
  const bob = new User({ name: 'Bob',   balance: 500 });

  await alice.save();
  await bob.save();

  console.log('Seeded users:');
  console.log({ alice: { id: alice._id.toString(), name: alice.name, balance: alice.balance }});
  console.log({ bob: { id: bob._id.toString(), name: bob.name, balance: bob.balance }});

  await mongoose.disconnect();
  console.log('Done');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
