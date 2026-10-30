import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const apiUrl = "https://xjjuhe.site/v1/chat/completions";
const allowedProducts = new Set(["銀行定期", "基金配置", "保險保障", "傳承規劃"]);
const allowedRisks = new Set(["穩健型", "平衡型", "成長型"]);
const allowedReturns = new Set(["2–4%", "4–6%", "6–8%+"]);
const allowedPlans = new Set(["流動守成", "平衡成長", "長線增值"]);

async function loadLocalEnv() {
  try {
    const contents = await readFile(path.join(root, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const name = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || process.env[name] !== undefined) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[name] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadLocalEnv();

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "null" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_000) throw Object.assign(new Error("request_too_large"), { status: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function validateChat(payload) {
  const context = payload?.context;
  const messages = payload?.messages;
  if (!context || typeof context !== "object" || Array.isArray(context)) return "缺少方案背景資料。";
  if (!allowedRisks.has(context.riskProfile)) return "風險取向資料無效。";
  if (!allowedPlans.has(context.planName)) return "方案資料無效。";
  if (!allowedReturns.has(context.returnGoal)) return "回報目標資料無效。";
  if (!Array.isArray(context.riskAnswers) || context.riskAnswers.length !== 3 || context.riskAnswers.some((answer) => typeof answer !== "string" || answer.length > 40)) return "風險回答資料無效。";
  if (!Number.isInteger(context.horizon) || context.horizon < 1 || context.horizon > 50) return "規劃年期資料無效。";
  if (!Array.isArray(context.products) || context.products.length > allowedProducts.size || context.products.some((item) => !allowedProducts.has(item))) return "規劃模組資料無效。";
  if (!Array.isArray(context.allocation) || context.allocation.length > 3 || context.allocation.some((item) => !item || !allowedProducts.has(item.name) || !Number.isInteger(item.percent) || item.percent < 0 || item.percent > 100)) return "配置資料無效。";
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 10) return "對話內容無效。";
  if (messages.at(-1)?.role !== "user") return "請輸入一個問題後再送出。";
  if (messages.some((item) => !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 700)) return "每則訊息請控制在 700 字以內。";
  return null;
}

async function handlePlanInsight(req, res) {
  const apiKey = process.env.JUHE_API_KEY?.trim();
  if (!apiKey || apiKey === "replace-with-a-new-key") {
    json(res, 503, { error: "AI 對話服務尚未設定。請在本機 .env 中填入新建立的服務密鑰。" });
    return;
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    json(res, error.status || 400, { error: error.status === 413 ? "本次請求內容過長。" : "請求格式無效。" });
    return;
  }
  const validationError = validateChat(payload);
  if (validationError) {
    json(res, 400, { error: validationError });
    return;
  }

  const model = process.env.JUHE_MODEL?.trim() || "gpt-5.5";
  const contextText = JSON.stringify({
    riskProfile: payload.context.riskProfile,
    riskAnswers: payload.context.riskAnswers,
    planName: payload.context.planName,
    returnGoal: payload.context.returnGoal,
    horizon: payload.context.horizon,
    products: payload.context.products,
    allocation: payload.context.allocation
  });
  const messages = [
    {
      role: "system",
      content: "你是繁體中文的跨境財富規劃教育助理。根據使用者在原型中自選的風險取向、目標和示意配置，提供簡潔、平衡的解讀，指出方案假設、主要波動/流動性/保障注意點，並提出最多兩個可供合資格顧問核實的問題。不要宣稱任何收益，不要保證回報，不要推薦或比較具體金融產品，不要代替持牌人士作適合性評估，也不要作法律、稅務或保險承保結論。若目標回報與風險取向可能不匹配，請溫和指出並解釋。把所有數值稱為用戶輸入或概念示意。回答控制在 180 個中文字內。"
    },
    { role: "user", content: `以下是本次規劃的匿名摘要：${contextText}` },
    ...payload.messages.map(({ role, content }) => ({ role, content }))
  ];

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 500, stream: false }),
      signal: AbortSignal.timeout(45_000)
    });
  } catch {
    json(res, 502, { error: "暫時無法連接 AI 服務，請稍後再試。" });
    return;
  }

  if (!upstream.ok) {
    json(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, {
      error: upstream.status === 401 ? "服務密鑰無效或已停用，請在服務控制台檢查密鑰。" : "AI 服務暫時未能完成回覆，請稍後再試。"
    });
    return;
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    json(res, 502, { error: "AI 服務回應格式無效，請稍後再試。" });
    return;
  }
  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    json(res, 502, { error: "AI 服務沒有返回文字，請稍後再試。" });
    return;
  }
  json(res, 200, { answer: answer.trim() });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  if (!["/index.html", "/styles.css", "/app.js"].includes(requestPath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const filePath = path.resolve(root, `.${decodeURIComponent(requestPath)}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("not_file");
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${host}:${port}`).pathname;
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "null",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600"
    }).end();
    return;
  }
  if (req.method === "POST" && pathname === "/api/plan-insight") {
    let sameOrigin = !req.headers.origin || req.headers.origin === "null";
    if (req.headers.origin && req.headers.origin !== "null") {
      try {
        const origin = new URL(req.headers.origin);
        sameOrigin = ["http:", "https:"].includes(origin.protocol) && origin.host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin) {
      json(res, 403, { error: "請從本機規劃頁面送出問題。" });
      return;
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      json(res, 415, { error: "請使用 JSON 格式。" });
      return;
    }
    await handlePlanInsight(req, res);
    return;
  }
  if (["GET", "HEAD"].includes(req.method)) {
    await serveStatic(req, res, pathname);
    return;
  }
  res.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method not allowed");
}).listen(port, host, () => {
  console.log(`衡渡 prototype running at http://${host}:${port}`);
});
