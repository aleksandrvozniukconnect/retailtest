// Креслення у вигляді SVG: вигляд блоку спереду з висотами полиць і креслення окремої деталі.
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const EDGE_NAMES = { l1: "довга сторона 1", l2: "довга сторона 2", w1: "коротка сторона 1", w2: "коротка сторона 2" };

  function isHorizontal(p) {
    return p.size[1] <= 30 && p.size[0] > p.size[1] * 5 && p.size[2] > p.size[1] * 5;
  }

  // Вигляд спереду: контури деталей, висоти горизонтальних деталей від низу блоку
  function frontView(block, model) {
    const parts = block.parts;
    const x0 = Math.min(...parts.map(p => p.at[0]));
    const x1 = Math.max(...parts.map(p => p.at[0] + p.size[0]));
    const y0 = Math.min(...parts.map(p => p.at[1]));
    const y1 = Math.max(...parts.map(p => p.at[1] + p.size[1]));
    const W = x1 - x0, H = y1 - y0;
    const box = 300;
    const k = box / Math.max(W, H);
    const padL = 56, padT = 26, padR = 20, padB = 34;
    const vw = W * k + padL + padR, vh = H * k + padT + padB;
    const X = x => padL + (x - x0) * k;
    const Y = y => padT + (y1 - y) * k;

    const sorted = parts.slice().sort((a, b) => a.at[2] - b.at[2]);
    const rects = sorted.map(p => {
      const fill = (model.materials && model.materials[p.material]) || "#ddd";
      return `<rect x="${X(p.at[0])}" y="${Y(p.at[1] + p.size[1])}" width="${p.size[0] * k}" height="${p.size[1] * k}" fill="${fill}" fill-opacity="0.75" stroke="#4a4a45" stroke-width="1"/>`;
    }).join("");

    const heights = [...new Set(parts.filter(isHorizontal).map(p => p.at[1] - y0))].sort((a, b) => a - b);
    const marks = heights.map(h => {
      const y = Y(y0 + h);
      return `<line x1="${padL - 14}" y1="${y}" x2="${padL}" y2="${y}" stroke="#3b6e4f" stroke-width="1.5"/>
              <text x="${padL - 18}" y="${y + 4}" text-anchor="end" font-size="11" fill="currentColor">${Math.round(h)}</text>`;
    }).join("");

    return `<svg class="drawing-svg" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Вигляд спереду: ${esc(block.name)}">
      ${rects}${marks}
      <line x1="${X(x0)}" y1="${padT + H * k + 16}" x2="${X(x1)}" y2="${padT + H * k + 16}" stroke="currentColor" stroke-width="1"/>
      <text x="${(X(x0) + X(x1)) / 2}" y="${padT + H * k + 28}" text-anchor="middle" font-size="12" fill="currentColor">${Math.round(W)}</text>
      <text x="${padL}" y="14" font-size="12" fill="currentColor">Висота від низу, мм</text>
    </svg>`;
  }

  // Креслення деталі: прямокутник довжина × ширина, кромка, отвори.
  // labels — підписи сторін у виробі, напр. { l1: "спереду", w1: "зверху" }
  function partDrawing(p, labels) {
    const [L, Wd] = p.dims;
    const box = 260;
    const k = box / Math.max(L, Wd);
    const pad = 54;
    const lb = labels || {};
    const w = L * k, h = Wd * k;
    const vw = w + pad * 2, vh = h + pad * 2;
    const edges = new Set(p.edge || []);
    const line = (x1, y1, x2, y2, on) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on ? "#c2410c" : "#4a4a45"}" stroke-width="${on ? 4 : 1.5}"/>`;

    const holes = (p.holes || []).map(o =>
      `<circle cx="${pad + o.l * k}" cy="${pad + o.w * k}" r="${Math.max(2.5, (o.d / 2) * k)}" fill="none" stroke="#3b6e4f" stroke-width="1.5"/>`
    ).join("");

    return `<svg class="drawing-svg" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Деталь ${p.pos}: ${esc(p.name)}">
      <rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="none" stroke="none"/>
      ${line(pad, pad, pad + w, pad, edges.has("l1"))}
      ${line(pad, pad + h, pad + w, pad + h, edges.has("l2"))}
      ${line(pad, pad, pad, pad + h, edges.has("w1"))}
      ${line(pad + w, pad, pad + w, pad + h, edges.has("w2"))}
      ${holes}
      <text x="${pad + w / 2}" y="${pad - 28}" text-anchor="middle" font-size="12" fill="currentColor">${L}</text>
      <text x="${pad - 32}" y="${pad + h / 2}" text-anchor="middle" font-size="12" fill="currentColor" transform="rotate(-90 ${pad - 32} ${pad + h / 2})">${Wd}</text>
      ${side(lb.l1, pad + w / 2, pad - 9, 0)}
      ${side(lb.l2, pad + w / 2, pad + h + 17, 0)}
      ${side(lb.w1, pad - 10, pad + h / 2, -90)}
      ${side(lb.w2, pad + w + 14, pad + h / 2, 90)}
    </svg>`;
  }

  function side(text, x, y, rot) {
    if (!text) return "";
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="11" font-style="italic" fill="#c2410c"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ""}>${esc(text)}</text>`;
  }

  window.Drawings = { frontView, partDrawing, EDGE_NAMES, isHorizontal };
})();
