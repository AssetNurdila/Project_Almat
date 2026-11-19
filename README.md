# Almat bin monitor

Minimal Node.js API using Express and SQLite. The database and five demo bins are created automatically on first start. Set `API_KEY` to change the reading key (default: `secret123`). Static files are served from `public/`.

```sh
npm install
npm start
```

Open `http://localhost:3000` in your browser; opening `public/index.html` as a `file://` URL bypasses the API server. New readings are recorded only when sent to the readings API.
For a local demo, run `node simulator.js` in a second terminal while the server is running.

## Deploy on Render

Create a Web Service for this repository with build command `npm install` and start command `npm start`. Add a persistent disk mounted at `/var/data`, set `DB_PATH=/var/data/data.db`, and set a strong `API_KEY`. Set `SIMULATE=true` only when demo readings are wanted; otherwise readings stay unchanged until an API client sends them.
# Project_Almat
