// ============================================
// MY DEVICE AGENT - Runs on the target device
// ============================================

const socket = io();
let deviceId = localStorage.getItem('mydevice_id') || null;
let deviceName = localStorage.getItem('mydevice_name') || '';
let cameraStream = null;
let cameraInterval = null;
let useFrontCamera = true;
let gpsWatchId = null;

// ---- Logging ----
function log(message, type) {
  type = type || 'info';
  var logArea = document.getElementById('logArea');
  if (!logArea) return;
  var entry = document.createElement('div');
  entry.className = 'log-entry ' + type;
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;
}

// ---- Device Detection ----
function detectDeviceType() {
  var ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(ua)) return 'phone';
  if (/laptop/i.test(ua)) return 'laptop';
  return 'desktop';
}

function detectPlatform() {
  var ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectBrowser() {
  var ua = navigator.userAgent;
  if (/chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/edg/i.test(ua)) return 'Edge';
  if (/opera|opr/i.test(ua)) return 'Opera';
  return 'Unknown';
}

// ---- Battery ----
async function getBatteryInfo() {
  try {
    if ('getBattery' in navigator) {
      var battery = await navigator.getBattery();
      return {
        level: battery.level,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// ---- Network ----
function getNetworkInfo() {
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    return {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
      saveData: conn.saveData
    };
  }
  return null;
}

// ---- Storage ----
async function getStorageInfo() {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      var estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        total: estimate.quota || 0
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// ---- Connect Device ----
async function connectDevice() {
  var nameInput = document.getElementById('deviceName');
  deviceName = nameInput.value.trim() || 'My Device';
  localStorage.setItem('mydevice_name', deviceName);

  var battery = await getBatteryInfo();
  var network = getNetworkInfo();
  var storage = await getStorageInfo();

  socket.emit('device:register', {
    deviceId: deviceId,
    name: deviceName,
    type: detectDeviceType(),
    platform: detectPlatform(),
    browser: detectBrowser(),
    screenWidth: screen.width,
    screenHeight: screen.height,
    battery: battery,
    network: network,
    storage: storage
  });
}

// ---- Auto-reconnect if previously connected ----
if (deviceId && deviceName) {
  socket.on('connect', function() {
    connectDevice();
  });
}

// Re-register on reconnect after initial connection
socket.on('reconnect', function() {
  if (deviceId && deviceName) {
    connectDevice();
  }
});

socket.on('device:registered', function(data) {
  deviceId = data.deviceId;
  localStorage.setItem('mydevice_id', deviceId);

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('connectedScreen').style.display = '';
  document.getElementById('connectedName').textContent = deviceName;
  document.getElementById('displayDeviceId').textContent = deviceId.substring(0, 8) + '...';

  log('Connected to control panel', 'success');
  log('Device ID: ' + deviceId, 'info');

  // Start periodic info updates
  startInfoUpdates();
});

// ---- Periodic Info Updates ----
function startInfoUpdates() {
  setInterval(async function() {
    var battery = await getBatteryInfo();
    var network = getNetworkInfo();
    var storage = await getStorageInfo();

    socket.emit('device:update', {
      battery: battery,
      network: network,
      storage: storage
    });
  }, 10000);
}

// ---- Camera Commands ----
socket.on('command:camera:start', async function() {
  log('Camera start requested', 'info');
  updateFeature('fCamera', 'Streaming', true);

  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function(t) { t.stop(); });
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: useFrontCamera ? 'user' : 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    var video = document.getElementById('hiddenVideo');
    video.srcObject = cameraStream;

    var canvas = document.getElementById('hiddenCanvas');
    var ctx = canvas.getContext('2d');
    canvas.width = 640;
    canvas.height = 480;

    // Send frames every 200ms
    cameraInterval = setInterval(function() {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var frame = canvas.toDataURL('image/jpeg', 0.5);
        socket.emit('camera:frame', { frame: frame });
      }
    }, 200);

    log('Camera streaming started', 'success');
  } catch (err) {
    log('Camera error: ' + err.message, 'error');
  }
});

socket.on('command:camera:stop', function() {
  log('Camera stop requested', 'info');
  updateFeature('fCamera', 'Ready', false);

  if (cameraInterval) {
    clearInterval(cameraInterval);
    cameraInterval = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(t) { t.stop(); });
    cameraStream = null;
  }
  log('Camera stopped', 'info');
});

socket.on('command:camera:switch', async function() {
  useFrontCamera = !useFrontCamera;
  log('Switching to ' + (useFrontCamera ? 'front' : 'back') + ' camera', 'info');

  if (cameraStream) {
    cameraStream.getTracks().forEach(function(t) { t.stop(); });
  }

  try {
    if (cameraInterval) clearInterval(cameraInterval);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: useFrontCamera ? 'user' : 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    var video = document.getElementById('hiddenVideo');
    video.srcObject = cameraStream;

    var canvas = document.getElementById('hiddenCanvas');
    var ctx = canvas.getContext('2d');

    cameraInterval = setInterval(function() {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var frame = canvas.toDataURL('image/jpeg', 0.5);
        socket.emit('camera:frame', { frame: frame });
      }
    }, 200);
  } catch (err) {
    log('Camera switch error: ' + err.message, 'error');
  }
});

