import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('L0.1 - Required files presence in repository', () => {
  const requiredFiles = [
    'Dockerfile',
    'entrypoint.sh',
    'docker-compose.yml',
    'docker-compose.prod.yml',
    '.dockerignore',
    '.env.example',
    '.github/workflows/docker-publish.yml',
    'package.json',
    'server.js',
    'worker.js',
    'README.md'
  ];

  for (const rel of requiredFiles) {
    const full = path.join(ROOT_DIR, rel);
    assert.ok(fs.existsSync(full), `File ${rel} must exist in repo`);
  }
});

test('L0.8 - Server exits with error listing missing variables without DEEPSEEK_API_KEY', () => {
  const res = spawnSync('node', ['server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, DEEPSEEK_API_KEY: '', DOTENV_CONFIG_PATH: 'non-existent' },
    encoding: 'utf8'
  });

  assert.notEqual(res.status, 0, 'Must exit with non-zero code');
  assert.match(
    res.stderr + res.stdout,
    /variables d'environnement requises manquantes/i,
    'Must list missing variables'
  );
  assert.match(
    res.stderr + res.stdout,
    /DEEPSEEK_API_KEY/,
    'Must mention DEEPSEEK_API_KEY'
  );
});

test('L0.5 & L0.6 - Healthz endpoint and root endpoint return 200 with valid configuration', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanseo-test-'));
  const dataDir = path.join(tmpDir, 'data');
  const reportsDir = path.join(tmpDir, 'reports');
  const contentDir = path.join(tmpDir, 'content');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });

  const testEnv = {
    ...process.env,
    PORT: '31024',
    PUBLIC_BASE_URL: 'http://localhost:31024',
    DEEPSEEK_API_KEY: 'sk-test',
    PAGESPEED_API_KEY: 'AIzaTest',
    POLAR_WEBHOOK_SECRET: 'whsec_test',
    POLAR_PRODUCT_49: 'prod-49',
    POLAR_PRODUCT_149: 'prod-149',
    SMTP_URL: 'smtps://user%40scanseo.fr:pass@smtp.mail.ovh.net:465',
    SMTP_FROM: 'ScanSEO <contact@scanseo.fr>',
    CONTACT_EMAIL: 'contact@scanseo.fr',
    ADMIN_USER: 'loic',
    ADMIN_PASSWORD_HASH: '$2b$12$e84cQZ1jZ3QvCjJ03Q61j.YlG5aWjEcfGjYpB0bH4kF7VpE0nUv4G',
    SIGNING_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    DATA_DIR: dataDir,
    REPORTS_DIR: reportsDir,
    CONTENT_DIR: contentDir
  };

  const serverProc = fork(path.join(ROOT_DIR, 'server.js'), [], {
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  try {
    // Wait for server to start
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
      serverProc.stdout.on('data', (data) => {
        if (data.toString().includes('En écoute sur le port 31024')) {
          clearTimeout(timer);
          resolve();
        }
      });
      serverProc.on('error', reject);
    });

    // 1. Check GET /
    const rootRes = await fetch('http://127.0.0.1:31024/');
    assert.equal(rootRes.status, 200, 'GET / must return 200');
    const rootHtml = await rootRes.text();
    assert.match(rootHtml, /ScanSEO/);

    // 2. Check GET /healthz
    const healthRes = await fetch('http://127.0.0.1:31024/healthz');
    assert.equal(healthRes.status, 200, 'GET /healthz must return 200');
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.db, true);
    assert.equal(healthJson.reports, true);
    assert.equal(healthJson.content, true);
    assert.equal(healthJson.mail, 'configured');
    assert.ok(typeof healthJson.queue === 'object');
    assert.equal(healthJson.queue.pending, 0);
    assert.equal(healthJson.queue.running, 0);
    assert.equal(healthJson.queue.failed, 0);

    // 3. Check L0.7bis: /content dynamic update within 5 seconds without restart
    // Initially renders embedded FAQ
    const faqRes1 = await fetch('http://127.0.0.1:31024/faq');
    assert.equal(faqRes1.status, 200);
    const faqText1 = await faqRes1.text();
    assert.match(faqText1, /Foire aux questions/);

    // Create custom FAQ in contentDir/pages/faq.md
    const pagesDir = path.join(contentDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const customFaqPath = path.join(pagesDir, 'faq.md');
    fs.writeFileSync(customFaqPath, '# Titre FAQ Surcharge En Direct\n\nQuestion personnalisée.');

    // Wait short time and query again
    await new Promise((r) => setTimeout(r, 100));
    const faqRes2 = await fetch('http://127.0.0.1:31024/faq');
    assert.equal(faqRes2.status, 200);
    const faqText2 = await faqRes2.text();
    assert.match(faqText2, /Titre FAQ Surcharge En Direct/, 'Must reflect modified file without restart');

    // Remove custom file -> returns to embedded
    fs.unlinkSync(customFaqPath);
    await new Promise((r) => setTimeout(r, 5100)); // wait TTL cache refresh
    const faqRes3 = await fetch('http://127.0.0.1:31024/faq');
    const faqText3 = await faqRes3.text();
    assert.match(faqText3, /Foire aux questions/);

    // 4. Test security on assets
    // Traversal test
    const traversalRes = await fetch('http://127.0.0.1:31024/assets/img/../../etc/passwd');
    assert.ok([400, 404].includes(traversalRes.status), 'Traversal must return 400 or 404');

    // Depositing .js in contentDir
    const maliciousJs = path.join(contentDir, 'exploit.js');
    fs.writeFileSync(maliciousJs, 'console.log("bad");');
    const jsRes = await fetch('http://127.0.0.1:31024/assets/img/exploit.js');
    assert.equal(jsRes.status, 404, '.js file must never be served (404)');

  } finally {
    serverProc.kill('SIGTERM');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
});
