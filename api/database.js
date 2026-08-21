'use strict';

/**
 * database.js
 * -----------------------------------------------------------------------------
 * Connection factories for MySQL and MongoDB.
 */

const fs = require('fs');
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const { loadDbCredentials } = require('./secrets');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo-db:27017';
const MONGO_DB_NAME = process.env.MONGO_DB || 'capacity_lab';

// ---------------------------------------------------------------------------
// MySQL pool (singleton)
// ---------------------------------------------------------------------------
let pool;

async function getPool() {
  if (!pool) {
    const credentials = await loadDbCredentials();

    const mysqlConfig = {
      host: credentials.host,
      port: Number(credentials.port),
      user: credentials.username,
      password: credentials.password,
      database: credentials.dbname,

      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 0,
      connectTimeout: 10_000,
      maxIdle: 2,
      idleTimeout: 60_000,
      enableKeepAlive: true,
    };

    // Aiven requires TLS. Mount the CA certificate into the container and
    // provide its path through MYSQL_SSL_CA when using the managed database.
    if (process.env.MYSQL_SSL_CA) {
      mysqlConfig.ssl = {
        ca: fs.readFileSync(process.env.MYSQL_SSL_CA),
        rejectUnauthorized: true,
      };
    }

    pool = mysql.createPool(mysqlConfig);
  }

  return pool;
}

// ---------------------------------------------------------------------------
// MongoDB client (singleton, lazily connected)
// ---------------------------------------------------------------------------
let mongoClient;
let mongoDb;

async function getMongo() {
  if (!mongoDb) {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5_000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGO_DB_NAME);
  }

  return mongoDb;
}

// ---------------------------------------------------------------------------
// Graceful shutdown helpers
// ---------------------------------------------------------------------------
async function closeAll() {
  if (pool) {
    try {
      await pool.end();
    } catch (_) {
      // ignore shutdown errors
    }
    pool = undefined;
  }

  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch (_) {
      // ignore shutdown errors
    }
    mongoClient = undefined;
    mongoDb = undefined;
  }
}

module.exports = {
  MONGO_URI,
  MONGO_DB_NAME,
  getPool,
  getMongo,
  closeAll,
};
