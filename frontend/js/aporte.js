const aporte = (() => {
  const choice = document.querySelector("select[name=goal_key]");
  const portion = document.querySelector("input[name=portion]");
  const amount = choice.form.elements.amount;
  const goals = new Map();
  function update() {
    const active = !document.getElementById("goal-choice").hidden && Boolean(choice.value);
    document.getElementById("goal-portion").hidden = !active;
    portion.disabled = !active;
    portion.required = active;
    portion.max = amount.value || amount.max;
  }
  choice.addEventListener("change", update);
  amount.addEventListener("input", update);
  return {
    options(items) {
      const selected = choice.value;
      choice.replaceChildren(new Option("Sin aporte",""));
      goals.clear();
      for (const item of items) {
        goals.set(item.key,item.title);
        choice.add(new Option(item.title,item.key));
      }
      choice.value = selected;
    },
    title(key) { return goals.get(key) || "la meta"; },
    show(kind, key="", cents=0) {
      choice.value = key;
      portion.value = cents ? cents/100 : "";
      document.getElementById("goal-choice").hidden = kind !== "income" || !goals.size;
      document.getElementById("goal-help").hidden = kind !== "income" || Boolean(goals.size);
      update();
    },
    data(kind) {
      const key = kind === "income" ? choice.value : "";
      return {goal_key:key,portion:key ? Math.round(portion.valueAsNumber*100) : 0};
    }
  };
})();
