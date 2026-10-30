'use strict';

const nodemailer = require('nodemailer');

/**
 * E-Mail-Versand. Ohne SMTP_URL (nur Entwicklung/Test) landen Mails im
 * Speicher-Postausgang und in der Konsole, damit Links testbar bleiben.
 */
function createMailer(cfg, logger = console) {
  const outbox = [];
  const transport = cfg.mail.smtpUrl ? nodemailer.createTransport(cfg.mail.smtpUrl) : null;

  async function send({ to, subject, text }) {
    const footer = `\n\n—\n${cfg.schoolName} · ${cfg.appUrl}\nDiese Nachricht wurde automatisch versendet.`;
    const message = { from: cfg.mail.from, to, subject: `${subject} · ${cfg.schoolName}`, text: text + footer };
    if (!transport) {
      outbox.push(message);
      if (outbox.length > 200) outbox.shift();
      if (!cfg.isTest) logger.info(`[mail:dev] an ${to}: ${subject}\n${text}\n`);
      return;
    }
    try {
      await transport.sendMail(message);
    } catch (err) {
      // Versandfehler nie an den Browser durchreichen, aber protokollieren.
      logger.error(`[mail] Versand an Empfänger fehlgeschlagen: ${err.message}`);
    }
  }

  return { send, outbox };
}

module.exports = { createMailer };
