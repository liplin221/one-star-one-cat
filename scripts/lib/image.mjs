/**
 * 猫图来源。
 *
 * 默认走 cataas 随机猫，零配置。想换成文生图，只要在仓库 Secrets 里配好
 * IMAGE_PROVIDER + IMAGE_API_KEY 即可，接口是 OpenAI 兼容格式
 * （OpenAI、智谱、硅基流动、混元等国产模型基本都兼容这一套）。
 *
 * 降级链：文生图 -> cataas 带字猫 -> cataas 随机猫，任何一环失败都不会中断流程。
 */

const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 8000);

// {name} 会被替换成 GitHub 用户名
const CAT_PROMPT =
  process.env.IMAGE_PROMPT ??
  'A cute cartoon cat inspired by the name "{name}", soft pastel colors, simple background, sticker style, centered, no text';

async function aiCat(login) {
  const base = process.env.IMAGE_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.IMAGE_MODEL ?? 'gpt-image-1-mini';
  const prompt = CAT_PROMPT.replaceAll('{name}', login);

  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size: process.env.IMAGE_SIZE ?? '1024x1024',
      n: 1,
    }),
    signal: AbortSignal.timeout(Number(process.env.IMAGE_TIMEOUT_MS ?? 60000)),
  });

  if (!res.ok) {
    throw new Error(`文生图接口 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  const item = data.data?.[0] ?? {};
  // 优先拿 base64：接口返回的 url 通常一两个小时就失效，只有落盘才能永久显示
  return { base64: item.b64_json, url: item.url, prompt };
}

/**
 * 返回 { url, source, base64? }。
 * base64 存在时调用方需要落盘，否则图片会失效。
 */
export async function makeCat(login) {
  if (process.env.IMAGE_PROVIDER && process.env.IMAGE_API_KEY) {
    try {
      const img = await aiCat(login);
      if (img.base64 || img.url) return { ...img, source: 'ai' };
      console.warn('文生图没返回图片，降级为随机猫');
    } catch (err) {
      console.warn(`文生图失败，降级为随机猫：${err.message}`);
    }
  }

  const says = encodeURIComponent(`thanks @${login}`);
  const base = `https://cataas.com/cat/says/${says}`;
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    res.body?.cancel();
    if (res.ok) return { url: `${base}?width=600&random=${Date.now()}`, source: 'cataas' };
  } catch {
    /* 继续降级 */
  }
  return { url: `https://cataas.com/cat?width=600&random=${Date.now()}`, source: 'cataas' };
}
