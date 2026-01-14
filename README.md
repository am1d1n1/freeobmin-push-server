# OneSignal Push Server (Render)

## Deploy on Render (free)
1) Create a new **Web Service**.
2) Upload a ZIP that contains this `server/` folder.
3) Build Command: `npm install`
4) Start Command: `npm start`
5) Add environment variables:
   - `ONESIGNAL_APP_ID`
   - `ONESIGNAL_REST_API_KEY`

## Test locally
```bash
npm install
ONESIGNAL_APP_ID=... ONESIGNAL_REST_API_KEY=... npm start
```

## Endpoint
`POST /notify`

Body:
```json
{
  "to": "ONESIGNAL_PLAYER_ID",
  "title": "Новое сообщение",
  "body": "Вам написали по объявлению"
}
```
