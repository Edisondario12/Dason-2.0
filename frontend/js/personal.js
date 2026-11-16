const get = id => document.getElementById(id);
const goal = get("goal");
const edit = get("edit");
const filters = get("filters");
let items = [];
let goalKey = crypto.randomUUID();
let editingKey;
let editingGoal;

async function api(path, data) {
  const options = data ? {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)} : {};
  const response = await fetch("/api/" + path, options);
  if (response.status === 401) location.replace("cuenta.html?modo=entrar");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo guardar.");
  return result;
}
function attempt(task) {
  return task().catch(error => { get("status").textContent = error.message; });
}
function action(label, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline";
  button.textContent = label;
  button.onclick = run;
  return button;
}
function editItem(item) {
  editingKey = item.key;
  for (const name of ["kind","note","day","category"]) edit.elements[name].value = item[name];
  edit.elements.amount.value = item.amount / 100;
  get("category-field").hidden = item.kind !== "expense";
  aporte.show(item.kind,item.goal_key,item.portion);
  edit.hidden = false;
  edit.elements.amount.focus();
}
function goalCard(row, item) {
  function add(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    row.append(element);
    return element;
  }
  const money = cents => "$" + (cents / 100).toLocaleString("es-CO");
  add("h3", item.title);
  if (item.notes) add("p", item.notes);
  if (item.deadline) add("small", "Fecha objetivo · " + new Date(item.deadline+"T12:00:00").toLocaleDateString("es-CO",{dateStyle:"long"}));
  const total = item.saved + item.contributions;
  if (item.contributions) add("small", "Aportes desde ingresos: " + money(item.contributions));
  if (item.target) {
    add("p", money(total) + " de " + money(item.target));
    const progress = add("progress", "");
    progress.max = item.target;
    progress.value = Math.min(total,item.target);
    progress.setAttribute("aria-label","Progreso de " + item.title);
    add("small", total >= item.target ? "Monto objetivo alcanzado" : "Faltan " + money(item.target-total));
  } else if (total) add("p", "Ya apartado: " + money(total));
  row.append(action("Editar meta", () => {
    editingGoal = item.key;
    for (const name of ["title","notes","deadline"]) goal.elements[name].value = item[name];
    for (const name of ["target","saved"]) goal.elements[name].value = item[name] ? item[name]/100 : "";
    get("goal-heading").textContent = "Editar meta";
    get("goal-save").textContent = "Guardar cambios";
    get("goal-cancel").hidden = false;
    goal.elements.title.focus();
  }));
}
function resetGoal() {
  editingGoal = null;
  goalKey = crypto.randomUUID();
  goal.reset();
  get("goal-heading").textContent = "¿Qué quieres lograr?";
  get("goal-save").textContent = "Crear meta";
  get("goal-cancel").hidden = true;
}
function render() {
  const list = get("list");
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    if (goal) goalCard(row,item);
    else {
      const {query, month, kind, category} = filters.elements;
      if (category.value !== "all" && (item.kind !== "expense" || item.category !== category.value)) continue;
      if (!item.note.toLowerCase().includes(query.value.trim().toLowerCase()) ||
          !item.day.startsWith(month.value) || (kind.value && kind.value !== item.kind)) continue;
      const text = document.createElement("span");
      const type = item.kind === "income" ? "Ingreso" : "Gasto";
      text.textContent = (item.note || type) + " · " + item.day;
      const detail = document.createElement("small");
      detail.textContent = (item.kind === "expense" ? type + " · " + (item.category || "Sin categoría") : type) + " · $" + (item.amount / 100).toLocaleString("es-CO");
      if (item.goal_key) detail.textContent += " · Para " + aporte.title(item.goal_key) + ": $" + (item.portion/100).toLocaleString("es-CO");
      text.append(detail);
      const buttons = document.createElement("div");
      buttons.append(action("Editar", () => editItem(item)), action("Eliminar", () => {
        if (confirm("¿Eliminar este movimiento y actualizar tu saldo?")) attempt(async () => {
          await api("remove",{key:item.key});
          if (editingKey === item.key) edit.hidden = true;
          await load();
          get("status").textContent = "Movimiento eliminado.";
        });
      }));
      row.append(text,buttons);
    }
    list.append(row);
  }
  get("empty").hidden = list.children.length > 0;
}
async function load() {
  if (goal) items = (await api("goals")).items;
  else {
    const [history, goals] = await Promise.all([api("history"),api("goals")]);
    items = history.items;
    aporte.options(goals.items);
  }
  render();
}
if (goal) {
  get("goal-cancel").onclick = resetGoal;
  goal.oninput = () => {goalKey = crypto.randomUUID();};
  goal.onsubmit = event => {
    event.preventDefault();
    const button = goal.querySelector("button");
    button.disabled = true;
    attempt(async () => {
      const {title,notes,target,saved,deadline} = goal.elements;
      await api(editingGoal ? "goal/edit" : "goal", {title:title.value,notes:notes.value,
        target:Math.round(Number(target.value)*100),saved:Math.round(Number(saved.value)*100),
        deadline:deadline.value,key:editingGoal || goalKey});
      resetGoal();
      await load();
      get("status").textContent = "Meta guardada.";
    }).finally(() => { button.disabled = false; });
  };
} else {
  const params = new URLSearchParams(location.search);
  for (const name of ["kind","month","category"]) {
    if (params.has(name)) filters.elements[name].value = params.get(name);
  }
  edit.elements.kind.onchange = () => {
    aporte.show(edit.elements.kind.value);
    get("category-field").hidden = edit.elements.kind.value !== "expense";
  };
  filters.onsubmit = event => event.preventDefault();
  filters.oninput = render;
  get("cancel").onclick = () => {edit.hidden = true;};
  edit.onsubmit = event => {
    event.preventDefault();
    const {amount,kind,day,note} = edit.elements;
    attempt(async () => {
      await api("edit",{key:editingKey,...aporte.data(kind.value),category:edit.elements.category.value,kind:kind.value,day:day.value,note:note.value,amount:Math.round(amount.valueAsNumber*100)});
      edit.hidden = true;
      await load();
      get("status").textContent = "Movimiento actualizado.";
    });
  };
}
get("logout").onclick = () => attempt(async () => {await api("logout",{}); location.replace("index.html");});
window.addEventListener("pageshow", () => attempt(load));
