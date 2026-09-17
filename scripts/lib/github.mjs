/**
 * GitHub API 薄封装。统一处理鉴权、超时和错误。
 */

const API = 'https://api.github.com';
const REPO_FULL = process.env.GITHUB_REPOSITORY ?? process.env.REPO ?? '';

if (!REPO_FULL) {
  console.error('缺少 GITHUB_REPOSITORY，格式如 liplin221/one-star-one-cat');
  process.exit(1);
}

const [OWNER, REPO] = REPO_FULL.split('/');
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 8000);

// 机器人自己的登录名，用来识别「这条 issue 我是不是已经回过猫了」
export const BOT_LOGIN = 'github-actions[bot]';

export { OWNER, REPO };

function headers(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'one-star-one-cat',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...extra,
  };
}

export async function gh(pathname, init = {}) {
  return fetch(`${API}${pathname}`, {
    ...init,
    headers: headers(init.headers),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function ghJson(pathname, init = {}) {
  const res = await gh(pathname, init);
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} — ${pathname}`);
  }
  return res.json();
}
