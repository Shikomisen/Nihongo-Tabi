/**
 * deploy.mjs — one-command publish to GitHub Pages (README §2, Day 1).
 *
 * Pushes the current working tree to a `gh-pages` branch using a detached
 * git worktree, so the deploy never disturbs your checkout or your main
 * branch history.
 *
 *   node tools/deploy.mjs
 *
 * One-time setup on GitHub: Settings → Pages → Source: "Deploy from a
 * branch" → Branch: gh-pages / (root).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'gh-pages';

/** Tracked paths that are build tooling, not part of the served site. */
const EXCLUDED = ['tools', '.gitignore', 'package.json'];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/* ---------- preflight ---------- */

let remote;
try {
  remote = git('remote', 'get-url', 'origin');
} catch {
  fail(
    'No git remote named "origin" is configured, so there is nowhere to deploy.',
    `Create an empty repo on GitHub, then:

  git remote add origin https://github.com/<you>/nihongo-tabi.git
  git push -u origin main
  npm run deploy

Until then the app still runs locally and over your LAN with: npm start`
  );
}

const status = git('status', '--porcelain');
if (status) {
  console.log('! Uncommitted changes present — deploying the working tree as-is:');
  console.log(status.split('\n').map((l) => `    ${l}`).join('\n'));
}

/* ---------- deploy ---------- */

const tmp = resolve(ROOT, '.deploy-worktree');
rmSync(tmp, { recursive: true, force: true });
try { git('worktree', 'prune'); } catch { /* nothing to prune */ }

console.log(`\nDeploying to ${BRANCH} on ${remote}…`);

try {
  // Start the branch from scratch each time — this is a build output, not history.
  try { git('worktree', 'add', '--detach', tmp); }
  catch (e) { fail('Could not create the deploy worktree.', e.stderr || e.message); }

  // `worktree add --detach` has already checked out every tracked file, so
  // the site is on disk before we touch branches. --orphan then makes HEAD
  // unborn while leaving that working tree in place.
  //
  // Do NOT reach for `git checkout HEAD -- <paths>` here: on an orphan
  // branch HEAD does not resolve to a commit, and git fails the whole
  // deploy with "fatal: invalid reference: HEAD". The files are already
  // present; there is nothing to check out.
  execFileSync('git', ['checkout', '--orphan', BRANCH], { cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'] });

  // Strip what shouldn't ship. Everything else in the worktree is the site.
  for (const junk of EXCLUDED) {
    rmSync(resolve(tmp, junk), { recursive: true, force: true });
  }

  // GitHub Pages runs Jekyll by default, which ignores paths beginning with
  // an underscore and can mangle others. This opts the whole site out.
  writeFileSync(resolve(tmp, '.nojekyll'), '');

  execFileSync('git', ['add', '-A'], { cwd: tmp, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', `Deploy ${new Date().toISOString()}`], { cwd: tmp, stdio: 'inherit' });
  execFileSync('git', ['push', '-f', 'origin', `HEAD:${BRANCH}`], { cwd: tmp, stdio: 'inherit' });

  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) {
    const [, user, repo] = match;
    console.log(`\n✓ Deployed. Live in a minute or two at:\n\n    https://${user}.github.io/${repo}/\n`);
    console.log('  If this is the first deploy, enable it once at:');
    console.log(`    https://github.com/${user}/${repo}/settings/pages  →  Branch: ${BRANCH} / (root)\n`);
  } else {
    console.log(`\n✓ Pushed to ${BRANCH}.\n`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  try { git('worktree', 'prune'); } catch { /* best effort */ }
}
