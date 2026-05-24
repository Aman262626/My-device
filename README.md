# 📱 My Device - Remote Control Panel

A web-based control panel to remotely monitor and control all your devices from anywhere. Access camera, GPS location, files, and more!

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **🏠 Dashboard** — Overview of all connected devices with real-time status
- **📷 Camera Access** — Live camera stream, switch between front/back, capture photos
- **📍 GPS Location** — Real-time location tracking with OpenStreetMap
- **📁 File Manager** — Browse and download files remotely from any device
- **ℹ️ Device Info** — Battery, network, storage, screen info
- **🚨 Emergency** — Sound alarm, lock device, send message, quick snapshot

## How It Works

1. **Server** — Node.js + Express + Socket.IO server acts as the bridge
2. **Dashboard** — Web UI to monitor and control devices (open on any computer/phone)
3. **Agent** — A lightweight page that runs on the target device (phone/tablet/PC)

```
  [Dashboard]  <-->  [Server]  <-->  [Device Agent]
  (Browser)         (Node.js)        (Browser on phone)
```

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/Aman262626/My-device.git
cd My-device
npm install
```

### Run

```bash
npm start
```

The server starts on `http://localhost:3000`.

### Connect a Device

1. Open `http://<your-server-ip>:3000/agent` on the device you want to control
2. Enter a name for the device
3. Click **Connect Device**
4. Grant permissions (camera, location) when prompted

### Access the Dashboard

Open `http://localhost:3000` in your browser to see and control all connected devices.

## Project Structure

```
My-device/
├── server/
│   └── index.js          # Express + Socket.IO server
├── public/
│   ├── index.html         # Dashboard UI
│   ├── css/
│   │   └── style.css      # Styles
│   └── js/
│       ├── app.js         # Dashboard logic
│       └── qrcode.min.js  # QR code library
├── agent/
│   ├── index.html         # Device agent page
│   └── agent.js           # Agent logic
├── package.json
└── README.md
```

## Deployment

### Deploy on Vercel / Railway / Render

1. Push to GitHub
2. Connect repo to your preferred platform
3. Set start command: `npm start`
4. Deploy!

### Local Network

Run the server on any computer in your network. Devices on the same WiFi can connect using the computer's local IP address.

## Security Note

This tool is designed for **personal use** to manage your own devices. For production use, add:
- Authentication (login system)
- HTTPS/SSL encryption
- Access tokens for devices

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS
- **Maps**: OpenStreetMap
- **Real-time**: WebSocket (Socket.IO)
- **APIs Used**: MediaDevices, Geolocation, File System Access, Battery, Network Information

## License

MIT License — see [LICENSE](LICENSE) for details.
