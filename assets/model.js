(function () {
  const params = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fail(msg) {
    $("m-name").textContent = "Виріб не знайдено";
    $("m-error").hidden = false;
    $("m-error").innerHTML = msg + ' <a href="index.html">Повернутися до списку</a>.';
  }

  function loadSource() {
    if (params.get("local")) {
      try {
        return Promise.resolve(JSON.parse(sessionStorage.getItem("localModel")));
      } catch (e) {
        return Promise.reject(new Error("Не вдалося прочитати файл моделі."));
      }
    }
    const id = params.get("id");
    if (!id || !/^[\w-]+$/.test(id)) return Promise.reject(new Error("Невірне посилання. Перевірте QR-код."));
    return fetch(`data/models/${id}.json`).then(r => {
      if (!r.ok) throw new Error("Такого виробу немає. Перевірте QR-код.");
      return r.json();
    });
  }

  // Перевіряємо модель і дозаповнюємо dims, якщо їх не передали
  function normalize(m) {
    if (!m || !Array.isArray(m.blocks) || !m.blocks.length) throw new Error("У файлі моделі немає блоків.");
    const seen = new Set();
    m.blocks.forEach(b => {
      b.parts = b.parts || [];
      b.hardware = b.hardware || [];
      b.steps = b.steps || [];
      b.parts.forEach(p => {
        if (!Array.isArray(p.size) || !Array.isArray(p.at)) throw new Error("Деталь " + p.pos + ": немає size або at.");
        if (seen.has(p.pos)) throw new Error("Позиція " + p.pos + " повторюється.");
        seen.add(p.pos);
        if (!p.dims) p.dims = p.size.slice().sort((a, b) => b - a);
      });
      if (!b.steps.length) {
        b.steps = [{ text: "Складіть блок за кресленням і списком деталей.", parts: b.parts.map(p => p.pos), hardware: b.hardware }];
      }
    });
    return m;
  }

  function overall(m) {
    const all = m.blocks.flatMap(b => b.parts);
    const lo = [0, 1, 2].map(i => Math.min(...all.map(p => p.at[i])));
    const hi = [0, 1, 2].map(i => Math.max(...all.map(p => p.at[i] + p.size[i])));
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map(Math.round);
  }

  function edgeText(p) {
    const map = { l1: "Д1", l2: "Д2", w1: "Ш1", w2: "Ш2" };
    return (p.edge && p.edge.length) ? p.edge.map(e => map[e] || e).join(", ") : "—";
  }

  function sumHardware(blocks) {
    const t = {};
    blocks.forEach(b => b.hardware.forEach(h => { t[h.name] = (t[h.name] || 0) + h.qty; }));
    return Object.entries(t).map(([name, qty]) => ({ name, qty }));
  }

  function hwTable(list) {
    if (!list.length) return "";
    return `<table class="parts"><thead><tr><th>Фурнітура</th><th>К-сть</th></tr></thead><tbody>
      ${list.map(h => `<tr><td>${esc(h.name)}</td><td>${h.qty}</td></tr>`).join("")}</tbody></table>`;
  }

  function lastStorage(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* сховище недоступне — працюємо без нього */ }
    return null;
  }

  function init(m) {
    const partByPos = {};
    m.blocks.forEach(b => b.parts.forEach(p => { partByPos[p.pos] = p; }));
    const ov = overall(m);
    const count = Object.keys(partByPos).length;

    document.title = m.name;
    $("m-name").textContent = m.name;
    $("m-meta").textContent = `${ov[0]}×${ov[1]}×${ov[2]} мм · ${m.blocks.length} бл. · ${count} деталей`;
    $("tabs").hidden = false;
    $("btn-pdf").hidden = false;

    // ---------- Вкладки ----------
    const viewers = {};
    function showTab(name) {
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.id === "tab-" + name));
      document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
      if (viewers[name]) viewers[name].resize();
    }
    $("tabs").addEventListener("click", e => {
      if (e.target.dataset.tab) showTab(e.target.dataset.tab);
    });

    // ---------- Збирання по кроках ----------
    const steps = [];
    m.blocks.forEach(b => b.steps.forEach((s, i) => steps.push({ block: b, i, n: b.steps.length, step: s })));

    const asm = new Viewer3D($("viewer-asm"));
    asm.load(m);
    viewers.assembly = asm;

    const key = "asm:" + (m.id || m.name);
    let done = lastStorage(key) || [];
    let cur = Math.min(done.length, steps.length - 1);

    function renderStep() {
      const s = steps[cur];
      const shown = new Set(), active = new Set();
      steps.forEach((x, idx) => {
        if (idx <= cur) x.step.parts.forEach(p => shown.add(p));
      });
      s.step.parts.forEach(p => active.add(p));
      asm.setStates(pos => active.has(pos) ? "active" : shown.has(pos) ? "normal" : "ghost");

      $("asm-where").textContent = `${s.block.name} · крок ${s.i + 1} з ${s.n} (усього ${cur + 1}/${steps.length})`;
      $("asm-title").textContent = `Крок ${cur + 1}`;
      $("asm-text").textContent = s.step.text;
      $("asm-parts").innerHTML = s.step.parts.map(pos => {
        const p = partByPos[pos];
        return p ? `<span class="chip"><b>${pos}</b> ${esc(p.name)} · ${p.dims.join("×")}</span>` : "";
      }).join("");
      $("asm-hw").innerHTML = (s.step.hardware || []).map(h => `<li>${esc(h.name)} — <b>${h.qty} шт</b></li>`).join("");
      $("asm-bar").style.width = Math.round((done.length / steps.length) * 100) + "%";
      $("asm-prev").disabled = cur === 0;
      $("asm-next").textContent = cur === steps.length - 1 ? "Збирання завершено ✓" : "Готово, далі →";
      $("asm-dots").innerHTML = steps.map((_, i) =>
        `<button type="button" class="dot ${i === cur ? "is-cur" : ""} ${done.includes(i) ? "is-done" : ""}" data-i="${i}" aria-label="Крок ${i + 1}">${i + 1}</button>`).join("");
    }

    $("asm-next").addEventListener("click", () => {
      if (!done.includes(cur)) done.push(cur);
      lastStorage(key, done);
      if (cur < steps.length - 1) cur++;
      renderStep();
    });
    $("asm-prev").addEventListener("click", () => { if (cur > 0) { cur--; renderStep(); } });
    $("asm-dots").addEventListener("click", e => {
      if (e.target.dataset.i !== undefined) { cur = Number(e.target.dataset.i); renderStep(); }
    });
    renderStep();

    // ---------- Вільний 3D ----------
    const free = new Viewer3D($("viewer-3d"));
    free.load(m);
    free.setStates(() => "normal");
    viewers.view3d = free;
    $("explode").addEventListener("input", e => free.explode(e.target.value / 100));
    $("btn-reset").addEventListener("click", () => free.resetCamera());
    free.onPick(pos => {
      const box = $("part-info");
      if (pos == null) {
        free.setStates(() => "normal");
        box.innerHTML = '<p class="muted">Торкніться деталі, щоб побачити її розміри.</p>';
        return;
      }
      free.select(pos);
      const p = partByPos[pos];
      box.innerHTML = `<h3>${pos}. ${esc(p.name)}</h3>
        <p>${esc(p.material)} · ${p.dims[0]}×${p.dims[1]}×${p.dims[2]} мм</p>
        <p>Кромка: ${edgeText(p)}${p.grooves ? " · " + esc(p.grooves) : ""}</p>`;
    });

    // ---------- Список деталей ----------
    $("tab-spec").innerHTML = m.blocks.map(b => `
      <div class="block">
        <h2>${esc(b.name)}</h2>
        <div class="table-wrap"><table class="parts">
          <thead><tr><th>Поз.</th><th>Назва</th><th>Матеріал</th><th>Довж.</th><th>Шир.</th><th>Тов.</th><th>Кромка</th><th>Примітка</th></tr></thead>
          <tbody>${b.parts.map(p => `<tr><td>${p.pos}</td><td>${esc(p.name)}</td><td>${esc(p.material)}</td>
            <td>${p.dims[0]}</td><td>${p.dims[1]}</td><td>${p.dims[2]}</td><td>${edgeText(p)}</td><td>${esc(p.grooves || "")}</td></tr>`).join("")}</tbody>
        </table></div>
        ${hwTable(b.hardware)}
      </div>`).join("") +
      `<div class="block"><h2>Уся фурнітура</h2>${hwTable(sumHardware(m.blocks))}</div>`;

    // ---------- Креслення ----------
    $("tab-draw").innerHTML = `
      <label class="check"><input type="checkbox" id="detail-toggle"> Показати детальні креслення деталей</label>
      ${m.blocks.map(b => `
        <div class="block">
          <h2>${esc(b.name)}</h2>
          <p class="muted">Вигляд спереду. Цифри ліворуч — висота від низу блоку до нижньої площини полиць, мм.</p>
          ${Drawings.frontView(b, m)}
          ${hwTable(b.hardware)}
        </div>`).join("")}
      <div id="detail-sheets" hidden>
        ${m.blocks.flatMap(b => b.parts).map(p => `
          <div class="block part-sheet">
            <h3>${p.pos}. ${esc(p.name)}</h3>
            <p class="muted">${esc(p.material)} · ${p.dims[0]}×${p.dims[1]}×${p.dims[2]} мм · кромка: ${edgeText(p)}</p>
            ${Drawings.partDrawing(p)}
            <p class="muted legend">Оранжева лінія — кромка. Зелені кола — отвори.${p.grooves ? " " + esc(p.grooves) + "." : ""}</p>
          </div>`).join("")}
      </div>`;
    $("detail-toggle").addEventListener("change", e => { $("detail-sheets").hidden = !e.target.checked; });

    // ---------- PDF (друк) ----------
    $("btn-pdf").addEventListener("click", () => {
      document.body.classList.add("print-all");
      $("detail-sheets").hidden = false;
      window.print();
      document.body.classList.remove("print-all");
      $("detail-sheets").hidden = !$("detail-toggle").checked;
    });

    window.__model = { steps: steps.length, parts: count };
  }

  loadSource()
    .then(normalize)
    .then(init)
    .catch(err => fail(esc(err.message)));
})();
