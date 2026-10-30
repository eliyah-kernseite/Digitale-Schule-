'use strict';

const { nowIso } = require('../db');
const { safeEqual } = require('../security/crypto');

/**
 * Koppelt den Telegram-Zugang an das Abo:
 * - Mitglieder bekommen persönliche Einmal-Einladungslinks (1 Person, 1 Stunde gültig).
 * - Tritt jemand über so einen Link bei, merkt sich der Bot die Telegram-ID.
 * - Endet das Abo, entfernt der Bot die Person aus Gruppe und Kanal.
 */
function createTelegram({ db, cfg, logger = console, hasAccessById }) {
  const t = cfg.telegram;
  const enabled = Boolean(t.botToken && (t.groupId || t.channelId));

  async function api(method, body) {
    const res = await fetch(`${t.apiBase}/bot${t.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method} fehlgeschlagen: ${data.description || res.status}`);
    return data.result;
  }

  async function inviteLinks(userId) {
    if (!enabled) return [];
    db.run('INSERT OR IGNORE INTO telegram_links (user_id) VALUES (?)', userId);
    db.run('UPDATE telegram_links SET revoked_at = NULL WHERE user_id = ?', userId);
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const links = [];
    for (const [label, chatId] of [['Gruppe', t.groupId], ['Kanal', t.channelId]]) {
      if (!chatId) continue;
      const link = await api('createChatInviteLink', { chat_id: chatId, name: `u${userId}`, expire_date: expire, member_limit: 1 });
      links.push({ label, url: link.invite_link });
    }
    return links;
  }

  async function removeUser(userId) {
    if (!enabled) return;
    const link = db.get('SELECT * FROM telegram_links WHERE user_id = ?', userId);
    if (!link || !link.telegram_user_id || link.revoked_at) return;
    for (const chatId of [t.groupId, t.channelId]) {
      if (!chatId) continue;
      try {
        await api('banChatMember', { chat_id: chatId, user_id: link.telegram_user_id });
        await api('unbanChatMember', { chat_id: chatId, user_id: link.telegram_user_id, only_if_banned: true });
      } catch (err) {
        logger.warn(`[telegram] Entfernen fehlgeschlagen: ${err.message}`);
      }
    }
    db.run('UPDATE telegram_links SET revoked_at = ? WHERE user_id = ?', nowIso(), userId);
    db.audit(userId, 'telegram.removed');
  }

  /** Wird bei jeder Abo-Änderung aufgerufen. */
  function onAccessChange(userId) {
    if (!enabled || hasAccessById(userId)) return;
    removeUser(userId).catch((err) => logger.warn(`[telegram] ${err.message}`));
  }

  /** Verarbeitet Bot-Updates (Webhook mit geheimem Header). */
  async function handleUpdate(secretHeader, update) {
    if (!enabled || !t.webhookSecret || !safeEqual(secretHeader || '', t.webhookSecret)) return 401;
    const cm = update && update.chat_member;
    if (!cm || !cm.new_chat_member || !cm.new_chat_member.user) return 200;
    const status = cm.new_chat_member.status;
    const tgUser = cm.new_chat_member.user.id;
    const name = cm.invite_link && cm.invite_link.name;
    const match = /^u(\d{1,10})$/.exec(name || '');
    if (status === 'member' && match) {
      const userId = Number(match[1]);
      if (!hasAccessById(userId)) {
        await removeUserByTelegramId(cm.chat.id, tgUser);
        return 200;
      }
      db.run('UPDATE telegram_links SET telegram_user_id = NULL WHERE telegram_user_id = ? AND user_id != ?', tgUser, userId);
      db.run(`INSERT INTO telegram_links (user_id, telegram_user_id, joined_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET telegram_user_id = excluded.telegram_user_id, joined_at = excluded.joined_at, revoked_at = NULL`,
      userId, tgUser, nowIso());
    }
    return 200;
  }

  async function removeUserByTelegramId(chatId, tgUser) {
    try {
      await api('banChatMember', { chat_id: chatId, user_id: tgUser });
      await api('unbanChatMember', { chat_id: chatId, user_id: tgUser, only_if_banned: true });
    } catch (err) {
      logger.warn(`[telegram] ${err.message}`);
    }
  }

  /** Regelmäßiger Abgleich, falls ein Abo ohne Webhook abgelaufen ist. */
  async function sweep() {
    if (!enabled) return;
    const rows = db.all('SELECT user_id FROM telegram_links WHERE telegram_user_id IS NOT NULL AND revoked_at IS NULL');
    for (const row of rows) if (!hasAccessById(row.user_id)) await removeUser(row.user_id);
  }

  return { enabled, inviteLinks, onAccessChange, handleUpdate, sweep, removeUser };
}

module.exports = { createTelegram };
