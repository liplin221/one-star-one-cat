#!/usr/bin/env node
/**
 * one-star-one-cat
 *
 * 两种模式，靠环境变量 ISSUE_NUMBER 是否存在来区分：
 *
 *   star  模式（定时 / 手动）：给新的 stargazer 开 issue @ 他送猫，并写进 README 猫咪墙
 *   issue 模式（issue 被创建）：有人在 issue 里喊「I need another cat」时，直接在该 issue 下回复一只猫
 *
 * 只依赖 Node 20 内置 fetch，不需要安装任何 npm 包。
 */

import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { OWNER, REPO, gh, ghJson, BOT_LOGIN } from './lib/github.mjs';
import { loadJson, saveJson, requestsInWindow, trimRequests } from './lib/state.mjs';
import { makeCat } from './lib/image.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  seenFile: path.join(ROOT, 'data', 'seen_stargazers.json'),
  requestsFile: path.join(ROOT, 'data', 'cat-requests.json'),
  readmeFile: path.join(ROOT, 'README.md'),
  catsDir: path.join(ROOT, 'cats'),
  label: 'cat-delivery',
  // 单轮最多送几只。超出部分下一轮继续，因为只有成功送达才会写进 seen 名单。
  maxPerRun: Number(process.env.MAX_PER_RUN ?? 20),
  stalePageLimit: 2, // 连续扫到这么多页没有新用户就停，避免全量翻页烧配额
  wallStart: '<!-- CATS_WALL_START -->',
  wallEnd: '<!-- CATS_WALL_END -->',
  dryRun: process.env.DRY_RUN === '1',
  delayMs: Number(process.env.DELAY_MS ?? 500), // 躲开 GitHub 次级限流
  // 点名要猫的冷却：同一用户窗口期内最多几只
  cooldownHours: Number(process.env.COOLDOWN_HOURS ?? 24),
  maxPerUser: Number(process.env.MAX_PER_USER ?? 3),
  trigger: /i\s*need\s+another\s+cat|再来一只猫|还要一只猫/i,
};

const ISSUE_NUMBER = process.env.ISSUE_NUMBER ? Number(process.env.ISSUE_NUMBER) : null;
const MODE = ISSUE_NUMBER ? 'issue' : 'star';

