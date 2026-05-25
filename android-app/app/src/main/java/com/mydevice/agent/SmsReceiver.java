package com.mydevice.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * Receives incoming SMS in real-time and can forward to service
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "SmsReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if ("android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {
            Bundle bundle = intent.getExtras();
            if (bundle != null) {
                Object[] pdus = (Object[]) bundle.get("pdus");
                if (pdus != null) {
                    for (Object pdu : pdus) {
                        SmsMessage sms = SmsMessage.createFromPdu((byte[]) pdu);
                        String sender = sms.getDisplayOriginatingAddress();
                        String body = sms.getMessageBody();
                        long timestamp = sms.getTimestampMillis();

                        Log.d(TAG, "SMS from: " + sender + " body: " + body);

                        // The DeviceService will pick this up from the SMS content provider
                        // on the next fetch. Real-time notification is handled via
                        // notification interception in the web agent version.
                    }
                }
            }
        }
    }
}
