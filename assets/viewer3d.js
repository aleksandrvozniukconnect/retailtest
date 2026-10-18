// 3D-перегляд моделі на three.js. Кожна деталь — паралелепіпед з розмірами й позицією з JSON.
(function () {
  function Viewer3D(container) {
    const w = () => container.clientWidth || 300;
    const h = () => container.clientHeight || 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w() / h(), 1, 20000);
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
    scene.add(group);

    const entries = {};         // pos -> { mesh, edges, base, dir, labels }
    let model = null;
    let center = new THREE.Vector3();
    let radius = 1000;
    let pickHandler = null;
    let selected = null;

    function colorOf(m) {
      return new THREE.Color((model.materials && model.materials[m]) || "#cccccc");
    }

    function numberSprite(text) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      g.fillStyle = "#1d1d1b";
      g.beginPath();
      g.arc(32, 32, 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "bold 34px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(text), 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      return sp;
    }

    function load(m) {
      model = m;
      while (group.children.length) group.remove(group.children[0]);
      Object.keys(entries).forEach(k => delete entries[k]);

      const bbox = new THREE.Box3();
      m.blocks.forEach(b => b.parts.forEach(p => {
        const geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
        const mat = new THREE.MeshLambertMaterial({ color: colorOf(p.material), transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        const base = new THREE.Vector3(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2, p.at[2] + p.size[2] / 2);
        mesh.position.copy(base);
        mesh.userData.pos = p.pos;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4a4a45, transparent: true }));
        mesh.add(edges);
        const label = numberSprite(p.pos);
        label.visible = false;
        mesh.add(label);
        group.add(mesh);
        entries[p.pos] = { mesh, edges, label, base, mat, size: p.size, baseColor: mat.color.clone() };
        bbox.expandByObject(mesh);
      }));

      center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.y, size.z);
      Object.values(entries).forEach(e => {
        e.dir = e.base.clone().sub(center);
        const s = radius * 0.05;
        e.label.scale.set(s, s, 1);
      });
      resetCamera();
    }

    function resetCamera() {
      camera.position.set(center.x - radius * 0.9, center.y + radius * 0.8, center.z + radius * 2.1);
      controls.target.copy(center);
      controls.update();
    }

    // k — від 0 до 1, наскільки розсунути деталі від центру моделі
    function explode(k) {
      Object.values(entries).forEach(e => {
        e.mesh.position.copy(e.base).add(e.dir.clone().multiplyScalar(k * 0.8));
      });
    }

    // state: pos -> "hidden" | "ghost" | "normal" | "active"
    function setStates(fn) {
      Object.keys(entries).forEach(pos => {
        const e = entries[pos];
        const s = fn(Number(pos));
        e.mesh.visible = s !== "hidden";
        e.mat.opacity = s === "ghost" ? 0.18 : 1;
        e.edges.material.opacity = s === "ghost" ? 0.25 : 1;
        e.label.visible = s === "active";
        if (s === "active") e.mat.color.set(0x3b6e4f).lerp(e.baseColor, 0.35);
        else e.mat.color.copy(e.baseColor);
      });
    }

    function select(pos) {
      selected = pos;
      Object.keys(entries).forEach(p => {
        const e = entries[p];
        const on = Number(p) === pos;
        e.mat.color.copy(on ? new THREE.Color(0x3b6e4f) : e.baseColor);
        e.label.visible = on;
      });
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
      const hit = ray.intersectObjects(group.children).find(i => i.object.visible);
      pickHandler(hit ? hit.object.userData.pos : null);
    });

    function resize() {
      renderer.setSize(w(), h());
      camera.aspect = w() / h();
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);

    (function loop() {
      requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    })();

    return {
      load, resize, resetCamera, explode, setStates, select,
      onPick(fn) { pickHandler = fn; },
      snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
      get selected() { return selected; }
    };
  }

  window.Viewer3D = Viewer3D;
})();
