#!/usr/bin/env node
/**
 * one-star-one-cat
 *
 * 每发现一个新 star，就给这个人送一只猫：
 *   1. 开一个 issue @ 他，他会在 GitHub 收到站内通知
 *   2. 把他的头像和那只猫追加进 README 的猫咪墙
 *
 * 只依赖 Node 20 内置 fetch，不需要安装任何 npm 包。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  seenFile: path.join(ROOT, 'data', 'seen_stargazers.json'),
  readmeFile: path.join(ROOT, 'README.md'),
  label: 'cat-delivery',
  // 单轮最多送几只。超出部分下一轮继续，因为只有成功送达才会写进 seen 名单。
  maxPerRun: Number(process.env.MAX_PER_RUN ?? 20),
  stalePageLimit: 2, // 连续扫到这么多页没有新用户就停，避免全量翻页烧配额
  // 两次开 issue 之间的间隔，躲开 GitHub 的次级限流。批量补发时尤其需要。
  delayMs: Number(process.env.DELAY_MS ?? 500),
  wallStart: '<!-- CATS_WALL_START -->',
  wallEnd: '<!-- CATS_WALL_END -->',
  dryRun: process.env.DRY_RUN === '1',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 8000),
};

const REPO_FULL = process.env.GITHUB_REPOSITORY ?? process.env.REPO ?? '';
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';

if (!REPO_FULL) {
  console.error('缺少 GITHUB_REPOSITORY，格式如 liplinli/one-star-one-cat');
  process.exit(1);
}

const [OWNER, REPO] = REPO_FULL.split('/');
const API = 'https://api.github.com';

function headers(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'one-star-one-cat',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

async function gh(pathname, init = {}) {
  return fetch(`${API}${pathname}`, {
    ...init,
    headers: headers(init.headers),
    signal: AbortSignal.timeout(CONFIG.timeoutMs),
  });
}

async function ghJson(pathname, init = {}) {
  const res = await gh(pathname, init);
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} — ${pathname}`);
  }
  return res.json();
}

/** 已送过猫的名单。只记用户名，不记时间，因为 unstar 再 star 会刷新 starred_at。 */
async function loadSeen() {
  try {
    const parsed = JSON.parse(await readFile(CONFIG.seenFile, 'utf8'));
    return { updatedAt: parsed.updatedAt ?? null, delivered: parsed.delivered ?? {} };
  } catch {
    return { updatedAt: null, delivered: {} };
  }
}

async function saveSeen(seen) {
  seen.updatedAt = new Date().toISOString();
  if (CONFIG.dryRun) return;
  await writeFile(CONFIG.seenFile, `${JSON.stringify(seen, null, 2)}\n`);
}

/**
 * stargazers 接口按 star 时间升序排，新 star 在最后一页。
 * 先探总页数，再从最后一页往回翻。
 */
async function getLastPage() {
  const res = await gh(`/repos/${OWNER}/${REPO}/stargazers?per_page=1`, {
    headers: { Accept: 'application/vnd.github.star+json' },
  });
  if (!res.ok) throw new Error(`读取 stargazers 失败：${res.status}`);
  if (!res.headers.get('link')) return 1;
  const matched = res.headers.get('link').match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return matched ? Number(matched[1]) : 1;
}

async function getStargazerPage(page) {
  return ghJson(`/repos/${OWNER}/${REPO}/stargazers?per_page=100&page=${page}`, {
    headers: { Accept: 'application/vnd.github.star+json' },
  });
}

async function collectNewStargazers(seen) {
  const found = [];
  const lastPage = await getLastPage();
  let stale = 0;

  for (let page = lastPage; page >= 1 && stale < CONFIG.stalePageLimit; page -= 1) {
    const list = await getStargazerPage(page);
    if (!list.length) break;

    let pageHasNew = false;
    // 页内同样从末尾开始，新的在后
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const user = list[i].user;
      if (!user?.login || seen.has(user.login)) continue;
      pageHasNew = true;
      found.push({
        login: user.login,
        url: user.html_url,
        avatar: user.avatar_url,
        starredAt: list[i].starred_at ?? null,
      });
      if (found.length >= CONFIG.maxPerRun) break;
    }

    stale = pageHasNew ? 0 : stale + 1;
    if (found.length >= CONFIG.maxPerRun) break;
  }

  return found;
}

