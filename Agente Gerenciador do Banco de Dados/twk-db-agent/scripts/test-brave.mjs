import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const r = await axios.get('https://api.search.brave.com/res/v1/web/search', {
  params: { q: 'OGATA Paris restaurant', count: 5 },
  headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY, 'Accept': 'application/json' },
  validateStatus: () => true,
});
console.log('status:', r.status);
console.log('body:', JSON.stringify(r.data, null, 2).slice(0, 2000));
