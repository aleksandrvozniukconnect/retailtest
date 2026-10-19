// 3D-перегляд моделі на three.js. Кожна деталь — паралелепіпед з розмірами й позицією з JSON.
(function () {
  const ACCENT = 0x3b6e4f;
  const EDGE_COLOR = 0xe0702a;
  const HOLE_COLOR = 0xd62828;

  // Осі деталі: довжина, ширина, товщина — індекси осей x/y/z у size
  function partAxes(p) {
    const idx = [0, 1, 2];
    const la = idx.find(i => Math.abs(p.size[i] - p.dims[0]) < 0.6);
    const wa = idx.find(i => i !== la && Math.abs(p.size[i] - p.dims[1]) < 0.6);
    if (la === undefined || wa === undefined) {
      const order = idx.slice().sort((a, b) => p.size[b] - p.size[a]);
      return { la: order[0], wa: order[1], ta: order[2] };
    }
    return { la, wa, ta: idx.find(i => i !== la && i !== wa) };
  }

  function Viewer3D(container) {
    const w = () => container.clientWidth || 300;
    const h = () => container.clientHeight || 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w() / h(), 1, 50000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w(), h());
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(-600, 1200, 900);
    scene.add(sun);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const group = new THREE.Group();
    const dimsGroup = new THREE.Group();
    const helpers = new THREE.Group();
    scene.add(group, dimsGroup, helpers);

    const entries = {};         // pos -> { mesh, edges, label, base, dir, mat, holes, bands }
    let model = null;
    let center = new THREE.Vector3();
    let bbox = new THREE.Box3();
    let radius = 1000;
    let pickHandler = null;
    let transparent = false;
    let explodeK = 0;
    let anim = [];              // активні анімації появи деталей

    function colorOf(m) {
      return new THREE.Color((model.materials && model.materials[m]) || "#cccccc");
    }

    function textSprite(text, bg, fg) {
      const c = document.createElement("canvas");
      const g = c.getContext("2d");
      g.font = "bold 34px sans-serif";
      const tw = Math.max(64, g.measureText(text).width + 28);
      c.width = tw; c.height = 64;
      g.font = "bold 34px sans-serif";
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(0, 0, tw, 64, 32); else g.rect(0, 0, tw, 64);
      g.fill();
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, tw / 2, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      sp.userData.aspect = tw / 64;
      sp.renderOrder = 10;
      return sp;
    }

    function scaleSprite(sp, s) { sp.scale.set(s * sp.userData.aspect, s, 1); }

    // Отвори — на пласті, поверненій до центру моделі (зазвичай внутрішній бік)
    function makeHoles(p, base) {
      const g = new THREE.Group();
      if (!p.holes || !p.holes.length) return g;
      const ax = partAxes(p);
      const half = p.size.map(v => v / 2);
      const inward = (center.getComponent(ax.ta) - base.getComponent(ax.ta)) >= 0 ? 1 : -1;
      p.holes.forEach(o => {
        const r = Math.max(3, (o.d || 8) / 2);
        const geo = new THREE.CylinderGeometry(r, r, 1.5, 16);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: HOLE_COLOR, depthTest: true }));
        const v = [0, 0, 0];
        v[ax.la] = -half[ax.la] + o.l;
        v[ax.wa] = -half[ax.wa] + o.w;
        v[ax.ta] = inward * (half[ax.ta] + 0.8);
        m.position.set(v[0], v[1], v[2]);
        if (ax.ta === 0) m.rotation.z = Math.PI / 2;
        if (ax.ta === 2) m.rotation.x = Math.PI / 2;
        g.add(m);
      });
      return g;
    }

    // Кромка: l1/l2 — довгі торці (на краях осі ширини), w1/w2 — короткі (на краях осі довжини)
    function makeBands(p) {
      const g = new THREE.Group();
      const ax = partAxes(p);
      const half = p.size.map(v => v / 2);
      const t = 2.5;
      (p.edge || []).forEach(side => {
        const axis = side[0] === "l" ? ax.wa : ax.la;
        const sign = side[1] === "1" ? 1 : -1;
        const s = p.size.slice();
        s[axis] = t;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s[0] + 0.5, s[1] + 0.5, s[2] + 0.5),
          new THREE.MeshBasicMaterial({ color: EDGE_COLOR }));
        const v = [0, 0, 0];
        v[axis] = sign * (half[axis] - t / 2 + 0.6);
        m.position.set(v[0], v[1], v[2]);
        g.add(m);
      });
      g.visible = false;
      return g;
    }

    function buildDims() {
      while (dimsGroup.children.length) dimsGroup.remove(dimsGroup.children[0]);
      const min = bbox.min, max = bbox.max;
      const off = radius * 0.06;
      const mat = new THREE.LineBasicMaterial({ color: 0x2d2d2a });
      const add = (a, b, text, lp) => {
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        dimsGroup.add(new THREE.Line(geo, mat));
        const sp = textSprite(text, "#ffffff", "#1d1d1b");
        scaleSprite(sp, radius * 0.045);
        sp.position.copy(lp);
        dimsGroup.add(sp);
      };
      const W = Math.round(max.x - min.x), H = Math.round(max.y - min.y), D = Math.round(max.z - min.z);
      add(new THREE.Vector3(min.x, min.y - off, max.z), new THREE.Vector3(max.x, min.y - off, max.z), W + "",
        new THREE.Vector3((min.x + max.x) / 2, min.y - off * 2, max.z));
      add(new THREE.Vector3(min.x - off, min.y, max.z), new THREE.Vector3(min.x - off, max.y, max.z), H + "",
        new THREE.Vector3(min.x - off * 2.4, (min.y + max.y) / 2, max.z));
      add(new THREE.Vector3(max.x + off, max.y + off, min.z), new THREE.Vector3(max.x + off, max.y + off, max.z), D + "",
        new THREE.Vector3(max.x + off * 2.4, max.y + off * 2, (min.z + max.z) / 2));
      dimsGroup.visible = false;
    }

    function load(m) {
      model = m;
      while (group.children.length) group.remove(group.children[0]);
      Object.keys(entries).forEach(k => delete entries[k]);

      bbox = new THREE.Box3();
      const all = m.blocks.flatMap(b => b.parts);
      all.forEach(p => {
        bbox.expandByPoint(new THREE.Vector3(p.at[0], p.at[1], p.at[2]));
        bbox.expandByPoint(new THREE.Vector3(p.at[0] + p.size[0], p.at[1] + p.size[1], p.at[2] + p.size[2]));
      });
      center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.y, size.z);

      all.forEach(p => {
        const geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
        const mat = new THREE.MeshLambertMaterial({ color: colorOf(p.material), transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        const base = new THREE.Vector3(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2, p.at[2] + p.size[2] / 2);
        mesh.position.copy(base);
        mesh.userData.pos = p.pos;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4a4a45, transparent: true }));
        mesh.add(edges);
        const label = textSprite(String(p.pos), "#1d1d1b", "#ffffff");
        scaleSprite(label, radius * 0.05);
        label.visible = false;
        mesh.add(label);
        const holes = makeHoles(p, base);
        mesh.add(holes);
        const bands = makeBands(p);
        mesh.add(bands);
        group.add(mesh);
        entries[p.pos] = { mesh, edges, label, base, mat, holes, bands, part: p, dir: base.clone().sub(center), baseColor: mat.color.clone(), state: "normal" };
      });

      buildDims();
      resetCamera();
    }

    function resetCamera() {
      camera.position.set(center.x - radius * 0.9, center.y + radius * 0.8, center.z + radius * 2.1);
      controls.target.copy(center);
      controls.update();
    }

    function focus(pos) {
      const e = entries[pos];
      if (!e) return;
      const c = e.mesh.position.clone();
      const r = Math.max(Math.max(...e.part.size) * 1.4, radius * 0.9);
      camera.position.set(c.x - r * 0.9, c.y + r * 0.6, c.z + r * 1.9);
      controls.target.copy(c);
      controls.update();
    }

    function place(e) {
      e.mesh.position.copy(e.base).add(e.dir.clone().multiplyScalar(explodeK * 0.8));
    }

    // k — від 0 до 1, наскільки розсунути деталі від центру моделі
    function explode(k) {
      explodeK = k;
      Object.values(entries).forEach(place);
    }

    function paint(e) {
      const s = e.state;
      e.mesh.visible = s !== "hidden";
      const ghost = s === "ghost";
      const op = ghost ? 0.14 : (transparent && s !== "active" ? 0.3 : 1);
      e.mat.opacity = op;
      e.mat.depthWrite = op === 1;
      e.edges.material.opacity = ghost ? 0.25 : 1;
      e.label.visible = s === "active";
      if (s === "active") e.mat.color.set(ACCENT).lerp(e.baseColor, 0.35);
      else e.mat.color.copy(e.baseColor);
    }

    // state: pos -> "hidden" | "ghost" | "normal" | "active"
    function setStates(fn) {
      Object.keys(entries).forEach(pos => {
        const e = entries[pos];
        e.state = fn(Number(pos));
        paint(e);
      });
    }

    function setTransparent(on) {
      transparent = on;
      Object.values(entries).forEach(paint);
    }

    function showDims(on) { dimsGroup.visible = on; }
    function showHoles(on) { Object.values(entries).forEach(e => { e.holes.visible = on; }); }
    function showBands(on, only) {
      Object.keys(entries).forEach(pos => {
        entries[pos].bands.visible = on && (only == null || Number(pos) === only);
      });
    }

    // Стрілки «вгору» і «вперед» біля деталі
    function showArrows(pos) {
      while (helpers.children.length) helpers.remove(helpers.children[0]);
      if (pos == null || !entries[pos]) return;
      const e = entries[pos];
      const c = e.mesh.position.clone();
      const len = Math.max(...e.part.size) * 0.45 + radius * 0.12;
      const top = c.clone().add(new THREE.Vector3(0, e.part.size[1] / 2, 0));
      const front = c.clone().add(new THREE.Vector3(0, 0, e.part.size[2] / 2));
      helpers.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), top, len, 0x2563eb, len * 0.22, len * 0.12));
      helpers.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), front, len, 0x16a34a, len * 0.22, len * 0.12));
      const up = textSprite("ВГОРУ", "#2563eb", "#ffffff");
      scaleSprite(up, radius * 0.04);
      up.position.copy(top).add(new THREE.Vector3(0, len * 1.12, 0));
      const fr = textSprite("ПЕРЕД", "#16a34a", "#ffffff");
      scaleSprite(fr, radius * 0.04);
      fr.position.copy(front).add(new THREE.Vector3(0, 0, len * 1.15));
      helpers.add(up, fr);
    }

    // Деталі прилітають на своє місце: зверху й ззовні моделі
    function animateIn(list, ms) {
      return new Promise(resolve => {
        const items = list.map(pos => entries[pos]).filter(Boolean);
        if (!items.length || ms <= 0) { items.forEach(place); resolve(); return; }
        const t0 = performance.now();
        items.forEach(e => {
          const out = e.dir.clone().setY(0);
          if (out.lengthSq() < 1) out.set(0, 0, 1);
          out.normalize().multiplyScalar(radius * 0.7).add(new THREE.Vector3(0, radius * 0.5, 0));
          anim.push({ e, from: out, t0, ms, resolve: null });
        });
        anim[anim.length - 1].resolve = resolve;
      });
    }

    function stopAnimation() {
      anim.forEach(a => { place(a.e); if (a.resolve) a.resolve(); });
      anim = [];
    }

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener("pointerdown", ev => { down = [ev.clientX, ev.clientY]; });
    renderer.domElement.addEventListener("pointerup", ev => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5 || !pickHandler) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const meshes = group.children.filter(m => m.visible && entries[m.userData.pos].state !== "ghost");
      const hit = ray.intersectObjects(meshes, false)[0];
      pickHandler(hit ? hit.object.userData.pos : null);
    });

    function resize() {
      renderer.setSize(w(), h());
      camera.aspect = w() / h();
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);

    (function loop(now) {
      requestAnimationFrame(loop);
      if (anim.length) {
        anim = anim.filter(a => {
          const k = Math.min(1, (now - a.t0) / a.ms);
          const ease = 1 - Math.pow(1 - k, 3);
          place(a.e);
          a.e.mesh.position.add(a.from.clone().multiplyScalar(1 - ease));
          if (k >= 1) { if (a.resolve) a.resolve(); return false; }
          return true;
        });
      }
      controls.update();
      renderer.render(scene, camera);
    })(performance.now());

    return {
      load, resize, resetCamera, focus, explode, setStates, setTransparent,
      showDims, showHoles, showBands, showArrows, animateIn, stopAnimation,
      onPick(fn) { pickHandler = fn; },
      snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); }
    };
  }

  window.Viewer3D = Viewer3D;
  window.partAxes = partAxes;
})();