socket.on('command:camera:capture', async function() {
  log('Capture requested', 'info');

  try {
    var stream = cameraStream;
    var needsCleanup = false;

    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      needsCleanup = true;
    }

    var video = document.getElementById('hiddenVideo');
    video.srcObject = stream;

    // Wait for video to be ready
    await new Promise(function(resolve) {
      if (video.readyState >= 2) { resolve(); return; }
      video.onloadeddata = resolve;
    });

    var canvas = document.getElementById('hiddenCanvas');
    var ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    var image = canvas.toDataURL('image/jpeg', 0.9);

    socket.emit('camera:captured', { image: image });
    log('Photo captured and sent', 'success');

    if (needsCleanup) {
      stream.getTracks().forEach(function(t) { t.stop(); });
    }
  } catch (err) {
    log('Capture error: ' + err.message, 'error');
  }
});

// ---- GPS Commands ----
socket.on('command:gps:start', function() {
  log('GPS tracking started', 'info');
  updateFeature('fGPS', 'Tracking', true);

  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      socket.emit('gps:location', {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        timestamp: pos.timestamp
      });
    },
    function(err) {
      log('GPS error: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

socket.on('command:gps:stop', function() {
  log('GPS tracking stopped', 'info');
  updateFeature('fGPS', 'Ready', false);

  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
});

// ---- File Commands ----
socket.on('command:files:list', async function(data) {
  log('File listing requested: ' + data.path, 'info');
  updateFeature('fFiles', 'Browsing', true);

  try {
    // Use File System Access API if available
    if ('showDirectoryPicker' in window && !window._fileSystemRoot) {
      try {
        window._fileSystemRoot = await window.showDirectoryPicker({ mode: 'read' });
        log('File system access granted', 'success');
      } catch (err) {
        log('File access denied: ' + err.message, 'error');
        socket.emit('files:list', { files: [], path: data.path });
        return;
      }
    }

    if (window._fileSystemRoot) {
      var files = [];
      var targetDir = window._fileSystemRoot;

      // Navigate to the requested path
      if (data.path && data.path !== '/') {
        var parts = data.path.split('/').filter(Boolean);
        for (var i = 0; i < parts.length; i++) {
          try {
            targetDir = await targetDir.getDirectoryHandle(parts[i]);
          } catch (e) {
            log('Directory not found: ' + parts[i], 'error');
            socket.emit('files:list', { files: [], path: data.path });
            return;
          }
        }
      }

      for await (var entry of targetDir.values()) {
        var fileInfo = {
          name: entry.name,
          isDirectory: entry.kind === 'directory',
          path: (data.path === '/' ? '/' : data.path + '/') + entry.name
        };

        if (entry.kind === 'file') {
          try {
            var file = await entry.getFile();
            fileInfo.size = file.size;
            fileInfo.type = file.type;
            fileInfo.lastModified = file.lastModified;
          } catch (e) {
            // ignore
          }
        }

        files.push(fileInfo);
      }

      socket.emit('files:list', { files: files, path: data.path });
      log('Listed ' + files.length + ' items', 'success');
    } else {
      // Fallback: show demo structure
      socket.emit('files:list', {
        files: [
          { name: 'Photos', isDirectory: true, path: '/Photos' },
          { name: 'Downloads', isDirectory: true, path: '/Downloads' },
          { name: 'Documents', isDirectory: true, path: '/Documents' },
          { name: 'Music', isDirectory: true, path: '/Music' },
          { name: 'Videos', isDirectory: true, path: '/Videos' }
        ],
        path: data.path,
        note: 'File System Access API not supported. Showing default structure.'
      });
    }
  } catch (err) {
    log('File list error: ' + err.message, 'error');
    socket.emit('files:list', { files: [], path: data.path });
  }
});

socket.on('command:files:download', async function(data) {
  log('File download requested: ' + data.filePath, 'info');

  try {
    if (window._fileSystemRoot) {
      var parts = data.filePath.split('/').filter(Boolean);
      var fileName = parts.pop();
      var dir = window._fileSystemRoot;

      for (var i = 0; i < parts.length; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }

      var fileHandle = await dir.getFileHandle(fileName);
      var file = await fileHandle.getFile();
      var reader = new FileReader();

      reader.onload = function() {
        socket.emit('files:content', {
          fileName: fileName,
          content: reader.result,
          type: file.type,
          size: file.size
        });
        log('File sent: ' + fileName, 'success');
      };

      reader.readAsDataURL(file);
    }
  } catch (err) {
    log('Download error: ' + err.message, 'error');
  }
});

// ---- Emergency Commands ----
socket.on('command:emergency:alarm', function() {
  log('ALARM TRIGGERED!', 'error');

  // Create alarm sound using Web Audio API
  try {
    var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var oscillator = audioCtx.createOscillator();
    var gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 880;
    gainNode.gain.value = 1;
    oscillator.start();

    // Siren effect
    var alarmInterval = setInterval(function() {
      oscillator.frequency.value = oscillator.frequency.value === 880 ? 660 : 880;
    }, 500);

    // Stop after 30 seconds
    setTimeout(function() {
      clearInterval(alarmInterval);
      oscillator.stop();
      audioCtx.close();
    }, 30000);

    window._alarmStop = function() {
      clearInterval(alarmInterval);
      oscillator.stop();
      audioCtx.close();
    };
  } catch (err) {
    log('Alarm error: ' + err.message, 'error');
  }

  var overlay = document.getElementById('emergencyOverlay');
  document.getElementById('emergencyTitle').textContent = '🔔 ALARM ACTIVE';
  document.getElementById('emergencyText').textContent = 'This device alarm has been activated remotely.';
  overlay.classList.add('active');
});

socket.on('command:emergency:lock', function() {
  log('DEVICE LOCK TRIGGERED!', 'error');

  var overlay = document.getElementById('emergencyOverlay');
  document.getElementById('emergencyTitle').textContent = '🔒 DEVICE LOCKED';
  document.getElementById('emergencyText').textContent = 'This device has been locked remotely by the owner.';
  overlay.classList.add('active');
});

socket.on('command:emergency:message', function(data) {
  log('Emergency message: ' + data.message, 'error');

  var overlay = document.getElementById('emergencyOverlay');
  document.getElementById('emergencyTitle').textContent = '💬 Message';
  document.getElementById('emergencyText').textContent = data.message;
  overlay.classList.add('active');
});

function closeEmergency() {
  document.getElementById('emergencyOverlay').classList.remove('active');
  if (window._alarmStop) {
    window._alarmStop();
    window._alarmStop = null;
  }
}

// ---- Clipboard ----
socket.on('command:clipboard:get', async function() {
  try {
    var text = await navigator.clipboard.readText();
    socket.emit('clipboard:content', { text: text });
    log('Clipboard sent', 'success');
  } catch (err) {
    log('Clipboard error: ' + err.message, 'error');
  }
});

// ---- Helpers ----
function updateFeature(id, text, active) {
  var el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = 'feature-status ' + (active ? 'active' : 'inactive');
  }
}

// ---- Socket Events ----
socket.on('connect', function() {
  log('Connected to server', 'success');
  var badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge connected';
    badge.innerHTML = '<span>🟢</span> Connected';
  }
});

socket.on('disconnect', function() {
  log('Disconnected from server', 'error');
  var badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge disconnected';
    badge.innerHTML = '<span>🔴</span> Disconnected';
  }
});
