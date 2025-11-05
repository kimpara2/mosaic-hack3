// api/health.js
import fs from 'node:fs/promises';
export default async function handler(req, res) {
  try {
    const list = await fs.readdir('public', { withFileTypes: true });
    res.status(200).json({
      ok: true,
      publicFiles: list.map(d => (d.isDirectory() ? d.name + '/' : d.name))
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
