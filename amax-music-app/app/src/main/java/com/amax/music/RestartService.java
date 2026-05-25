package com.amax.music;

import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

public class RestartService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Restart the main music service
        Intent serviceIntent = new Intent(this, MusicService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
