// Експорт моделі Базис-Мебельщика у JSON для сайту інструкцій (model.html).
// ЧЕРНЕТКА: написано за офіційними типами API (github.com/BazisSoft/Scripts),
// у Базисі ще не перевірено. Перед використанням перевірте на тестовій моделі:
// напрямок осей, одиниці (мм), позиції деталей і кромку.
//
// Встановлення: покласти файл у Documents\BazisX\Scripts і запустити з меню скриптів.

var OUT = { id: "", name: "", materials: {}, blocks: [] };
var PALETTE = ["#d9c4a0", "#8fb0c4", "#efe9dc", "#b9a3c9", "#a7c49a", "#d6a38f", "#c9c9c9"];
var nextPos = 1;
var EPS = 0.5;

function r(n) { return Math.round(n * 10) / 10; }

function materialColor(name) {
  if (!OUT.materials[name]) {
    OUT.materials[name] = PALETTE[Object.keys(OUT.materials).length % PALETTE.length];
  }
  return OUT.materials[name];
}

// Сторона контуру, на яку нанесено кромку: l1/l2 — довгі сторони, w1/w2 — короткі
function buttSide(panel, elemIndex) {
  var c = panel.Contour;
  var el = c.Objects[elemIndex];
  if (!el || !el.IsLine()) return null; // криволінійні торці поки не підтримуємо
  var ln = el.AsLine();
  var horizontal = Math.abs(ln.Pos1.y - ln.Pos2.y) < EPS;
  var vertical = Math.abs(ln.Pos1.x - ln.Pos2.x) < EPS;
  var lengthAlongX = panel.ContourWidth >= panel.ContourHeight;
  if (horizontal) {
    var top = Math.abs(ln.Pos1.y - c.Max.y) < EPS;
    return lengthAlongX ? (top ? "l1" : "l2") : (top ? "w1" : "w2");
  }
  if (vertical) {
    var left = Math.abs(ln.Pos1.x - c.Min.x) < EPS;
    return lengthAlongX ? (left ? "w1" : "w2") : (left ? "l1" : "l2");
  }
  return null;
}

function panelData(p) {
  var min = p.GabMin, max = p.GabMax;
  var edge = [], cuts = [];
  for (var i = 0; i < p.Butts.Count; i++) {
    var side = buttSide(p, p.Butts.Butts[i].ElemIndex);
    if (side && edge.indexOf(side) < 0) edge.push(side);
  }
  for (var j = 0; j < p.Cuts.Count; j++) {
    var cut = p.Cuts.Cuts[j];
    cuts.push(cut.Name || cut.Sign || "Паз");
  }
  var material = p.MaterialName || "Без матеріалу";
  materialColor(material);
  // Однакові деталі в Базисі мають однакову позицію, а сайту потрібен унікальний номер
  return {
    pos: nextPos++,
    art: p.ArtPos || "",
    name: p.Name || "Деталь",
    material: material,
    size: [r(max.x - min.x), r(max.y - min.y), r(max.z - min.z)],
    at: [r(min.x), r(min.y), r(min.z)],
    dims: [r(Math.max(p.ContourWidth, p.ContourHeight)), r(Math.min(p.ContourWidth, p.ContourHeight)), r(p.Thickness)],
    edge: edge,
    grooves: cuts.join(", ")
  };
}

function addHardware(block, name) {
  for (var i = 0; i < block.hardware.length; i++) {
    if (block.hardware[i].name === name) { block.hardware[i].qty++; return; }
  }
  block.hardware.push({ name: name, qty: 1 });
}

// Обходимо структуру: панелі — у деталі, крепіж і фурнітуру — у список фурнітури блоку
function collect(list, block) {
  for (var i = 0; i < list.Count; i++) {
    var obj = list[i];
    if (!obj.Visible) continue;
    if (obj.List) {
      var sub = obj.AsList();
      if (sub.IsFastener && sub.IsFastener()) addHardware(block, obj.Name || "Кріплення");
      else collect(sub, block);
    } else if (obj.AsPanel) {
      block.parts.push(panelData(obj.AsPanel));
    } else {
      addHardware(block, obj.Name || "Фурнітура");
    }
  }
}

// Кожен об'єкт верхнього рівня — окремий блок інструкції
var loose = { id: "other", name: "Інші деталі", parts: [], hardware: [] };
for (var i = 0; i < Model.Count; i++) {
  var top = Model[i];
  if (top.List && !(top.AsList().IsFastener && top.AsList().IsFastener())) {
    var block = { id: "b" + (i + 1), name: top.Name || "Блок " + (i + 1), parts: [], hardware: [] };
    collect(top.AsList(), block);
    if (block.parts.length) OUT.blocks.push(block);
  } else if (top.AsPanel) {
    loose.parts.push(panelData(top.AsPanel));
  } else if (top.Visible) {
    addHardware(loose, top.Name || "Фурнітура");
  }
}
if (loose.parts.length) OUT.blocks.push(loose);

OUT.name = Article.OrderName || Article.Name || "Виріб";
OUT.id = (Article.OrderCode || "model").replace(/[^\w-]/g, "") + "-" + Date.now();

if (!OUT.blocks.length) {
  alert("У моделі не знайдено панелей для експорту.");
} else {
  system.askWriteTextFile("json", JSON.stringify(OUT, null, 1));
}
