const fs = require('fs');
function databaseSsl(env = process.env) {
    const ca = env.DB_SSL_CA ? env.DB_SSL_CA.replace(/\\n/g, '\n') : env.DB_SSL_CA_FILE ? fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8') : undefined;
    if (ca || env.DB_SSL_VERIFY === 'true') return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
    // Compatibility bridge for an existing Timeweb private CA. Remove only
    // after installing that cluster's public root certificate and testing TLS.
    if (env.NODE_ENV !== 'test') console.warn('[db] TLS certificate verification is not enabled; configure DB_SSL_CA or DB_SSL_VERIFY=true');
    return { rejectUnauthorized: false };
}
module.exports = { databaseSsl };
