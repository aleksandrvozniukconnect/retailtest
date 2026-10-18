(function () {
  const params = new URLSearchParams(location.search);
  const kit = window.KITS.find(k => k.id === params.get("kit"));
  const body = document.getElementById("kit-body");

  if (!kit) {
    body.innerHTML = `<p>Такого набору немає. Перевірте QR-код або <a href="index.html">оберіть зі списку</a>.</p>`;
    return;
  }

  document.title = kit.name;
  document.getElementById("kit-name").textContent = kit.name;
  document.getElementById("kit-meta").textContent = `${kit.steps.length} кроків · ${kit.time}`;

  // Прогрес зберігаємо окремо для кожного набору. Якщо сховище недоступне, сторінка все одно працює.
  const storageKey = `kit-progress:${kit.id}`;
  let done = [];
  try {
    done = JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch (e) {
    done = [];
  }
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(done));
    } catch (e) { /* ігноруємо */ }
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const partsHtml = `
    <section class="block">
      <h2>Деталі</h2>
      <table class="parts">
        <thead><tr><th>Код</th><th>Назва</th><th>К-сть</th></tr></thead>
        <tbody>
          ${kit.parts.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${p.qty}</td></tr>`).join("")}
        </tbody>
      </table>
      <h3>Інструменти</h3>
      <ul>${kit.tools.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    </section>`;

  const stepsHtml = kit.steps.map((s, i) => `
    <section class="step ${done.includes(i) ? "is-done" : ""}" data-i="${i}">
      <div class="step-head">
        <span class="num">${i + 1}</span>
        <h2>${esc(s.title)}</h2>
      </div>
      <div class="drawing" aria-label="${esc(s.drawing)}">${esc(s.drawing)}</div>
      <p>${esc(s.text)}</p>
      <label class="check">
        <input type="checkbox" ${done.includes(i) ? "checked" : ""}>
        Крок виконано
      </label>
    </section>`).join("");

  body.innerHTML = `
    <div class="progress"><div class="bar" id="bar"></div></div>
    <p class="muted" id="count"></p>
    ${partsHtml}
    ${stepsHtml}
    <p class="done-msg" id="done-msg" hidden>Збирання завершено. Перевірте стійкість меблів.</p>`;

  const bar = document.getElementById("bar");
  const count = document.getElementById("count");
  const doneMsg = document.getElementById("done-msg");

  function refresh() {
    const pct = Math.round((done.length / kit.steps.length) * 100);
    bar.style.width = pct + "%";
    count.textContent = `Виконано ${done.length} з ${kit.steps.length}`;
    doneMsg.hidden = done.length !== kit.steps.length;
  }

  body.addEventListener("change", e => {
    if (e.target.type !== "checkbox") return;
    const step = e.target.closest(".step");
    const i = Number(step.dataset.i);
    if (e.target.checked) {
      if (!done.includes(i)) done.push(i);
    } else {
      done = done.filter(x => x !== i);
    }
    step.classList.toggle("is-done", e.target.checked);
    save();
    refresh();
  });

  refresh();
})();
