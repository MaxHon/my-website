const riskQuestions = { 1: 2, 2: 2, 3: 2 };
const selectedProducts = new Set(["deposit", "fund", "insurance", "legacy"]);
let selectedPlan = "balanced";
let selectedReturn = "4–6%";
let currentView = 1;
let aiConversation = [];

const riskProfiles = {
  cautious: { name: "穩健型", detail: "重視資金穩定與流動性，對波動較敏感。", preview: "穩健型 · 重視資金穩定與流動性" },
  balanced: { name: "平衡型", detail: "重視成長，同時留意資金波動。", preview: "平衡型 · 在成長與波動之間取得平衡" },
  growth: { name: "成長型", detail: "願意承受較大波動，以爭取長期成長機會。", preview: "成長型 · 願意為長期成長承受波動" }
};
const plans = {
  liquidity: { name: "流動守成", targets: { deposit: 50, fund: 25, insurance: 25 }, rate: 3.5, description: "優先考慮流動性與資產穩定" },
  balanced: { name: "平衡成長", targets: { deposit: 30, fund: 45, insurance: 25 }, rate: 4.3, description: "兼顧配置分散與中長期累積" },
  growth: { name: "長線增值", targets: { deposit: 15, fund: 65, insurance: 20 }, rate: 4.95, description: "較多配置於波動較高的基金" }
};
const products = {
  deposit: { name: "銀行定期", color: "#39b4a4", projection: true },
  fund: { name: "基金配置", color: "#8494be", projection: true },
  insurance: { name: "保險保障", color: "#ceb06b", projection: false }
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4173" : "";

function riskProfile() {
  const score = Object.values(riskQuestions).reduce((total, value) => total + value, 0);
  if (score <= 4) return riskProfiles.cautious;
  if (score >= 8) return riskProfiles.growth;
  return riskProfiles.balanced;
}

function updateRiskPreview() {
  const profile = riskProfile();
  $("#risk-preview-text").textContent = `${profile.name} · ${profile.detail.replace(/[。]$/, "")}`;
  updateConsoleTelemetry();
}

function showView(view) {
  currentView = view;
  $$(".flow-view").forEach((panel) => {
    const active = Number(panel.dataset.view) === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  $$("[data-step-indicator]").forEach((item) => {
    const step = Number(item.dataset.stepIndicator);
    item.classList.toggle("active", step === view);
    item.classList.toggle("complete", step < view);
  });
  const copy = {
    1: ["STEP 01 / 03", "先了解你的風險取向", "沒有標準答案。按直覺選擇最接近你的情況，我們會用作初步規劃參考。"],
    2: ["STEP 02 / 03", "設定目標與規劃偏好", "金額和年期填大概即可；接著選擇希望比較的方案方向。"],
    3: ["STEP 03 / 03", "你的規劃藍圖", "一份可以帶去進一步討論的初步整理。"]
  }[view];
  $("#step-caption").textContent = copy[0];
  $("#view-heading").textContent = copy[1];
  $("#view-description").textContent = copy[2];
  updateConsoleTelemetry();
  if (view === 3) $("#planner").scrollIntoView({ behavior: "smooth", block: "start" });
}

function playClickEffect(event) {
  const target = event.currentTarget;
  const bounds = target.getBoundingClientRect();
  const wave = document.createElement("span");
  wave.className = "click-wave";
  wave.style.left = `${event.clientX - bounds.left}px`;
  wave.style.top = `${event.clientY - bounds.top}px`;
  target.append(wave);
  target.classList.remove("click-locked");
  void target.offsetWidth;
  target.classList.add("click-locked");
  wave.addEventListener("animationend", () => wave.remove(), { once: true });
  window.setTimeout(() => target.classList.remove("click-locked"), 650);
}

function updateConsoleTelemetry() {
  const clock = $("#noise-clock");
  if (clock) clock.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const signal = $("#signal-value");
  if (signal) signal.textContent = riskProfile().name;
  const riskDetail = $("#signal-risk-detail");
  if (riskDetail) riskDetail.textContent = riskProfiles[riskProfile().name === "穩健型" ? "cautious" : riskProfile().name === "成長型" ? "growth" : "balanced"].preview.split(" · ")[1];
  const returnGoal = $("#signal-return");
  if (returnGoal) returnGoal.textContent = selectedReturn;
  const modules = $("#signal-modules");
  if (modules) modules.textContent = String(selectedProducts.size).padStart(2, "0");
  const horizon = $("#signal-horizon");
  if (horizon && $("#horizon")) horizon.textContent = `${$("#horizon").value} 年規劃期`;
  const flowLabel = $("#network-flow-label");
  const flowValue = $("#network-flow-value");
  if (flowLabel && flowValue) {
    flowLabel.textContent = currentView === 1 ? "目前步驟" : currentView === 2 ? "設定進度" : "方案已生成";
    flowValue.textContent = `${String(currentView).padStart(2, "0")} / 03`;
  }
  $$('[data-signal-plan]').forEach((node) => node.classList.toggle("signal-node-active", node.dataset.signalPlan === selectedPlan));
}
window.setInterval(updateConsoleTelemetry, 1000);
updateConsoleTelemetry();

$$('[data-question], [data-product], [data-plan], [data-return], [data-signal-plan], #to-step-two, #back-to-one, #generate-plan, #edit-plan, #restart-top, #restart-bottom, #save-summary, #ai-submit')
  .forEach((button) => button.addEventListener("pointerdown", playClickEffect));

function formatMoney(value, currency, maximumFractionDigits = 0) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString("en")}`;
  }
}

function normalizedAllocation() {
  const buckets = ["deposit", "fund", "insurance"].filter((key) => selectedProducts.has(key));
  const rawSum = buckets.reduce((sum, key) => sum + plans[selectedPlan].targets[key], 0);
  if (!rawSum) return [];
  let used = 0;
  return buckets.map((key, index) => {
    const pct = index === buckets.length - 1 ? 100 - used : Math.round((plans[selectedPlan].targets[key] / rawSum) * 100);
    used += pct;
    return { key, ...products[key], pct };
  });
}

function buildNextSteps(profile) {
  const items = [];
  items.push({ title: "資金用途與流動性", detail: "哪些資金需要在短期內使用？" });
  if (selectedProducts.has("insurance")) items.push({ title: "保障與受益人安排", detail: "家庭成員、保單受益人是否需要更新？" });
  if (selectedProducts.has("legacy")) items.push({ title: "跨境稅務與傳承檢視", detail: "居住地、資產所在地及適用規則需要確認。" });
  if (items.length < 3) items.push({ title: `${profile.name}的承受範圍`, detail: "用可接受的回撤幅度再次核對方案取向。" });
  if (items.length < 3) items.push({ title: "產品費用與條款", detail: "比較費用、期限、流動限制及保障範圍。" });
  $("#next-step-list").innerHTML = items.slice(0, 3).map((item, index) => `<div class="next-step"><span class="next-step-number">${String(index + 1).padStart(2, "0")}</span><span><b>${item.title}</b><small>${item.detail}</small></span><span class="step-arrow">↗</span></div>`).join("");
}

function renderAllocation(allocation) {
  const chart = $("#donut-chart");
  const colors = allocation.map((item) => item.color);
  let cursor = 0;
  const segments = allocation.map((item, index) => {
    const start = cursor;
    cursor += item.pct * 3.6;
    return `${colors[index]} ${start}deg ${cursor}deg`;
  });
  chart.style.background = allocation.length ? `conic-gradient(${segments.join(",")})` : "#edf1f3";
  $("#donut-count").textContent = String(allocation.length);
  $("#allocation-legend").innerHTML = allocation.length
    ? allocation.map((item) => `<div class="legend-row"><i class="legend-dot" style="background:${item.color}"></i><span>${item.name}</span><b>${item.pct}%</b></div>`).join("")
    : '<div class="legend-empty">選擇一項資產配置模組後，這裡會顯示比例。</div>';
  $("#legacy-note").innerHTML = selectedProducts.has("legacy")
    ? '<span>＋</span> 傳承安排另列為規劃檢視項目，不佔投資配置比例。'
    : '<span>＋</span> 可隨時加入傳承安排作為獨立檢視項目。';
}

function renderResult() {
  const profile = riskProfile();
  const plan = plans[selectedPlan];
  const allocation = normalizedAllocation();
  const amount = Math.max(0, Number($("#amount").value) || 0);
  const years = Number($("#horizon").value) || 10;
  const currency = $("#currency").value;
  const inPlanRiskMismatch = (profile.name === "穩健型" && selectedPlan === "growth") || (profile.name === "成長型" && selectedPlan === "liquidity");
  const comparablePercent = allocation.filter((item) => item.projection).reduce((total, item) => total + item.pct, 0);
  const projectedPrincipal = amount * comparablePercent / 100;
  const scenarioRate = plan.rate;
  const projectedValue = projectedPrincipal * Math.pow(1 + scenarioRate / 100, years);

  $("#result-risk").textContent = profile.name;
  $("#risk-explanation").textContent = profile.detail;
  $("#result-return").textContent = selectedReturn;
  $("#result-years").textContent = `${years} 年`;
  $("#result-amount").textContent = `${formatMoney(amount, currency)} 起`;
  $("#result-plan-name").textContent = plan.name;
  const fitBadge = $("#plan-fit-badge");
  fitBadge.textContent = inPlanRiskMismatch ? "可先與風險取向核對" : "與風險取向相符";
  fitBadge.classList.toggle("warning", inPlanRiskMismatch);
  renderAllocation(allocation);
  $("#projection-currency").textContent = currency;
  $("#projection-value").textContent = comparablePercent
    ? new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(projectedValue)
    : "—";
  $("#projection-years-label").textContent = `· ${years} 年`;
  $("#invested-display").textContent = comparablePercent ? formatMoney(projectedPrincipal, currency) : "不適用";
  $("#scenario-rate").textContent = comparablePercent ? `${scenarioRate}%` : "不適用";
  $("#copy-feedback").textContent = "";
  aiConversation = [];
  $("#ai-messages").innerHTML = "";
  $("#ai-error").hidden = true;
  $("#ai-status").textContent = "正在生成分析…";
  $("#ai-question").value = "";
  buildNextSteps(profile);
}

function selectedRiskAnswers() {
  return [1, 2, 3].map((question) => {
    const choice = $(`[data-question="${question}"][aria-pressed="true"] .choice-title`);
    return choice?.textContent?.trim() || "未選擇";
  });
}

function currentPlanContext() {
  const productNames = { deposit: "銀行定期", fund: "基金配置", insurance: "保險保障", legacy: "傳承規劃" };
  return {
    riskProfile: riskProfile().name,
    riskAnswers: selectedRiskAnswers(),
    planName: plans[selectedPlan].name,
    returnGoal: selectedReturn,
    horizon: Number($("#horizon").value) || 10,
    products: [...selectedProducts].map((key) => productNames[key]),
    allocation: normalizedAllocation().map(({ name, pct }) => ({ name, percent: pct }))
  };
}

function appendAIMessage(role, content) {
  const message = document.createElement("div");
  message.className = `ai-message ${role === "user" ? "user-message" : "assistant-message"}`;
  message.textContent = content;
  $("#ai-messages").append(message);
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return message;
}

async function requestAI(messages) {
  if (window.location.hostname.endsWith("github.io")) {
    throw new Error("GitHub Pages 版本只提供靜態互動示意；AI 對話請在本機執行 npm start。 ");
  }
  const response = await fetch(`${API_BASE}/api/plan-insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: currentPlanContext(), messages: messages.slice(-8) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "服務暫時無法回覆，請稍後再試。");
  if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("服務沒有返回有效文字，請稍後再試。");
  return data.answer.trim();
}

