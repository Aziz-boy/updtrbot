# RAIS Bot — Setup Guide

## What's included
```
rais-bot/
├── index.js          ← entry point (starts bot + server)
├── bot.js            ← Telegram bot logic + buffer system
├── server.js         ← Express API for the dashboard
├── state.js          ← shared state (buffers, log, counters)
├── setup-gmail.js    ← one-time Gmail OAuth helper
├── package.json
├── .env.example      ← copy to .env and fill in
└── public/
    └── index.html    ← admin dashboard (served at localhost:3000)
```

---

## Step 1 — Install dependencies

```bash
cd rais-bot
npm install
```

---

## Step 2 — Create your Telegram bot

1. Open Telegram, message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the **token** it gives you
4. Add the bot to all your driver groups and **make it an admin** (so it can read messages)
5. Set `BOT_USERNAME` to whatever name you gave it (without the @)

---

## Step 3 — Set up Gmail OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Gmail API**
3. Create **OAuth 2.0 credentials** (Desktop app type)
4. Download the credentials, copy **Client ID** and **Client Secret**
5. Run the setup helper:

```bash
node setup-gmail.js
```

6. It prints a URL — open it, authorize with the Gmail account you want emails sent FROM
7. Paste the code back in the terminal
8. Copy the printed `GMAIL_REFRESH_TOKEN` into your `.env`

---

## Step 4 — Configure .env

```bash
cp .env.example .env
```

Fill in:
```
TELEGRAM_BOT_TOKEN=7123456789:ABCdef...
BOT_USERNAME=rais
GMAIL_CLIENT_ID=123456.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-...
GMAIL_REDIRECT_URI=http://localhost:3000/oauth2callback
GMAIL_REFRESH_TOKEN=1//0g...
DEFAULT_EMAIL_TO=dispatch@yourcompany.com
PORT=3000
DASHBOARD_PASSWORD=your_secure_password
```

---

## Step 5 — Start the bot

```bash
npm start
```

Dashboard is at: **http://localhost:3000**

For production (VPS), use PM2:
```bash
npm install -g pm2
pm2 start index.js --name rais-bot
pm2 save
pm2 startup
```

---

## How to use

**In any driver Telegram group:**

| Command | What it does |
|---|---|
| `@rais picked up 8997849` | Opens 30s buffer for BOL/pickup |
| `@rais delivered 8997849` | Opens 30s buffer for POD/delivery |
| `@rais traffic 8997849` | Opens 30s buffer for traffic photos |
| `@rais done 8997849` | Flushes buffer immediately |
| `@rais undo 8997849` | Cancels the buffer |

**Sending files:**
- Tag the bot → bot opens a 30s buffer
- Driver (or dispatcher) sends 1, 2, 3 files in separate messages — all get collected
- After 30s (or `done`), bot searches Gmail for the load number in the thread subject and replies with all files attached

**Driver notes:**
Any text after the load number gets appended to the email:
```
@rais picked up 8997849 short by 2 pallets, seal #44821
```

---

## Gmail thread matching

The bot searches Gmail for: `subject:8997849`

So make sure your load email threads have the load number in the subject line.
Example subject: `Load 8997849 — Chicago to Dallas — XYZ Freight`

---

## Email templates

**Pickup/BOL:**
> Load #8997849 has been picked up. BOL attached (2 files). Please confirm GTG.

**Delivery/POD:**
> Load #8997849 has been delivered. POD attached (1 file). Please confirm receipt.

**Traffic:**
> Load #8997849 is experiencing a traffic delay. Photos/video attached (3 files).