/** cataas.com 免 key，还能让猫替你说话。says 接口偶发 500，失败降级成不带字的猫。 */
async function catFor(login) {
  const says = encodeURIComponent(`thanks @${login}`);
  const base = `https://cataas.com/cat/says/${says}`;
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(CONFIG.timeoutMs) });
    res.body?.cancel();
    if (res.ok) return `${base}?width=600&random=${Date.now()}`;
  } catch {
    /* 降级 */
  }
  return `https://cataas.com/cat?width=600&random=${Date.now()}`;
}

async function ensureLabel() {
  try {
    const res = await gh(`/repos/${OWNER}/${REPO}/labels/${CONFIG.label}`);
    if (res.ok) return true;
    if (res.status !== 404) return false;

    const created = await gh(`/repos/${OWNER}/${REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: CONFIG.label,
        color: 'f29513',
        description: '一只被送达的小猫',
      }),
    });
    return created.ok;
  } catch {
    return false;
  }
}

async function deliverCat(user, labelReady) {
  const body = [
    `感谢 @${user.login} 点亮了 **${OWNER}/${REPO}** 的星星，这是你的猫：`,
    '',
    `<img src="${user.cat}" alt="cat for ${user.login}" width="420">`,
    '',
    '> 一颗星，一只猫。unstar 再 star 不会重发，但你可以直接开 issue 点名再要一只。',
    '',
    `<sub>由 <a href="https://github.com/${OWNER}/${REPO}">${OWNER}/${REPO}</a> 自动送达</sub>`,
  ].join('\n');

  if (CONFIG.dryRun) {
    console.log(`[dry-run] 会给 @${user.login} 发：${user.cat}`);
    return null;
  }

  const res = await gh(`/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: `🐱 @${user.login} 的小猫到了`,
      body,
      ...(labelReady ? { labels: [CONFIG.label] } : {}),
    }),
  });

  if (!res.ok) {
    console.error(`给 @${user.login} 送猫失败：${res.status} ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function updateCatsWall(users) {
  if (!users.length) return;

  const readme = await readFile(CONFIG.readmeFile, 'utf8');
  const start = readme.indexOf(CONFIG.wallStart);
  const end = readme.indexOf(CONFIG.wallEnd);
  if (start === -1 || end === -1) {
    console.warn('README 里找不到 CATS_WALL 标记，跳过猫咪墙更新');
    return;
  }

  // 扫描顺序是新 -> 旧，墙上按时间正序追加
  const block = users
    .slice()
    .reverse()
    .map(
      (u) =>
        `<a href="${u.url}"><img src="${u.avatar}&s=64" width="32" height="32" alt="${u.login}" title="${u.login}"></a>&nbsp;<img src="${u.cat}" width="96" alt="cat for ${u.login}">&nbsp;&nbsp;`
    )
    .join('\n');

  const head = readme.slice(0, start + CONFIG.wallStart.length);
  const existing = readme.slice(start + CONFIG.wallStart.length, end).trim();
  const tail = readme.slice(end);
  const next = `${head}\n${existing ? `${existing}\n` : ''}${block}\n${tail}`;

  if (CONFIG.dryRun) {
    console.log(`[dry-run] 猫咪墙将新增 ${users.length} 项`);
    return;
  }
  await writeFile(CONFIG.readmeFile, next);
}

async function main() {
  const seen = await loadSeen();
  console.log(`已送过 ${Object.keys(seen.delivered).length} 只猫`);

  const fresh = await collectNewStargazers(new Set(Object.keys(seen.delivered)));
  if (!fresh.length) {
    console.log('没有新的 star，收工');
    return;
  }
  console.log(`发现 ${fresh.length} 个新 star：${fresh.map((u) => u.login).join(', ')}`);

  const labelReady = CONFIG.dryRun ? false : await ensureLabel();

  const delivered = [];
  for (const user of fresh) {
    user.cat = await catFor(user.login);
    const issue = await deliverCat(user, labelReady);
    // 失败时不写进 seen，下一轮自然重试，避免永久丢猫
    if (!issue && !CONFIG.dryRun) continue;
    user.issueUrl = issue?.html_url ?? '';
    delivered.push(user);
    seen.delivered[user.login] = user.starredAt ?? new Date().toISOString();
    if (!CONFIG.dryRun) await new Promise((r) => setTimeout(r, CONFIG.delayMs));
  }

  await saveSeen(seen);
  await updateCatsWall(delivered);
  console.log(`本轮送达 ${delivered.length} 只猫`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
