(function () {
  const params = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function fail(msg) {
    $("m-name").textContent = "Виріб не знайдено";
    $("m-error").hidden = false;
    $("m-error").innerHTML = msg + ' <a href="index.html">Повернутися до списку</a>.';
  }

  function loadSource() {
    if (params.get("local")) {
      try {
        return Promise.resolve(JSON.parse(sessionStorage.getItem("localModel")));
      } catch {
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
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map(Math.round) };
  }

  const EDGE_CODE = { l1: "Д1", l2: "Д2", w1: "Ш1", w2: "Ш2" };
  function edgeText(p) {
    return (p.edge && p.edge.length) ? p.edge.map(e => EDGE_CODE[e] || e).join(", ") : "—";
  }

  // ---------- Орієнтація деталі у виробі ----------
  const DIR = [["ліворуч", "праворуч"], ["знизу", "зверху"], ["ззаду", "спереду"]];
  const FACE = [["ліворуч", "праворуч"], ["вниз", "вгору"], ["назад", "вперед"]];

  function sideDirections(p) {
    const ax = partAxes(p);
    const res = {};
    ["l1", "l2", "w1", "w2"].forEach(s => {
      const axis = s[0] === "l" ? ax.wa : ax.la;
      res[s] = DIR[axis][s[1] === "1" ? 1 : 0];
    });
    return res;
  }

  function orientation(p, ov) {
    const ax = partAxes(p);
    const c = [0, 1, 2].map(i => p.at[i] + p.size[i] / 2);
    const mid = [0, 1, 2].map(i => (ov.lo[i] + ov.hi[i]) / 2);
    const outer = FACE[ax.ta][c[ax.ta] >= mid[ax.ta] ? 1 : 0];
    const lenDir = ["по ширині виробу", "вертикально", "вглиб виробу"][ax.la];
    let pose;
    if (ax.ta === 1) pose = "Лежить горизонтально";
    else pose = `Стоїть вертикально, зовнішня пласть дивиться ${outer}`;
    return { pose, lenDir, outer };
  }

  function neighbours(p, all) {
    const gap = 1.5;
    return all.filter(q => q !== p && [0, 1, 2].every(i =>
      q.at[i] <= p.at[i] + p.size[i] + gap && p.at[i] <= q.at[i] + q.size[i] + gap));
  }

  function materialSummary(m) {
    const t = {};
    m.blocks.forEach(b => b.parts.forEach(p => {
      const r = t[p.material] || (t[p.material] = { n: 0, area: 0, edge: 0 });
      r.n++;
      r.area += (p.dims[0] * p.dims[1]) / 1e6;
      (p.edge || []).forEach(s => { r.edge += (s[0] === "l" ? p.dims[0] : p.dims[1]) / 1000; });
    }));
    return Object.entries(t).map(([name, r]) => ({ name, ...r }));
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

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* сховище недоступне — працюємо без нього */ }
    return null;
  }

  function init(m) {
    const partByPos = {}, blockOf = {};
    m.blocks.forEach(b => b.parts.forEach(p => { partByPos[p.pos] = p; blockOf[p.pos] = b; }));
    const allParts = m.blocks.flatMap(b => b.parts);
    const ov = overall(m);
    const count = allParts.length;

    document.title = m.name;
    $("m-name").textContent = m.name;
    $("m-meta").textContent = `${ov.size[0]}×${ov.size[1]}×${ov.size[2]} мм · ${m.blocks.length} бл. · ${count} деталей`;
    $("tabs").hidden = false;
    $("btn-pdf").hidden = false;

    // ---------- Вкладки ----------
    const viewers = {};
    function showTab(name) {
      document.querySelectorAll(".tab").forEach(t => t.classList.toggle("is-active", t.id === "tab-" + name));
      document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
      if (viewers[name]) viewers[name].resize();
      window.scrollTo(0, 0);
    }
    $("tabs").addEventListener("click", e => {
      if (e.target.dataset.tab) showTab(e.target.dataset.tab);
    });

    // ---------- Збирання по кроках ----------
    const steps = [];
    m.blocks.forEach(b => b.steps.forEach((s, i) => steps.push({ block: b, i, n: b.steps.length, step: s })));
    const stepOf = {};
    steps.forEach((s, idx) => s.step.parts.forEach(p => { if (stepOf[p] === undefined) stepOf[p] = idx; }));

    const asm = new Viewer3D($("viewer-asm"));
    asm.load(m);
    viewers.assembly = asm;

    const key = "asm:" + (m.id || m.name);
    let done = store(key) || [];
    let cur = Math.min(done.length, steps.length - 1);
    let playing = false;
    const speed = () => Number($("asm-speed").value) || 1;

    function stepStates(idx, hideFuture) {
      const shown = new Set(), active = new Set(steps[idx].step.parts);
      steps.forEach((x, i) => { if (i <= idx) x.step.parts.forEach(p => shown.add(p)); });
      asm.setStates(pos => active.has(pos) ? "active" : shown.has(pos) ? "normal" : hideFuture ? "hidden" : "ghost");
    }

    function renderStep(animate) {
      const s = steps[cur];
      stepStates(cur, playing);
      if (animate) asm.animateIn(s.step.parts, 900 / speed());

      $("asm-where").textContent = `${s.block.name} · крок ${s.i + 1} з ${s.n} (усього ${cur + 1}/${steps.length})`;
      $("asm-title").textContent = `Крок ${cur + 1}`;
      $("asm-text").textContent = s.step.text;
      $("asm-parts").innerHTML = s.step.parts.map(pos => {
        const p = partByPos[pos];
        return p ? `<button type="button" class="chip" data-part="${pos}"><b>${pos}</b> ${esc(p.name)} · ${p.dims.join("×")}</button>` : "";
      }).join("");
      $("asm-hw").innerHTML = (s.step.hardware || []).map(h => `<li>${esc(h.name)} — <b>${h.qty} шт</b></li>`).join("");
      $("asm-bar").style.width = Math.round((done.length / steps.length) * 100) + "%";
      $("asm-prev").disabled = cur === 0;
      $("asm-next").textContent = cur === steps.length - 1 ? "Збирання завершено ✓" : "Готово, далі →";
      $("asm-dots").innerHTML = steps.map((_, i) =>
        `<button type="button" class="dot ${i === cur ? "is-cur" : ""} ${done.includes(i) ? "is-done" : ""}" data-i="${i}" aria-label="Крок ${i + 1}">${i + 1}</button>`).join("");
    }

    async function play() {
      if (playing) { playing = false; asm.stopAnimation(); return; }
      playing = true;
      $("asm-play").textContent = "■ Зупинити";
      asm.setStates(() => "hidden");
      for (cur = 0; cur < steps.length && playing; cur++) {
        renderStep(false);
        await asm.animateIn(steps[cur].step.parts, 1100 / speed());
        if (playing) await wait(500 / speed());
      }
      cur = Math.min(cur, steps.length - 1);
      playing = false;
      $("asm-play").textContent = "▶ Анімація збірки";
      renderStep(false);
    }

    $("asm-play").addEventListener("click", play);
    $("asm-next").addEventListener("click", () => {
      if (playing) return;
      if (!done.includes(cur)) done.push(cur);
      store(key, done);
      const moved = cur < steps.length - 1;
      if (moved) cur++;
      renderStep(moved);
    });
    $("asm-prev").addEventListener("click", () => { if (!playing && cur > 0) { cur--; renderStep(false); } });
    $("asm-dots").addEventListener("click", e => {
      if (!playing && e.target.dataset.i !== undefined) { cur = Number(e.target.dataset.i); renderStep(false); }
    });
    $("asm-parts").addEventListener("click", e => {
      const b = e.target.closest("[data-part]");
      if (b) openPart(Number(b.dataset.part));
    });
    renderStep(false);

    // ---------- Вільний 3D: деталі й блоки ----------
    const free = new Viewer3D($("viewer-3d"));
    free.load(m);
    free.setStates(() => "normal");
    viewers.view3d = free;

    let mode = "parts";
    const hidden = new Set();
    const toggles = { dims: false, transparent: false, holes: false, edges: false };
    let picked = null;

    function freeStates(activeSet) {
      free.setStates(pos => hidden.has(pos) ? "hidden" : activeSet && activeSet.has(pos) ? "active" : "normal");
    }

    function blockCard(b) {
      const hw = b.hardware.reduce((s, h) => s + h.qty, 0);
      const ps = b.parts;
      const lo = [0, 1, 2].map(i => Math.min(...ps.map(p => p.at[i])));
      const hi = [0, 1, 2].map(i => Math.max(...ps.map(p => p.at[i] + p.size[i])));
      const gab = hi.map((v, i) => Math.round(v - lo[i])).join(" × ");
      return `<h3>${esc(b.name)}</h3>
        <p>Габарит: ${gab} мм · деталей: ${ps.length} · фурнітури: ${hw} шт</p>
        <div class="nav-row wrap">
          <button type="button" class="btn btn-ghost" data-act="hide">Сховати блок</button>
          <button type="button" class="btn btn-ghost" data-act="only">Лише цей блок</button>
          <button type="button" class="btn btn-ghost" data-act="all">Показати все</button>
          <button type="button" class="btn" data-act="steps">Кроки блоку →</button>
        </div>`;
    }

    function partInfo(p) {
      return `<h3>${p.pos}. ${esc(p.name)}</h3>
        <p>${esc(p.material)} · ${p.dims[0]}×${p.dims[1]}×${p.dims[2]} мм · блок «${esc(blockOf[p.pos].name)}»</p>
        <p>Кромка: ${edgeText(p)}${p.grooves ? " · " + esc(p.grooves) : ""}</p>
        <div class="nav-row wrap">
          <button type="button" class="btn" data-act="card">Картка деталі й орієнтація →</button>
          <button type="button" class="btn btn-ghost" data-act="hidepart">Сховати деталь</button>
          ${hidden.size ? '<button type="button" class="btn btn-ghost" data-act="all">Показати все</button>' : ""}
        </div>`;
    }

    function resetPick() {
      picked = null;
      freeStates(null);
      free.showBands(toggles.edges);
      $("pick-info").innerHTML = '<p class="muted">Торкніться ' + (mode === "blocks" ? "блока" : "деталі") + ", щоб побачити інформацію.</p>" +
        (hidden.size ? '<div class="nav-row"><button type="button" class="btn btn-ghost" data-act="all">Показати все</button></div>' : "");
    }

    free.onPick(pos => {
      if (pos == null) return resetPick();
      picked = pos;
      if (mode === "blocks") {
        const b = blockOf[pos];
        freeStates(new Set(b.parts.map(p => p.pos)));
        $("pick-info").innerHTML = blockCard(b);
      } else {
        freeStates(new Set([pos]));
        free.showBands(true, toggles.edges ? null : pos);
        $("pick-info").innerHTML = partInfo(partByPos[pos]);
      }
    });

    $("pick-info").addEventListener("click", e => {
      const act = e.target.dataset.act;
      if (!act) return;
      const b = picked != null ? blockOf[picked] : null;
      if (act === "hide" && b) b.parts.forEach(p => hidden.add(p.pos));
      if (act === "only" && b) allParts.forEach(p => { if (blockOf[p.pos] !== b) hidden.add(p.pos); else hidden.delete(p.pos); });
      if (act === "hidepart" && picked != null) hidden.add(picked);
      if (act === "all") hidden.clear();
      if (act === "steps" && b) {
        cur = steps.findIndex(s => s.block === b);
        renderStep(false);
        showTab("assembly");
        return;
      }
      if (act === "card" && picked != null) return openPart(picked);
      if (act === "only" && b) {
        freeStates(new Set(b.parts.map(p => p.pos)));
        $("pick-info").innerHTML = blockCard(b);
        return;
      }
      resetPick();
    });

    $("toolbar").addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "btn-reset") {
        hidden.clear();
        $("explode").value = 0;
        free.explode(0);
        free.resetCamera();
        resetPick();
        return;
      }
      if (btn.dataset.mode) {
        mode = btn.dataset.mode;
        $("toolbar").querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("is-on", x === btn));
        resetPick();
        return;
      }
      const t = btn.dataset.toggle;
      toggles[t] = !toggles[t];
      btn.classList.toggle("is-on", toggles[t]);
      if (t === "dims") free.showDims(toggles.dims);
      if (t === "transparent") free.setTransparent(toggles.transparent);
      if (t === "holes") free.showHoles(toggles.holes);
      if (t === "edges") free.showBands(toggles.edges);
    });
    free.showHoles(false);
    $("explode").addEventListener("input", e => free.explode(e.target.value / 100));

    // ---------- Картка деталі (відкривається зі сканування QR) ----------
    let pv = null;
    function openPart(pos) {
      const p = partByPos[pos];
      if (!p) return;
      $("tab-btn-part").hidden = false;
      showTab("part");
      if (!pv) {
        pv = new Viewer3D($("viewer-part"));
        pv.load(m);
        viewers.part = pv;
      }
      pv.resize();
      pv.setStates(q => q === pos ? "active" : "ghost");
      pv.showBands(true, pos);
      pv.showHoles(true);
      pv.showArrows(pos);
      pv.focus(pos);

      const o = orientation(p, ov);
      const dirs = sideDirections(p);
      const edges = (p.edge || []).map(s => `<li><b>${EDGE_CODE[s]}</b> — ${dirs[s]}</li>`).join("") || "<li>Без кромки</li>";
      const near = neighbours(p, allParts).map(q =>
        `<button type="button" class="chip" data-part="${q.pos}"><b>${q.pos}</b> ${esc(q.name)}</button>`).join("") || '<span class="muted">—</span>';
      const si = stepOf[pos];
      const labels = {};
      Object.keys(dirs).forEach(s => { labels[s] = dirs[s]; });

      $("part-card").innerHTML = `
        <div class="block">
          <p class="muted">Деталь №${p.pos}${p.art ? " · поз. " + esc(p.art) : ""} · блок «${esc(blockOf[pos].name)}»</p>
          <h2>${esc(p.name)}</h2>
          <p><b>${p.dims[0]} × ${p.dims[1]} × ${p.dims[2]} мм</b> · ${esc(p.material)}</p>
          <div class="orient">
            <p><b>Як стоїть:</b> ${o.pose}. Довга сторона — ${o.lenDir}.</p>
            <p><b>Кромка</b> (оранжева на 3D):</p>
            <ul>${edges}</ul>
            ${p.grooves ? `<p><b>Паз:</b> ${esc(p.grooves)}</p>` : ""}
            <p><b>Отвори:</b> ${(p.holes || []).length ? p.holes.length + " шт (червоні точки)" : "немає"}</p>
          </div>
          <p class="muted">Синя стрілка — вгору, зелена — перед виробу.</p>
          ${si !== undefined ? `<button type="button" class="btn" id="go-step">Встановлюється на кроці ${si + 1} →</button>` : ""}
          <h3>Стикується з</h3>
          <div class="chips" id="near">${near}</div>
          <h3>Креслення</h3>
          ${Drawings.partDrawing(p, labels)}
        </div>`;
      const go = $("go-step");
      if (go) go.addEventListener("click", () => { cur = si; renderStep(false); showTab("assembly"); });
      $("near").addEventListener("click", e => {
        const b = e.target.closest("[data-part]");
        if (b) openPart(Number(b.dataset.part));
      });
      if (history.replaceState) {
        const u = new URLSearchParams(location.search);
        u.set("part", pos);
        history.replaceState(null, "", "?" + u.toString());
      }
    }

    // ---------- Список деталей ----------
    $("tab-spec").innerHTML = m.blocks.map(b => `
      <div class="block">
        <h2>${esc(b.name)}</h2>
        <div class="table-wrap"><table class="parts">
          <thead><tr><th>Поз.</th><th>Назва</th><th>Матеріал</th><th>Довж.</th><th>Шир.</th><th>Тов.</th><th>Кромка</th><th>Примітка</th></tr></thead>
          <tbody>${b.parts.map(p => `<tr data-part="${p.pos}" class="row-link"><td>${p.pos}</td><td>${esc(p.name)}</td><td>${esc(p.material)}</td>
            <td>${p.dims[0]}</td><td>${p.dims[1]}</td><td>${p.dims[2]}</td><td>${edgeText(p)}</td><td>${esc(p.grooves || "")}</td></tr>`).join("")}</tbody>
        </table></div>
        ${hwTable(b.hardware)}
      </div>`).join("") +
      `<div class="block"><h2>Матеріали</h2><div class="table-wrap"><table class="parts">
        <thead><tr><th>Матеріал</th><th>Деталей</th><th>Площа, м²</th><th>Кромка, м</th></tr></thead>
        <tbody>${materialSummary(m).map(r => `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${r.area.toFixed(2)}</td><td>${r.edge.toFixed(1)}</td></tr>`).join("")}</tbody>
      </table></div></div>` +
      `<div class="block"><h2>Уся фурнітура</h2>${hwTable(sumHardware(m.blocks))}</div>`;
    $("tab-spec").addEventListener("click", e => {
      const r = e.target.closest("[data-part]");
      if (r) openPart(Number(r.dataset.part));
    });

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
        ${allParts.map(p => `
          <div class="block part-sheet">
            <h3>${p.pos}. ${esc(p.name)}</h3>
            <p class="muted">${esc(p.material)} · ${p.dims[0]}×${p.dims[1]}×${p.dims[2]} мм · кромка: ${edgeText(p)}</p>
            ${Drawings.partDrawing(p, sideDirections(p))}
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

    const startPart = Number(params.get("part"));
    if (startPart && partByPos[startPart]) openPart(startPart);

    window.__model = { steps: steps.length, parts: count };
  }

  loadSource()
    .then(normalize)
    .then(init)
    .catch(err => fail(esc(err.message)));
})();
