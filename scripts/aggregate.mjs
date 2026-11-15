import { readFile, writeFile } from "node:fs/promises";

const ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const registryPath = `${ROOT}/sources.json`;
const outputPath = `${ROOT}/yuhuyan.json`;

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const output = JSON.parse(await readFile(outputPath, "utf8"));

function isSafeHttps(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return false;
  return true;
}

async function fetchJson(raw) {
  let current = raw;
  for (let i = 0; i <= 3; i++) {
    if (!isSafeHttps(current)) throw new Error("只允许安全的公网 HTTPS 地址");
    const response = await fetch(current, {
      headers: { "accept": "application/json", "user-agent": "Yuhuyan-Config-Aggregator/1.0" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual"
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || i === 3) throw new Error("重定向次数过多或缺少目标地址");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error("配置文件超过 8 MB，已跳过");
    return JSON.parse(text);
  }
  throw new Error("无法获取配置");
}

const arrayFields = ["sites", "parses", "lives", "flags", "ijk", "ads"];
const merged = Object.fromEntries(arrayFields.map(k => [k, []]));
const seen = Object.fromEntries(arrayFields.map(k => [k, new Set()]));
const errors = [];

for (const source of (registry.sources || [])) {
  if (!(source.enabled === true && source.authorized === true && source.redistribution_allowed === true)) continue;
  try {
    const data = await fetchJson(source.url);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("返回内容不是 JSON 配置对象");
    for (const field of arrayFields) {
      if (!Array.isArray(data[field])) continue;
      for (const item of data[field]) {
        if (!item || typeof item !== "object") continue;
        const key = JSON.stringify(item);
        if (!seen[field].has(key)) {
          seen[field].add(key);
          merged[field].push(item);
        }
      }
    }
    if (!output.spider && data.spider) output.spider = data.spider;
    if (!output.wallpaper && data.wallpaper) output.wallpaper = data.wallpaper;
    console.log(`已合并来源：${source.name || source.url}`);
  } catch (error) {
    errors.push(`${source.name || source.url}: ${error.message}`);
    console.warn(`跳过来源 ${source.name || source.url}: ${error.message}`);
  }
}

for (const field of arrayFields) output[field] = merged[field];
output.name = "尤湖沿科技571111598";
output.version = "1.1.0";
output.aggregation = {
  updated_at: new Date().toISOString(),
  source_count: (registry.sources || []).filter(s => s.enabled === true && s.authorized === true && s.redistribution_allowed === true).length,
  item_count: arrayFields.reduce((n, k) => n + output[k].length, 0),
  note: "仅合并已登记并声明获准再发布的配置来源"
};

await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`聚合完成：${output.aggregation.item_count} 项；失败来源 ${errors.length} 个`);
