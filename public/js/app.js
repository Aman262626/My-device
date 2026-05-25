// ============================================
// MY DEVICE CONTROL PANEL - Main App
// ============================================

const socket = io();
let devices = [];
let capturedPhotos = [];
let currentFilePath = '/';
let cameraActive = false;
let gpsActive = false;

// ---- Navigation ----
function navigateTo(page) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);

  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ---- Toast Notifications ----
function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + message + '</span>';
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

// ---- Device Management ----
function fetchDevices() {
  fetch('/api/devices')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      devices = data;
      updateDashboard();
      updateDeviceSelects();
    });
}

function updateDashboard() {
  var total = devices.length;
  var online = devices.filter(function(d) { return d.online; }).length;
  var batteries = devices.filter(function(d) { return d.battery && d.battery.level !== null; });
  var avgBatt = batteries.length > 0
    ? Math.round(batteries.reduce(function(s, d) { return s + d.battery.level * 100; }, 0) / batteries.length)
    : '--';

  document.getElementById('totalDevices').textContent = total;
  document.getElementById('onlineDevices').textContent = online;
  document.getElementById('deviceCount').textContent = total;
  document.getElementById('activeFeatures').textContent = (cameraActive ? 1 : 0) + (gpsActive ? 1 : 0);
  document.getElementById('avgBattery').textContent = avgBatt !== '--' ? avgBatt + '%' : '--';

  var grid = document.getElementById('devicesGrid');

  if (total === 0) {
    grid.innerHTML =
      '<div class="empty-state" id="noDevices">' +
        '<div class="icon">📱</div>' +
        '<h3>No Devices Connected</h3>' +
        '<p>Open the agent page on your device to connect it to the control panel</p>' +
        '<button class="btn btn-primary" onclick="navigateTo(\'connect\')" style="margin-top:12px">Connect a Device</button>' +
      '</div>';
    return;
  }

  grid.innerHTML = '';

  devices.forEach(function(device) {
    var typeIcon = '📱';
    if (device.type === 'tablet') typeIcon = '📟';
    if (device.type === 'desktop') typeIcon = '🖥️';
    if (device.type === 'laptop') typeIcon = '💻';

    var battText = device.battery && device.battery.level !== null
      ? Math.round(device.battery.level * 100) + '%'
      : '--';
    var netText = device.network && device.network.effectiveType
      ? device.network.effectiveType
      : '--';

    var card = document.createElement('div');
    card.className = 'device-card';
    card.onclick = function() { showDeviceActions(device.id); };
    card.innerHTML =
      '<div class="status-dot ' + (device.online ? 'online' : 'offline') + '"></div>' +
      '<div class="device-icon">' + typeIcon + '</div>' +
      '<h3>' + escapeHtml(device.name) + '</h3>' +
      '<div class="device-type">' + escapeHtml(device.platform) + ' - ' + escapeHtml(device.type) + '</div>' +
      '<div class="device-meta">' +
        '<span>🔋 ' + battText + '</span>' +
        '<span>📡 ' + netText + '</span>' +
        '<span>' + (device.online ? '🟢 Online' : '⚫ Offline') + '</span>' +
      '</div>';
    grid.appendChild(card);
  });
}

function showDeviceActions(deviceId) {
  navigateTo('info');
  var sel = document.getElementById('infoDeviceSelect');
  sel.value = deviceId;
  onInfoDeviceChange();
}

function updateDeviceSelects() {
  var selects = ['cameraDeviceSelect', 'gpsDeviceSelect', 'filesDeviceSelect',
                 'infoDeviceSelect', 'emergencyDeviceSelect'];

  selects.forEach(function(selId) {
    var sel = document.getElementById(selId);
    var current = sel.value;
    var firstOpt = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(firstOpt);

    devices.forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + (d.online ? ' (Online)' : ' (Offline)');
      opt.disabled = !d.online;
      sel.appendChild(opt);
    });

    if (current) sel.value = current;
  });

  // Update connect page device list
  var connectList = document.getElementById('connectDevicesList');
  if (connectList) {
    if (devices.length === 0) {
      connectList.innerHTML = '<div class="empty-state" style="padding:20px"><p>No devices connected yet</p></div>';
    } else {
      connectList.innerHTML = '';
      devices.forEach(function(d) {
        var item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML =
          '<div class="file-icon">' + (d.online ? '🟢' : '⚫') + '</div>' +
          '<div class="file-info">' +
            '<div class="file-name">' + escapeHtml(d.name) + '</div>' +
            '<div class="file-meta">' + d.platform + ' | Last seen: ' + new Date(d.lastSeen).toLocaleString() + '</div>' +
          '</div>';
        connectList.appendChild(item);
      });
    }
  }
}

