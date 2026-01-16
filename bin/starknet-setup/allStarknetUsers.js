require('module-alias/register');
require('dotenv').config({ silent: true });
require('@common/storage/db');
const mongoose = require('mongoose');

const user = mongoose.model('User');

const main = async function () {
  let count = 0;
  const allUsers = await user.find({});

  for (const u of allUsers) {
    if (u.address.length > 50) console.log(u.address);
  }
};

main();