async function generateAIAnalysis() {
  const status = $("#ai-status");
  const error = $("#ai-error");
  error.hidden = true;
  const prompt = "請根據我的風險取向、目標和已選方案，自動生成一段簡潔的初步分析：解讀配置思路，說明主要風險或流動性注意點，並提出最多兩個值得向合資格顧問確認的問題。";
  aiConversation = [{ role: "user", content: prompt }];
  const pending = appendAIMessage("assistant", "正在根據你的選擇整理初步分析…");
  status.textContent = "正在生成分析…";
  try {
    const answer = await requestAI(aiConversation);
    pending.textContent = answer;
    aiConversation.push({ role: "assistant", content: answer });
    status.textContent = "分析已生成";
  } catch (requestError) {
    pending.remove();
    status.textContent = "分析暫不可用";
    error.textContent = requestError instanceof TypeError
      ? "目前沒有連到本機 API 服務。請在專案資料夾執行 npm start；服務啟動後可保留此頁重新詢問。"
      : requestError.message;
    error.hidden = false;
  }
}

async function submitAIQuestion(event) {
  event.preventDefault();
  const input = $("#ai-question");
  const question = input.value.trim();
  if (!question) return;

  const submit = $("#ai-submit");
  const status = $("#ai-status");
  const error = $("#ai-error");
  aiConversation.push({ role: "user", content: question });
  appendAIMessage("user", question);
  input.value = "";
  input.disabled = true;
  submit.disabled = true;
  status.textContent = "正在整理回覆…";
  error.hidden = true;
  const pending = appendAIMessage("assistant", "正在整理你的問題…");

  try {
    const answer = await requestAI(aiConversation);
    pending.textContent = answer;
    aiConversation.push({ role: "assistant", content: answer });
    status.textContent = "已回覆";
  } catch (requestError) {
    pending.remove();
    aiConversation.pop();
    error.textContent = requestError instanceof TypeError
      ? "目前頁面沒有連到本機 API 服務。請在專案資料夾執行 npm start，並從 http://127.0.0.1:4173 開啟此頁。"
      : requestError.message;
    error.hidden = false;
    status.textContent = "暫時無法使用";
    input.value = question;
  } finally {
    input.disabled = false;
    submit.disabled = false;
    input.focus();
  }
}