/** 把猫图变成能在 issue / README 里引用的链接。文生图返回的是 base64，必须落盘。 */
async function resolveCatUrl(cat, login) {
  if (!cat.base64) return cat.url;

  await mkdir(CONFIG.catsDir, { recursive: true });
  const name = `${login}-${Date.now()}.png`;
  await writeFile(path.join(CONFIG.catsDir, name), Buffer.from(cat.base64, 'base64'));
  // 此刻还拿不到这次提交的 sha，所以用分支名 + t 参数绕开 raw 的 CDN 缓存
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/cats/${name}?t=${Date.now()}`;
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

async function commentOnIssue(number, body) {
  if (CONFIG.dryRun) {
    console.log(`[dry-run] 回复 #${number}：\n${body}`);
    return null;
  }
  const res = await gh(`/repos/${OWNER}/${REPO}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`回复 issue 失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function openCatIssue(user, imageUrl, labelReady) {
  const body = [
    `感谢 @${user.login} 点亮了 **${OWNER}/${REPO}** 的星星，这是你的猫：`,
    '',
    `<img src="${imageUrl}" alt="cat for ${user.login}" width="420">`,
    '',
    '> 一颗星，一只猫。想要再来一只？在这个 issue 下面回复 `I need another cat` 就行。',
    '',
    `<sub>由 <a href="https://github.com/${OWNER}/${REPO}">${OWNER}/${REPO}</a> 自动送达</sub>`,
  ].join('\n');

  if (CONFIG.dryRun) {
    console.log(`[dry-run] 会给 @${user.login} 发：${imageUrl}`);
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
        `<a href="${u.url}"><img src="${u.avatar}&s=64" width="32" height="32" alt="${u.login}" title="${u.login}"></a>&nbsp;<img src="${u.imageUrl}" width="96" alt="cat for ${u.login}">&nbsp;&nbsp;`
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

/** stargazers 接口按 star 时间升序排，新 star 在最后一页，所以先探总页数再从后往前翻 */
async function getLastPage() {
  const res = await gh(`/repos/${OWNER}/${REPO}/stargazers?per_page=1`, {
    headers: { Accept: 'application/vnd.github.star+json' },
  });
  if (!res.ok) throw new Error(`读取 stargazers 失败：${res.status}`);
  if (!res.headers.get('link')) return 1;
  const matched = res.headers.get('link').match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return matched ? Number(matched[1]) : 1;
}

async function collectNewStargazers(seen) {
  const found = [];
  const lastPage = await getLastPage();
  let stale = 0;

  for (let page = lastPage; page >= 1 && stale < CONFIG.stalePageLimit; page -= 1) {
    const list = await ghJson(`/repos/${OWNER}/${REPO}/stargazers?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github.star+json' },
    });
    if (!list.length) break;

    let pageHasNew = false;
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

/** 强制补发模式：按用户名直接送猫，绕过 seen 名单，用于「我还想再要一只」 */
async function getUsersByLogin(logins) {
  const out = [];
  for (const login of logins) {
    const res = await gh(`/users/${login}`);
    if (!res.ok) {
      console.warn(`找不到 GitHub 用户 ${login}，跳过`);
      continue;
    }
    const u = await res.json();
    out.push({ login: u.login, url: u.html_url, avatar: u.avatar_url, starredAt: null });
  }
  return out;
}

async function runStarMode() {
  const seen = await loadJson(CONFIG.seenFile, { updatedAt: null, delivered: {} });
  console.log(`已送过 ${Object.keys(seen.delivered).length} 只猫`);

  const forcedLogins = (process.env.FORCE_USERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const fresh = forcedLogins.length
    ? await getUsersByLogin(forcedLogins)
    : await collectNewStargazers(new Set(Object.keys(seen.delivered)));

  if (forcedLogins.length) console.log(`强制补发模式：${forcedLogins.join(', ')}`);

  if (!fresh.length) {
    console.log('没有新的 star，收工');
    return;
  }
  console.log(`发现 ${fresh.length} 个新 star：${fresh.map((u) => u.login).join(', ')}`);

  const labelReady = CONFIG.dryRun ? false : await ensureLabel();

  const delivered = [];
  for (const user of fresh) {
    const cat = await makeCat(user.login);
    user.imageUrl = await resolveCatUrl(cat, user.login);
    const issue = await openCatIssue(user, user.imageUrl, labelReady);
    // 失败时不写进 seen，下一轮自然重试，避免永久丢猫
    if (!issue && !CONFIG.dryRun) continue;
    delivered.push(user);
    // 强制补发不登记进名单：已 star 的人本来就在名单里，不受影响；
    // 没 star 的人以后真点了 star，还能正常收到一次
    if (!forcedLogins.length) {
      seen.delivered[user.login] = user.starredAt ?? new Date().toISOString();
    }
    if (!CONFIG.dryRun) await new Promise((r) => setTimeout(r, CONFIG.delayMs));
  }

  seen.updatedAt = new Date().toISOString();
  if (!CONFIG.dryRun) await saveJson(CONFIG.seenFile, seen);
  await updateCatsWall(delivered);
  console.log(`本轮送达 ${delivered.length} 只猫`);
}

async function runIssueMode() {
  const login = process.env.ISSUE_AUTHOR ?? '';
  const title = process.env.ISSUE_TITLE ?? '';
  const body = process.env.ISSUE_BODY ?? '';
  const number = ISSUE_NUMBER;

  // 标题或正文任一命中即可
  if (!CONFIG.trigger.test(`${title}\n${body}`)) {
    console.log(`#${number} 没有触发词，跳过`);
    return;
  }
  console.log(`@${login} 在 #${number} 里点名要猫`);

  // 同一个 issue 只回一次
  const comments = await ghJson(`/repos/${OWNER}/${REPO}/issues/${number}/comments?per_page=100`);
  if (comments.some((c) => c.user?.login === BOT_LOGIN)) {
    console.log(`#${number} 已经回过猫了，跳过`);
    return;
  }

  // 冷却：同一用户窗口期内最多 maxPerUser 只
  const requests = await loadJson(CONFIG.requestsFile, {});
  const recent = requestsInWindow(requests, login, CONFIG.cooldownHours);
  if (recent.length >= CONFIG.maxPerUser) {
    console.log(`@${login} ${CONFIG.cooldownHours}h 内已要过 ${recent.length} 只，冷却中`);
    const waitHours = Math.ceil(
      (CONFIG.cooldownHours * 3600_000 - (Date.now() - Date.parse(recent[0]))) / 3600_000
    );
    await commentOnIssue(
      number,
      [
        `@${login} 喵…你最近已经领走 ${recent.length} 只猫了，猫窝快住不下了。`,
        '',
        `每 ${CONFIG.cooldownHours} 小时最多 ${CONFIG.maxPerUser} 只，大约 ${waitHours} 小时后再来吧。`,
      ].join('\n')
    );
    return;
  }

  const cat = await makeCat(login);
  const imageUrl = await resolveCatUrl(cat, login);

  await commentOnIssue(
    number,
    [
      `@${login} 你的猫来了：`,
      '',
      `<img src="${imageUrl}" alt="cat for ${login}" width="420">`,
      '',
      `<sub>每 ${CONFIG.cooldownHours} 小时最多再要 ${CONFIG.maxPerUser} 只 · 来源：${cat.source}</sub>`,
    ].join('\n')
  );

  requests[login] = [...recent, new Date().toISOString()];
  if (!CONFIG.dryRun) {
    await saveJson(CONFIG.requestsFile, trimRequests(requests, CONFIG.cooldownHours));
  }
  console.log(`已回复 #${number}，@${login} 本窗口第 ${recent.length + 1} 只`);
}

const runner = MODE === 'issue' ? runIssueMode : runStarMode;

runner().catch((err) => {
  console.error(err);
  process.exit(1);
});
