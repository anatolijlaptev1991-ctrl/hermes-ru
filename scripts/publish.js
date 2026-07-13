'use strict';
/**
 * publish.js — Публикация в npm + GitHub (обратный порядок: npm → GitHub → git push)
 *
 * Pre-checks:
 * 1. npm whoami (токен жив?)
 * 2. npm view version != local version (нет дубля?)
 *
 * Порядок: npm publish → gh release create → git commit + push + tag
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function bumpVersion(current) {
  const parts = current.split('.').map(Number);
  parts[2]++;
  return parts.join('.');
}

function updateChangelog(changelogPath, version, hermesVersion, translatedCount) {
  const date = new Date().toISOString().split('T')[0];
  let content = '';
  if (fs.existsSync(changelogPath)) {
    content = fs.readFileSync(changelogPath, 'utf8');
  }

  const entry = `## v${version} (${date})\n\n- Совместимость: Hermes ${hermesVersion}\n- Переведено ${translatedCount} новых ключей\n- Автообновление:RU \n\n`;

  // Вставляем в начало (после заголовка)
  const lines = content.split('\n');
  const insertIdx = lines.findIndex(l => l.startsWith('## '));
  if (insertIdx >= 0) {
    lines.splice(insertIdx, 0, entry);
  } else {
    lines.unshift(entry);
  }

  fs.writeFileSync(changelogPath, lines.join('\n'), 'utf8');
}

async function publish(opts) {
  const { repoDir, hermesVersion, translatedCount, npmToken, npmPackage, changelogPath } = opts;

  // Читаем package.json
  const pkgPath = path.join(repoDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion);

  console.log(`[publish] ${oldVersion} → ${newVersion}`);

  // Обновляем package.json
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // Обновляем compat.json
  const compatPath = path.join(repoDir, 'compat.json');
  if (fs.existsSync(compatPath)) {
    const compat = JSON.parse(fs.readFileSync(compatPath, 'utf8'));
    compat.version = newVersion;
    if (!compat.hermesVersions) compat.hermesVersions = [];
    if (!compat.hermesVersions.includes(hermesVersion)) {
      compat.hermesVersions.push(hermesVersion);
    }
    fs.writeFileSync(compatPath, JSON.stringify(compat, null, 2) + '\n', 'utf8');
  }

  // Обновляем CHANGELOG.md
  updateChangelog(changelogPath, newVersion, hermesVersion, translatedCount);

  // Обновляем README — таблица совместимости
  const readmePath = path.join(repoDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    readme = readme.replace(/\| \d+\.\d+\.\d+ – \d+\.\d+\.\d+ \|/, `| ${compat?.hermesVersions?.[0] || '0.17.0'} – ${hermesVersion} |`);
    readme = readme.replace(/\| \d+\.\d+\.\d+ \|/, `| ${newVersion} |`);
    fs.writeFileSync(readmePath, readme, 'utf8');
  }

  // ─── Pre-checks ───
  // npm whoami
  try {
    execSync('npm whoami', { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env } });
  } catch {
    // Устанавливаем токен
    execSync(`npm config set //registry.npmjs.org/:_authToken ${npmToken}`, { stdio: 'ignore' });
  }

  // Проверка дубля версии
  try {
    const published = execSync(`npm view ${npmPackage} version`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (published === newVersion) {
      console.error(`[publish] Версия ${newVersion} уже опубликована!`);
      throw new Error(`Version ${newVersion} already published`);
    }
  } catch (e) {
    if (e.message.includes('already published')) throw e;
    // 404 = пакет не найден (нормально для первой публикации)
  }

  // ─── 1. npm publish ───
  console.log('[publish] npm publish...');
  execSync(`npm publish --access public`, {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
  console.log(`[publish] ✓ npm: ${npmPackage}@${newVersion}`);

  // ─── 2. GitHub Release ───
  console.log('[publish] Создаю zip...');
  const zipName = `hermes-ru-dist-v${newVersion}.zip`;
  execSync(`python -c "import shutil; shutil.make_archive('hermes-ru-dist-v${newVersion}', 'zip', 'dist')"`, {
    cwd: repoDir, stdio: 'ignore',
  });

  console.log('[publish] gh release create...');
  execSync(`gh release create v${newVersion} "${path.join(repoDir, zipName)}" --title "v${newVersion}" --notes-file "${changelogPath}"`, {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 120000,
  });
  console.log(`[publish] ✓ GitHub: v${newVersion}`);

  // Чистим zip
  try { fs.unlinkSync(path.join(repoDir, zipName)); } catch {}

  // ─── 3. git commit + push + tag ───
  console.log('[publish] git commit + push...');
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync(`git commit -m "chore(release): v${newVersion} — Hermes ${hermesVersion}, ${translatedCount} new keys"`, {
    cwd: repoDir, stdio: 'ignore',
  });
  execSync(`git tag v${newVersion}`, { cwd: repoDir, stdio: 'ignore' });
  execSync('git push --tags', { cwd: repoDir, stdio: 'ignore', timeout: 60000 });
  execSync('git push', { cwd: repoDir, stdio: 'ignore', timeout: 60000 });
  console.log(`[publish] ✓ git: pushed v${newVersion}`);

  return newVersion;
}

module.exports = { publish, bumpVersion };