function resetAll() {
  riskQuestions[1] = 2; riskQuestions[2] = 2; riskQuestions[3] = 2;
  $$("[data-question]").forEach((button) => {
    const selected = Number(button.dataset.score) === 2;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  selectedProducts.clear();
  ["deposit", "fund", "insurance", "legacy"].forEach((key) => selectedProducts.add(key));
  $$("[data-product]").forEach((button) => { button.classList.add("selected"); button.setAttribute("aria-pressed", "true"); });
  selectedPlan = "balanced";
  $$("[data-plan]").forEach((button) => { const active = button.dataset.plan === selectedPlan; button.classList.toggle("selected", active); button.setAttribute("aria-pressed", String(active)); });
  selectedReturn = "4–6%";
  $$("[data-return]").forEach((button) => { const active = button.dataset.return === selectedReturn; button.classList.toggle("selected", active); button.setAttribute("aria-pressed", String(active)); });
  $("#amount").value = "500000"; $("#currency").value = "HKD"; $("#horizon").value = "10";
  $("#form-error").hidden = true;
  updateRiskPreview();
  showView(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$('[data-question]').forEach((button) => button.addEventListener("click", () => {
  const question = button.dataset.question;
  riskQuestions[question] = Number(button.dataset.score);
  $$(`[data-question="${question}"]`).forEach((option) => {
    const selected = option === button;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  updateRiskPreview();
}));

$$('[data-product]').forEach((button) => button.addEventListener("click", () => {
  const key = button.dataset.product;
  const selected = !selectedProducts.has(key);
  if (selected) selectedProducts.add(key); else selectedProducts.delete(key);
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  $("#form-error").hidden = true;
  updateConsoleTelemetry();
}));

$$('[data-plan]').forEach((button) => button.addEventListener("click", () => {
  selectedPlan = button.dataset.plan;
  $$('[data-plan]').forEach((option) => {
    const selected = option === button;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  updateConsoleTelemetry();
}));

$$('[data-signal-plan]').forEach((button) => button.addEventListener("click", () => {
  selectedPlan = button.dataset.signalPlan;
  $$('[data-plan]').forEach((option) => {
    const selected = option.dataset.plan === selectedPlan;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  updateConsoleTelemetry();
  showView(2);
  $("#planner").scrollIntoView({ behavior: "smooth", block: "start" });
}));

$("#horizon").addEventListener("change", updateConsoleTelemetry);

$$('[data-return]').forEach((button) => button.addEventListener("click", () => {
  selectedReturn = button.dataset.return;
  $$('[data-return]').forEach((option) => {
    const selected = option === button;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  updateConsoleTelemetry();
}));

$("#to-step-two").addEventListener("click", () => showView(2));
$("#back-to-one").addEventListener("click", () => showView(1));
$("#edit-plan").addEventListener("click", () => showView(2));
$("#generate-plan").addEventListener("click", () => {
  const count = ["deposit", "fund", "insurance"].filter((key) => selectedProducts.has(key)).length;
  if (!count) {
    $("#form-error").hidden = false;
    $("#form-error").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  $("#form-error").hidden = true;
  renderResult();
  showView(3);
  generateAIAnalysis();
});
$("#restart-top").addEventListener("click", resetAll);
$("#restart-bottom").addEventListener("click", resetAll);
$("#save-summary").addEventListener("click", async () => {
  const profile = riskProfile();
  const currency = $("#currency").value;
  const allocation = normalizedAllocation().map((item) => `${item.name} ${item.pct}%`).join("、") || "未選擇";
  const summary = `衡渡｜跨境財富規劃示意\n風險取向：${profile.name}\n方案：${plans[selectedPlan].name}\n目標回報：${selectedReturn}\n配置示意：${allocation}\n金額與年期：${formatMoney(Number($("#amount").value) || 0, currency)}，${$("#horizon").value} 年\n\n此概念示意不構成投資、保險、法律或稅務建議。`;
  try {
    await navigator.clipboard.writeText(summary);
    $("#copy-feedback").textContent = "方案摘要已複製，可貼上保存或分享。";
  } catch {
    $("#copy-feedback").textContent = summary.replaceAll("\n", " · ");
  }
});
$("#ai-form").addEventListener("submit", submitAIQuestion);

updateRiskPreview();
