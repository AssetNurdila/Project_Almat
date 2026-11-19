const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? 'secret123';

function startSimulation({ getBins, sendReading, intervalMs = 3000, onError = console.error }) {
  const fills = new Map();
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const bins = await getBins();
      for (const bin of bins) {
        let fill = fills.has(bin.id) ? fills.get(bin.id) : (bin.fill_percent || 0);
        fill = fill >= 100 ? Math.random() * 3 : Math.min(100, fill + 0.2 + Math.random() * 0.8);
        fills.set(bin.id, fill);
        await sendReading(bin.id, bin.height_cm * (1 - fill / 100));
      }
    } catch (error) { onError(error); }
    finally { running = false; }
  }
  tick();
  return setInterval(tick, intervalMs);
}

if (require.main === module) {
  startSimulation({
    async getBins() {
      const response = await fetch(`${API_URL}/api/bins`);
      if (!response.ok) throw new Error(`GET bins: ${response.status}`);
      return response.json();
    },
    async sendReading(binId, distance_cm) {
      const response = await fetch(`${API_URL}/api/readings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ bin_id: binId, distance_cm })
      });
      if (!response.ok) throw new Error(`POST reading for bin ${binId}: ${response.status}`);
    },
    onError: error => console.error(error.message)
  });
}

module.exports = { startSimulation };