// ---- Camera ----
function getSelectedCameraDevice() {
  return document.getElementById('cameraDeviceSelect').value;
}

function startCamera() {
  var deviceId = getSelectedCameraDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:camera:start', { deviceId: deviceId });
  cameraActive = true;
  showToast('Starting camera...', 'info');
}

function stopCamera() {
  var deviceId = getSelectedCameraDevice();
  if (!deviceId) return;
  socket.emit('command:camera:stop', { deviceId: deviceId });
  cameraActive = false;
  document.getElementById('cameraFeed').style.display = 'none';
  document.getElementById('cameraPlaceholder').style.display = '';
  showToast('Camera stopped', 'info');
}

function switchCamera() {
  var deviceId = getSelectedCameraDevice();
  if (!deviceId) return;
  socket.emit('command:camera:switch', { deviceId: deviceId });
  showToast('Switching camera...', 'info');
}

function capturePhoto() {
  var deviceId = getSelectedCameraDevice();
  if (!deviceId) return;
  socket.emit('command:camera:capture', { deviceId: deviceId });
  showToast('Capturing photo...', 'info');
}

function onCameraDeviceChange() {
  stopCamera();
}

socket.on('camera:frame', function(data) {
  var feed = document.getElementById('cameraFeed');
  var placeholder = document.getElementById('cameraPlaceholder');
  feed.src = data.frame;
  feed.style.display = '';
  placeholder.style.display = 'none';
});

socket.on('camera:captured', function(data) {
  capturedPhotos.unshift(data.image);
  updateCapturedPhotos();
  showToast('Photo captured!', 'success');
});

function updateCapturedPhotos() {
  var container = document.getElementById('capturedPhotos');
  if (capturedPhotos.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><p>No photos captured yet</p></div>';
    return;
  }
  container.innerHTML = '';
  capturedPhotos.forEach(function(photo, idx) {
    var div = document.createElement('div');
    div.className = 'captured-photo';
    div.onclick = function() { openLightbox(photo); };
    div.innerHTML = '<img src="' + photo + '" alt="Photo ' + (idx + 1) + '">';
    container.appendChild(div);
  });
}

// ---- GPS ----
function getSelectedGpsDevice() {
  return document.getElementById('gpsDeviceSelect').value;
}

function startGPS() {
  var deviceId = getSelectedGpsDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:gps:start', { deviceId: deviceId });
  gpsActive = true;
  showToast('Starting GPS tracking...', 'info');
}

function stopGPS() {
  var deviceId = getSelectedGpsDevice();
  if (!deviceId) return;
  socket.emit('command:gps:stop', { deviceId: deviceId });
  gpsActive = false;
  showToast('GPS tracking stopped', 'info');
}

function onGpsDeviceChange() {
  stopGPS();
}

socket.on('gps:location', function(data) {
  document.getElementById('gpsLat').textContent = data.latitude ? data.latitude.toFixed(6) : '--';
  document.getElementById('gpsLng').textContent = data.longitude ? data.longitude.toFixed(6) : '--';
  document.getElementById('gpsAccuracy').textContent = data.accuracy ? Math.round(data.accuracy) + 'm' : '--';

  if (data.latitude && data.longitude) {
    var mapContainer = document.getElementById('mapContainer');
    mapContainer.innerHTML = '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=' +
      (data.longitude - 0.01) + '%2C' + (data.latitude - 0.01) + '%2C' +
      (data.longitude + 0.01) + '%2C' + (data.latitude + 0.01) +
      '&layer=mapnik&marker=' + data.latitude + '%2C' + data.longitude +
      '" style="width:100%;height:100%;border:none"></iframe>';
  }
});

