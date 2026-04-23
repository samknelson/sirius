// Wrapper that runs `drizzle-kit push --force` and feeds Enter to any
// interactive constraint prompts (e.g. "add unique without truncating").
// Required because the post-merge runner closes stdin and drizzle-kit's
// prompt library otherwise hangs on those prompts.

const { spawn } = require('child_process');

const child = spawn('npm', ['run', 'db:push', '--', '--force'], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: process.env,
});

const sendEnter = () => {
  try { child.stdin.write('\r'); } catch (_) { /* stdin may be closed */ }
};

// Drip Enter keys for the duration of the push to clear any prompts as they appear.
const interval = setInterval(sendEnter, 3000);

child.on('exit', (code) => {
  clearInterval(interval);
  try { child.stdin.end(); } catch (_) { /* ignore */ }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  clearInterval(interval);
  console.error('[post-merge-db-push] spawn error:', err);
  process.exit(1);
});
