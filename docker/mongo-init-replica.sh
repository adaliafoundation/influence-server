#!/bin/bash
# Wait for MongoDB to accept connections
until mongosh --host mongo --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
  sleep 1
done

# Initialize replica set (single-node for local dev)
mongosh --host mongo --quiet --eval '
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "mongo:27017" }]
  })
'
echo "Replica set initialized."
