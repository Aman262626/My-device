package com.mydevice.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            // Auto-start service on boot
            SharedPreferences prefs = context.getSharedPreferences("mydevice", Context.MODE_PRIVATE);
            String serverUrl = prefs.getString("server_url", "");
            String deviceName = prefs.getString("device_name", Build.MODEL);

            if (!serverUrl.isEmpty()) {
                Intent serviceIntent = new Intent(context, DeviceService.class);
                serviceIntent.putExtra("server_url", serverUrl);
                serviceIntent.putExtra("device_name", deviceName);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            }
        }
    }
}
