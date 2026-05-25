# My Device Agent - Android App

## Ye kya hai?
Ek native Android app jo aapke phone se control panel ko connect karta hai. Web browser ki tarah nahi — ye app directly phone ke **call log, SMS, location, gallery, files, audio, contacts** sab access karta hai.

## Features
- 📞 **Call Log** — Real call history (incoming, outgoing, missed)
- 💬 **SMS** — Saari messages padh sakta hai
- 📍 **GPS** — Live location tracking (background mein bhi)
- 🖼️ **Gallery** — Phone ki saari photos
- 📁 **Files** — Full storage access
- 🎤 **Audio** — Mic recording
- 👥 **Contacts** — All contacts
- 🔋 **Battery & Device Info**
- ✅ **24/7 Background Running** — Foreground service
- ✅ **Auto-start on Boot** — Phone restart par automatically start

## Build Kaise Karein

### Prerequisites
- [Android Studio](https://developer.android.com/studio) install karein
- Android SDK 34 (API Level 34)

### Steps

1. **Android Studio kholein**
2. **"Open"** → `android-app` folder select karein
3. Gradle sync hone do (2-3 min lag sakta hai first time)
4. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
5. APK milega: `app/build/outputs/apk/debug/app-debug.apk`

### Command Line Build (optional)
```bash
cd android-app
chmod +x gradlew
./gradlew assembleDebug
```

## Install Kaise Karein

1. APK file phone mein bhejein (WhatsApp, Telegram, USB)
2. Phone settings → **"Install Unknown Apps"** allow karein
3. APK open karein → Install karein
4. App kholein → **"Grant All Permissions"** button dabayein
5. Saari permissions allow karein
6. Server URL daalein (jaise `https://my-device-control-panel.onrender.com`)
7. **"Connect & Start"** dabayein

## Use Kaise Karein

1. App install karke permissions de do — ek baar
2. Server URL daalke connect karo
3. App minimize kar do — background mein chalti rahegi
4. Phone restart hone par bhi automatically start ho jaayegi
5. Dashboard/Control Panel par sab data dikhega

## Permissions List
| Permission | Kaam |
|-----------|------|
| INTERNET | Server se connect |
| CAMERA | Photo capture |
| RECORD_AUDIO | Audio recording |
| ACCESS_FINE_LOCATION | GPS tracking |
| ACCESS_BACKGROUND_LOCATION | Background mein location |
| READ_CALL_LOG | Call history |
| READ_SMS | SMS messages |
| RECEIVE_SMS | Real-time new SMS |
| READ_CONTACTS | Contacts list |
| READ_EXTERNAL_STORAGE | Files & gallery |
| READ_MEDIA_IMAGES | Photos (Android 13+) |
| FOREGROUND_SERVICE | 24/7 running |
| RECEIVE_BOOT_COMPLETED | Auto-start on boot |
| WAKE_LOCK | Sleep mein bhi active |

## Important Notes
- ⚠️ Phone ki battery optimization OFF karein is app ke liye
- ⚠️ "Don't optimize" select karein battery settings mein
- App ek notification show karegi — wo hata nahi sakte (foreground service ke liye zaruri hai)
- Agar app kill ho jaaye toh notification par tap karke restart karein
