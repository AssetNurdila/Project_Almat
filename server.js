const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { startSimulation } = require('./simulator');

const app = express();
const dbPath = path.resolve(process.env.DB_PATH || './data.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const port = process.env.PORT || 3000;
const apiKey = process.env.API_KEY ?? 'secret123';

db.exec(`
  CREATE TABLE IF NOT EXISTS bins (
    id INTEGER PRIMARY KEY, name TEXT, lat REAL, lng REAL, height_cm REAL
  );
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY, bin_id INT, distance_cm REAL, fill_percent REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed nearby demo bins only when the database is empty.
if (db.prepare('SELECT COUNT(*) AS count FROM bins').get().count === 0) {
  const seed = db.prepare('INSERT INTO bins (name, lat, lng, height_cm) VALUES (?, ?, ?, 80)');
  const names = ['Abay Avenue', 'Kok Tobe', 'Central Park', 'Medeu', 'Al-Farabi'];
  names.forEach((name, i) => seed.run(name, 43.238 + (i - 2) * 0.012, 76.945 + (i % 2 ? 1 : -1) * 0.014));
}

const listBins = db.prepare(`
  SELECT b.*, r.fill_percent, r.created_at AS last_update
  FROM bins b LEFT JOIN readings r ON r.id =
    (SELECT id FROM readings WHERE bin_id = b.id ORDER BY created_at DESC, id DESC LIMIT 1)
  ORDER BY b.id
`);
const getBin = db.prepare('SELECT id, height_cm FROM bins WHERE id = ?');
const insertReading = db.prepare('INSERT INTO readings (bin_id, distance_cm, fill_percent) VALUES (?, ?, ?)');

function recordReading(binId, distance) {
  const bin = getBin.get(binId);
  if (!bin) throw new Error(`Bin ${binId} not found`);
  const fill = Math.max(0, Math.min(100, (1 - distance / bin.height_cm) * 100));
  const result = insertReading.run(binId, distance, fill);
  return { id: result.lastInsertRowid, bin_id: binId, fill_percent: fill };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/readings', (req, res) => {
  if (req.get('x-api-key') !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  const binId = Number(req.body.bin_id);
  const distance = Number(req.body.distance_cm);
  if (!Number.isInteger(binId) || !Number.isFinite(distance) || distance < 0) {
    return res.status(400).json({ error: 'bin_id and non-negative distance_cm are required' });
  }
  if (!getBin.get(binId)) return res.status(404).json({ error: 'Bin not found' });
  res.status(201).json(recordReading(binId, distance));
});

app.get('/api/bins', (req, res) => {
  res.json(listBins.all());
});

app.get('/api/bins/:id/history', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid bin id' });
  if (!db.prepare('SELECT id FROM bins WHERE id = ?').get(id)) return res.status(404).json({ error: 'Bin not found' });
  res.json(db.prepare('SELECT * FROM readings WHERE bin_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(id));
});

app.post('/api/bins', (req, res) => {
  const { name, lat, lng, height_cm: height } = req.body;
  if (typeof name !== 'string' || !name.trim() || ![lat, lng, height].every(Number.isFinite) || height <= 0) {
    return res.status(400).json({ error: 'name, numeric lat/lng, and positive height_cm are required' });
  }
  const result = db.prepare('INSERT INTO bins (name, lat, lng, height_cm) VALUES (?, ?, ?, ?)')
    .run(name.trim(), lat, lng, height);
  res.status(201).json(db.prepare('SELECT * FROM bins WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/bins/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid bin id' });
  const bin = db.prepare('SELECT id FROM bins WHERE id = ?').get(id);
  if (!bin) return res.status(404).json({ error: 'Bin not found' });
  db.prepare('DELETE FROM readings WHERE bin_id = ?').run(id);
  db.prepare('DELETE FROM bins WHERE id = ?').run(id);
  res.json({ ok: true });
});

if (process.env.SIMULATE === 'true') {
  startSimulation({
    getBins: () => listBins.all(),
    sendReading: (binId, distance) => recordReading(binId, distance)
  });
}

app.listen(port, '0.0.0.0', () => console.log(`Bin API listening on 0.0.0.0:${port} using ${dbPath}`));