// ---- File Manager ----
function getSelectedFilesDevice() {
  return document.getElementById('filesDeviceSelect').value;
}

function browseFiles(path) {
  var deviceId = getSelectedFilesDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  currentFilePath = path || '/';
  socket.emit('command:files:list', { deviceId: deviceId, path: currentFilePath });
  updateBreadcrumb();
}

function onFilesDeviceChange() {
  currentFilePath = '/';
  browseFiles('/');
}

function updateBreadcrumb() {
  var bc = document.getElementById('fileBreadcrumb');
  var parts = currentFilePath.split('/').filter(Boolean);
  var html = '<span onclick="browseFiles(\'/\')">🏠 Root</span>';
  var path = '';
  parts.forEach(function(part) {
    path += '/' + part;
    var p = path;
    html += '<span class="separator">/</span><span onclick="browseFiles(\'' + escapeHtml(p) + '\')">' + escapeHtml(part) + '</span>';
  });
  bc.innerHTML = html;
}

function downloadFile(filePath) {
  var deviceId = getSelectedFilesDevice();
  if (!deviceId) return;
  socket.emit('command:files:download', { deviceId: deviceId, filePath: filePath });
  showToast('Requesting file...', 'info');
}

socket.on('files:list', function(data) {
  var list = document.getElementById('fileList');
  if (!data.files || data.files.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:30px"><p>This folder is empty</p></div>';
    return;
  }

  list.innerHTML = '';
  // Sort: folders first
  var files = data.files.sort(function(a, b) {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  files.forEach(function(file) {
    var icon = file.isDirectory ? '📁' : getFileIcon(file.name);
    var item = document.createElement('div');
    item.className = 'file-item';

    if (file.isDirectory) {
      item.onclick = function() { browseFiles(file.path); };
    }

    var sizeText = file.isDirectory ? '--' : formatFileSize(file.size || 0);

    item.innerHTML =
      '<div class="file-icon">' + icon + '</div>' +
      '<div class="file-info">' +
        '<div class="file-name">' + escapeHtml(file.name) + '</div>' +
        '<div class="file-meta">' + sizeText + '</div>' +
      '</div>' +
      (!file.isDirectory ?
        '<div class="file-actions">' +
          '<button class="btn-icon" title="Download" data-filepath="' + escapeHtml(file.path) + '">⬇️</button>' +
        '</div>' : '');
    list.appendChild(item);

    // Add download event
    var dlBtn = item.querySelector('[data-filepath]');
    if (dlBtn) {
      dlBtn.onclick = function(e) {
        e.stopPropagation();
        downloadFile(file.path);
      };
    }
  });
});

socket.on('files:content', function(data) {
  if (data.content && data.fileName) {
    var a = document.createElement('a');
    a.href = data.content;
    a.download = data.fileName;
    a.click();
    showToast('File downloaded: ' + data.fileName, 'success');
  }
});

function getFileIcon(name) {
  var ext = name.split('.').pop().toLowerCase();
  var icons = {
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', aac: '🎵',
    pdf: '📄', doc: '📝', docx: '📝', txt: '📝', md: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    apk: '📲', exe: '💿', dmg: '💿',
    js: '📜', py: '📜', html: '📜', css: '📜', json: '📜'
  };
  return icons[ext] || '📄';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ---- Device Info ----
function onInfoDeviceChange() {
  var deviceId = document.getElementById('infoDeviceSelect').value;
  if (!deviceId) return;

  var device = devices.find(function(d) { return d.id === deviceId; });
  if (!device) return;

  document.getElementById('infoName').textContent = device.name;
  document.getElementById('infoType').textContent = device.type;
  document.getElementById('infoPlatform').textContent = device.platform;
  document.getElementById('infoBrowser').textContent = device.browser;
  document.getElementById('infoScreen').textContent =
    device.screenWidth + ' x ' + device.screenHeight;

  if (device.battery) {
    var level = Math.round(device.battery.level * 100);
    document.getElementById('infoBatteryLevel').textContent = level + '%';
    document.getElementById('infoBatteryCharging').textContent =
      device.battery.charging ? 'Yes ⚡' : 'No';
    document.getElementById('batteryBar').style.width = level + '%';
    document.getElementById('batteryBar').className = 'fill ' +
      (level > 50 ? 'green' : level > 20 ? 'yellow' : 'red');
  }

  if (device.network) {
    document.getElementById('infoNetType').textContent =
      device.network.effectiveType || '--';
    document.getElementById('infoNetDown').textContent =
      device.network.downlink ? device.network.downlink + ' Mbps' : '--';
    document.getElementById('infoNetRTT').textContent =
      device.network.rtt ? device.network.rtt + ' ms' : '--';
    document.getElementById('infoNetOnline').textContent =
      navigator.onLine ? 'Yes' : 'No';
  }

  if (device.storage) {
    document.getElementById('infoStorageUsed').textContent =
      formatFileSize(device.storage.used || 0);
    document.getElementById('infoStorageTotal').textContent =
      formatFileSize(device.storage.total || 0);
    var pct = device.storage.total > 0
      ? Math.round((device.storage.used / device.storage.total) * 100)
      : 0;
    document.getElementById('storageBar').style.width = pct + '%';
  }
}

// ---- Emergency ----
function triggerAlarm() {
  var deviceId = document.getElementById('emergencyDeviceSelect').value;
  if (!deviceId) { showToast('Please select a device', 'error'); return; }
  socket.emit('command:emergency:alarm', { deviceId: deviceId });
  showToast('Alarm triggered on device!', 'success');
}

function triggerLock() {
  var deviceId = document.getElementById('emergencyDeviceSelect').value;
  if (!deviceId) { showToast('Please select a device', 'error'); return; }
  socket.emit('command:emergency:lock', { deviceId: deviceId });
  showToast('Lock command sent!', 'success');
}

function showMessageModal() {
  document.getElementById('messageModal').classList.add('active');
}

function closeMessageModal() {
  document.getElementById('messageModal').classList.remove('active');
}

function sendEmergencyMessage() {
  var deviceId = document.getElementById('emergencyDeviceSelect').value;
  var msg = document.getElementById('emergencyMessage').value;
  if (!deviceId) { showToast('Please select a device', 'error'); return; }
  if (!msg.trim()) { showToast('Please enter a message', 'error'); return; }
  socket.emit('command:emergency:message', { deviceId: deviceId, message: msg });
  closeMessageModal();
  document.getElementById('emergencyMessage').value = '';
  showToast('Message sent to device!', 'success');
}

var _emergencySnapshotHandler = null;

function emergencyCapture() {
  var deviceId = document.getElementById('emergencyDeviceSelect').value;
  if (!deviceId) { showToast('Please select a device', 'error'); return; }
  socket.emit('command:camera:capture', { deviceId: deviceId });
  showToast('Taking snapshot...', 'info');

  if (_emergencySnapshotHandler) {
    socket.off('camera:captured', _emergencySnapshotHandler);
  }

  _emergencySnapshotHandler = function(data) {
    var container = document.getElementById('emergencySnapshot');
    container.innerHTML = '<img src="' + data.image + '" style="max-width:100%;border-radius:12px;margin-top:8px" alt="Snapshot">';
    socket.off('camera:captured', _emergencySnapshotHandler);
    _emergencySnapshotHandler = null;
  };
  socket.on('camera:captured', _emergencySnapshotHandler);
}

// ---- Lightbox ----
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

// ---- Connect Device Page ----
function setupAgentUrl() {
  var url = window.location.origin + '/agent';
  document.getElementById('agentUrl').textContent = url;
  generateQR(url);
}

function copyAgentUrl() {
  var url = window.location.origin + '/agent';
  navigator.clipboard.writeText(url).then(function() {
    showToast('URL copied!', 'success');
  });
}

function generateQR(url) {
  var container = document.getElementById('qrCanvas');
  if (!container) return;
  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: url,
      width: 200,
      height: 200,
      colorDark: '#3b82f6',
      colorLight: '#1a2235',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

// ---- Utilities ----
function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Socket Events ----
socket.on('devices:updated', fetchDevices);
socket.on('connect', function() {
  showToast('Connected to server', 'success');
  fetchDevices();
});
socket.on('disconnect', function() {
  showToast('Disconnected from server', 'error');
});

// ---- Init ----
document.addEventListener('DOMContentLoaded', function() {
  fetchDevices();
  setupAgentUrl();
});
