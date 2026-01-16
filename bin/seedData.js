require('dotenv').config({ silent: true })
const { exec } = require('child_process');
const imports = [ 'asteroids', 'planets', 'events', 'sales' ];

const seedData = function() {
  if (process.env.NODE_ENV !== 'development') return;

  for (let i of imports) {
    exec(`mongoimport --drop --db=influence --collection=${i} --file=./data/${i}.json`, (err, stdout, stderr) => {
      if (err) {
        return;
      }

      console.log(`stdout: ${stdout}`);
      console.log(`stderr: ${stderr}`);
    });
  }

  exec('mongosh influence --eval "db.actionitems.drop()" --quiet');
  exec('mongosh influence --eval "db.buildings.drop()" --quiet');
  exec('mongosh influence --eval "db.crews.drop()" --quiet');
  exec('mongosh influence --eval "db.crewmembers.drop()" --quiet');
  exec('mongosh influence --eval "db.crossings.drop()" --quiet');
  exec('mongosh influence --eval "db.events.drop()" --quiet');
  exec('mongosh influence --eval "db.keyv.drop()" --quiet');
  exec('mongosh influence --eval "db.lots.drop()" --quiet');
};

seedData();
