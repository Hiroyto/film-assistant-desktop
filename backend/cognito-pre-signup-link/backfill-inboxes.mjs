// backfill-inboxes.mjs  (FIL-665)
//
// Accounts made before the sign-up guard hold no inbox reservation, so a
// variant of their address could still open a second account. This reserves
// each live account's inbox (confirmed, or a Google account; enabled) in the
// pool's usage table. An inbox already held by a live account is left alone;
// two live accounts on one inbox are only reported (the older one is kept).
// Also reports existing accounts on a throwaway domain (nothing is changed).
//
// Runs locally with your AWS login through the AWS CLI (no SDK needed).
//   node backfill-inboxes.mjs --pool dev            dry run
//   node backfill-inboxes.mjs --pool dev --apply    write

import { execFileSync } from 'node:child_process';
import { foldInbox, holdsInbox, isDisposable, usageTable } from './signup-guard.mjs';

const POOLS = { dev: 'us-east-1_00T6W3NmV', prod: 'us-east-1_NXkJWCDUF' };
const argv = process.argv.slice(2);
const which = argv.includes('--pool') ? argv[argv.indexOf('--pool') + 1] : 'dev';
const APPLY = argv.includes('--apply');
const poolId = POOLS[which];
if (!poolId) { console.error('--pool dev|prod'); process.exit(1); }
const table = usageTable(poolId);

const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) || 'null');
const attr = (u, name) => u.Attributes?.find((a) => a.Name === name)?.Value;

const users = [];
let token;
do {
  const out = aws('cognito-idp', 'list-users', '--user-pool-id', poolId, ...(token ? ['--pagination-token', token] : []));
  users.push(...(out.Users ?? []));
  token = out.PaginationToken;
} while (token);

const live = users.filter(holdsInbox).filter((u) => attr(u, 'email'))
  .sort((a, b) => String(a.UserCreateDate).localeCompare(String(b.UserCreateDate)));
const byInbox = new Map();
for (const u of live) {
  const inbox = foldInbox(attr(u, 'email'));
  if (!byInbox.has(inbox)) byInbox.set(inbox, []);
  byInbox.get(inbox).push(u);
}

let reserved = 0; let held = 0;
const shared = [];
for (const [inbox, holders] of byInbox) {
  if (holders.length > 1) shared.push({ inbox, users: holders.map((u) => `${u.Username} (${u.UserStatus})`) });
  const got = aws('dynamodb', 'get-item', '--table-name', table, '--consistent-read',
    '--key', JSON.stringify({ userId: { S: `inbox#${inbox}` }, sk: { S: 'account' } }));
  const current = got?.Item?.username?.S;
  if (current && live.some((u) => u.Username === current)) { held += 1; continue; }
  reserved += 1;
  if (APPLY) {
    aws('dynamodb', 'put-item', '--table-name', table, '--item', JSON.stringify({
      userId: { S: `inbox#${inbox}` }, sk: { S: 'account' },
      username: { S: holders[0].Username }, at: { S: new Date().toISOString() }, source: { S: 'backfill' },
    }));
  }
}

const throwaway = live.filter((u) => isDisposable(String(attr(u, 'email')).split('@').pop())).length;
console.log(`${which} pool ${poolId}: ${users.length} accounts, ${live.length} live with an email, ${byInbox.size} inboxes.`);
console.log(`  ${reserved} ${APPLY ? 'reserved' : 'to reserve'}, ${held} already held, ${shared.length} inbox(es) shared by more than one live account, ${throwaway} live account(s) on a throwaway domain.`);
for (const s of shared) console.log(`  shared: ${s.users.join(', ')}`);
if (!APPLY) console.log('  Dry run: add --apply to write.');
