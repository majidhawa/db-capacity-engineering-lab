'use strict';

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

let cachedCredentials;

async function loadDbCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const secretArn = process.env.DB_SECRET_ARN;

  // Fallback for ordinary local runs where Secrets Manager is not used.
  if (!secretArn) {
    cachedCredentials = {
      engine: 'mysql',
      username: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || 'labpassword',
      host: process.env.MYSQL_HOST || 'mysql-db',
      port: Number(process.env.MYSQL_PORT || 3306),
      dbname: process.env.MYSQL_DATABASE || 'capacity_lab',
    };

    return cachedCredentials;
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'eu-west-3',
    endpoint: process.env.AWS_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
  });

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
    })
  );

  if (!response.SecretString) {
    throw new Error('Database secret did not contain SecretString');
  }

  const parsed = JSON.parse(response.SecretString);

  cachedCredentials = {
    engine: parsed.engine,
    username: parsed.username,
    password: parsed.password,
    host: parsed.host,
    port: Number(parsed.port),
    dbname: parsed.dbname,
  };

  console.log(
    `Resolved DB credentials from Secrets Manager: ARN=${secretArn} VersionId=${response.VersionId || 'unknown'}`
  );

  return cachedCredentials;
}

function clearDbCredentialsCache() {
  cachedCredentials = undefined;
}

module.exports = {
  loadDbCredentials,
  clearDbCredentialsCache,
};
