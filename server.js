'use strict';

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { app, startJobs, close } = createApp(cfg);
const stopJobs = startJobs();

const server = app.listen(cfg.port, () => {
  console.info(`${cfg.schoolName} läuft auf ${cfg.appUrl} (Port ${cfg.port}, Zahlung: ${cfg.payment.provider})`);
});
server.headersTimeout = 20_000;
server.requestTimeout = 10 * 60_000; // große Video-Uploads im Adminbereich

function shutdown(signal) {
  console.info(`${signal} empfangen, fahre herunter …`);
  stopJobs();
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
