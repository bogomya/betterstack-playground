/**
 * Run a ClickHouse SQL query against your Better Stack data through the SQL API connection created by bs-verify.
 *   pnpm bs:sql "SELECT count() FROM remote(t<team_id>_bsdemo_otel_spans) WHERE dt > now() - INTERVAL 1 HOUR"
 */
import { loadDotEnv, readState } from './lib/bs.js';

loadDotEnv();
const state = readState();

async function main(): Promise<void> {
  const c = state.connection;
  if (!c?.password) throw new Error('No SQL API connection in .bs-state.json; run pnpm bs:verify first');
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.log('Tables available through this connection:');
    for (const t of Object.values(c.tables ?? {})) console.log('  ' + t);
    return;
  }
  const res = await fetch(`https://${c.host}:443/?output_format_pretty_row_numbers=0`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'), 'Content-Type': 'plain/text' },
    body: /FORMAT\s+\w+\s*$/i.test(query) ? query : `${query} FORMAT JSONEachRow`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

main().catch((err) => {
  console.error('bs-sql failed:', err.message ?? err);
  process.exit(1);
});
