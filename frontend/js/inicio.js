const byId = id => document.getElementById(id);
const statusLine = byId("status");
const form = byId("entry");
const money = cents => "$" + (cents / 100).toLocaleString("es-CO", {maximumFractionDigits:2});
const localDate = day => new Date(day + "T12:00:00");
let kind, today, retryKey;

async function api(path, data) {
  const options = data ? {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)} : {};
  const response = await fetch("/api/" + path, options);
  if (response.status === 401) location.replace("cuenta.html?modo=entrar");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Vuelve a intentarlo.");
  return result;
}
function drawTrend(summary) {
  const days = Number(byId("trend-period").querySelector('[aria-pressed="true"]').dataset.days);
  const dates = [];
  let change = 0;
  const end = new Date(summary.today + "T00:00:00Z");
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    dates.push(key);
    change += summary.dailyChanges[key] || 0;
  }
  const values = [summary.balance - change];
  const labels = ["Saldo de partida"];
  for (const day of dates) {
    values.push(values.at(-1) + (summary.dailyChanges[day] || 0));
    labels.push(localDate(day).toLocaleDateString("es-CO", {day:"numeric", month:"short"}));
  }
  byId("trend-start").textContent = days === 1 ? "Inicio del día" : labels[1];
  const high = Math.max(...values);
  const low = Math.min(...values);
  const points = values.map((value, i) => {
    const x = 2 + 596 * i / (values.length - 1);
    const y = high === low ? 75 : 144 - 138 * (value - low) / (high - low);
    return x + " " + y;
  });
  const line = "M " + points.join(" L ");
  byId("trend-line").setAttribute("d", line);
  byId("trend-area").setAttribute("d", line + " L 598 144 L 2 144 Z");
  byId("trend-high").textContent = money(high);
  byId("trend-low").textContent = high === low ? "" : money(low);
  byId("trend-end").textContent = labels.at(-1);
  byId("trend-change").textContent = change === 0 ? "Sin cambio neto en este período." :
    "Tu saldo " + (change > 0 ? "subió " : "bajó ") + money(Math.abs(change)) + " en este período.";
  byId("trend-values").replaceChildren(...values.map((value, i) => {
    const row = document.createElement("div");
    const day = document.createElement("dt");
    day.textContent = labels[i];
    const balance = document.createElement("dd");
    balance.textContent = money(value);
    row.append(day, balance);
    return row;
  }));
}

async function refresh() {
  const [summary, goals] = await Promise.all([api("summary"),api("goals")]);
  aporte.options(goals.items);
  today = summary.today;
  byId("period").textContent = localDate(today).toLocaleDateString("es-CO",{month:"long",year:"numeric"});
  byId("opening").hidden = summary.initialized;
  byId("dashboard").hidden = !summary.initialized;
  for (const metric of ["balance","income","expense"]) byId(metric).textContent = money(summary[metric]);
  byId("trend-period").onclick = event => {
    const selected = event.target.closest("button[data-days]");
    if (!selected) return;
    for (const button of byId("trend-period").children) {
      button.setAttribute("aria-pressed", String(button === selected));
    }
    drawTrend(summary);
  };
  drawTrend(summary);
  byId("category-empty").hidden = summary.categories.length > 0;
  byId("category-summary").replaceChildren(...summary.categories.map(group => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    const params = new URLSearchParams({kind:"expense", month:today.slice(0,7), category:group.category});
    link.href = "movimientos.html?" + params;
    link.textContent = group.category || "Sin categoría";
    const total = document.createElement("strong");
    total.textContent = money(group.amount);
    row.append(link,total);
    return row;
  }));
  byId("empty").hidden = summary.recent.length > 0;
  byId("recent").replaceChildren(...summary.recent.map(item => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const detail = document.createElement("small");
    const amount = document.createElement("strong");
    const type = item.kind === "income" ? "Ingreso" : "Gasto";
    label.textContent = item.note || type;
    detail.textContent = type + " · " + localDate(item.day).toLocaleDateString("es-CO");
    label.append(detail);
    amount.textContent = (item.kind === "income" ? "+" : "−") + money(item.amount);
    row.append(label,amount);
    return row;
  }));
}
document.querySelectorAll("[data-kind]").forEach(button => button.onclick = () => {
  if (form.querySelector("button").disabled) return;
  kind = button.dataset.kind;
  form.reset();
  aporte.show(kind);
  byId("category-field").hidden = kind !== "expense";
  retryKey = crypto.randomUUID();
  form.elements.day.max = form.elements.day.value = today;
  byId("editor-title").textContent = button.textContent;
  byId("editor").hidden = false;
  statusLine.textContent = "";
  form.elements.amount.focus();
});
form.oninput = () => { retryKey = crypto.randomUUID(); };
byId("cancel").onclick = () => { byId("editor").hidden = true; };
async function save(event) {
  event.preventDefault();
  const current = event.currentTarget;
  const button = current.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  const amount = Math.round(current.elements.amount.valueAsNumber * 100);
  try {
    if (current === form) {
      await api("movement",{amount,kind,...aporte.data(kind),category:form.elements.category.value,day:form.elements.day.value,note:form.elements.note.value,key:retryKey});
      byId("editor").hidden = true;
    } else await api("opening",{amount});
    await refresh();
    statusLine.textContent = current === form ? "Movimiento guardado." : "Saldo inicial guardado.";
  } catch(error) { statusLine.textContent = error.message; }
  finally { button.disabled = false; }
}
form.onsubmit = byId("setup").onsubmit = save;
byId("logout").onclick = async () => {
  try { await api("logout",{}); location.replace("index.html"); }
  catch(error) { statusLine.textContent = error.message; }
};
window.addEventListener("pageshow",() => refresh().catch(error => {statusLine.textContent = error.message;}));
