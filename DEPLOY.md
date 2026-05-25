# Render par Deploy kaise kare (Step-by-Step Guide)

## Prerequisites

- GitHub account (repo already hai: `Aman262626/My-device`)
- Render account (free plan available)

---

## Step 1: Render par Sign Up / Login

1. **[render.com](https://render.com)** par jaao
2. **"Get Started for Free"** click karo
3. **GitHub se Sign Up** karo (recommended — isse repo auto-connect hoga)

---

## Step 2: New Web Service Create karo

1. Render Dashboard par jaao: [dashboard.render.com](https://dashboard.render.com)
2. **"New +"** button click karo (top-right corner)
3. **"Web Service"** select karo
4. **"Build and deploy from a Git repository"** choose karo
5. **"Connect a repository"** section mein apna GitHub account connect karo
6. Repo list mein se **`Aman262626/My-device`** select karo
7. **"Connect"** click karo

---

## Step 3: Service Settings

Render automatically `render.yaml` detect karega, lekin verify karo:

| Setting | Value |
|---------|-------|
| **Name** | `my-device-control-panel` |
| **Region** | Oregon (US West) |
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server/index.js` |
| **Plan** | Free |

> **Note:** PORT environment variable Render khud set karta hai, manually set karne ki zarurat nahi.

---

## Step 4: Deploy karo

1. Sab settings verify karne ke baad **"Create Web Service"** click karo
2. Render ab build start karega (2-3 min lagega)
3. Deploy successful hone par green **"Live"** badge dikhega

---

## Step 5: App Access karo

Deploy hone ke baad aapko ek URL milega:

```
https://my-device-control-panel.onrender.com
```

- **Dashboard:** `https://my-device-control-panel.onrender.com`
- **Agent Page:** `https://my-device-control-panel.onrender.com/agent`

---

## Step 6: Device Connect karo

1. Apne phone ka browser kholein
2. **`https://my-device-control-panel.onrender.com/agent`** open karo
3. Device ka naam enter karo
4. **"Connect Device"** click karo
5. Camera aur Location permissions allow karo
6. Ab dashboard par apna device dikhega!

---

## Important Notes

### Free Plan Limitations
- Server 15 min inactivity ke baad **sleep** ho jaata hai
- First request par ~30 sec cold start hota hai
- Paid plan ($7/month) mein server always-on rehta hai

### Auto Deploy
- Jab bhi aap GitHub par code push karoge, Render automatically re-deploy karega (`autoDeploy: true` set hai)

### Custom Domain (Optional)
1. Render Dashboard → Settings → Custom Domains
2. Apna domain add karo (e.g., `mydevice.example.com`)
3. DNS mein CNAME record add karo pointing to Render URL

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Deploy fail ho raha hai | Render logs check karo (Dashboard → Logs) |
| WebSocket connect nahi ho raha | Make sure `/socket.io/` path blocked nahi hai |
| Agent page camera access nahi de raha | HTTPS required hai (Render free mein HTTPS deta hai) |
| Health check fail | `/api/devices` endpoint check karo ki kaam kar raha hai |

---

## render.yaml kya karta hai

```yaml
services:
  - type: web                          # Web service type
    name: my-device-control-panel      # Service name
    runtime: node                      # Node.js runtime
    plan: free                         # Free plan
    region: oregon                     # US West region
    buildCommand: npm install          # Dependencies install
    startCommand: node server/index.js # Server start
    autoDeploy: true                   # Auto deploy on git push
    envVars:
      - key: NODE_ENV
        value: production              # Production mode
    healthCheckPath: /api/devices      # Health check endpoint
```

Ye file Render ko batati hai ki aapka app kaise build aur run karna hai. Render isko automatically detect karta hai aur settings apply karta hai.
