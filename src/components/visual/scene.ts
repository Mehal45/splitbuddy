// Live 3D yard: the warehouse, the plant, customer areas and every truck,
// seen from above. Built with three.js and Kenney's low-poly models (MIT).
// The React page hands in a SceneModel whenever the data changes; trucks then
// drive along the roads to their new position.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { MODELS } from "./models3d";

export type Pick = { kind: "warehouse" | "plant" | "truck" | "area"; id: string };

export interface VizArea { name: string; x: number; z: number; customers: number; delivered: number; pending: number; orders: number }
export interface VizTruck {
  id: string; reg: string; driver: string;
  status: "home" | "out" | "back";
  full: number; empty: number; delivered: number;
  at?: string; // area of the latest delivery today
}
export interface SceneModel {
  warehouse: { full: { label: string; n: number; commercial: boolean }[]; empty: number; total: number };
  plant: { x: number; z: number; name: string };
  areas: VizArea[];
  trucks: VizTruck[];
}

const COLORS = { bg: "#f5f6f8", ground: "#f1f2f5", pad: "#e6e8ed", road: "#d5d9e0", line: "#ffffff", domestic: "#c8302c", commercial: "#2d5fb5", empty: "#a9afba", select: "#f59e0b" };
const TRUCK_MODELS = ["vehicles/vehicle-truck-red", "vehicles/vehicle-truck-yellow", "vehicles/vehicle-truck-green"];
const HOUSES = ["city/building-small-a", "city/building-small-b", "city/building-small-d", "city/building-small-c"];
const HUB = new THREE.Vector3(0, 0, 3.2); // road junction in front of the warehouse gate
const SPEED = 4.2; // world units per second

interface TruckObj { group: THREE.Group; wheels: THREE.Object3D[]; cargo: THREE.InstancedMesh; label: CSS2DObject; path: THREE.Vector3[]; seg: number; key: string; home: THREE.Vector3; data: VizTruck; idle: number }

export class LiveScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private templates = new Map<string, THREE.Group>();
  private ready: Promise<void>;
  private dynamic = new THREE.Group(); // areas, roads, stacks: rebuilt on update
  private trucks = new Map<string, TruckObj>();
  private picks: THREE.Object3D[] = [];
  private ring: THREE.Mesh;
  private selected: Pick | null = null;
  private raf = 0;
  private disposed = false;
  private areaPos = new Map<string, THREE.Vector3>();
  private ro: ResizeObserver;
  private intro = 0;

  constructor(private host: HTMLElement, private onPick: (p: Pick | null) => void) {
    const w = host.clientWidth, h = host.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    host.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.Fog(COLORS.bg, 38, 75);
    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 400);
    this.camera.position.set(22, 30, 30);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 10, maxDistance: 70, minPolarAngle: 0.2, maxPolarAngle: 1.12, screenSpacePanning: false });
    this.controls.target.set(0, 0, 1);

    // Light: soft sky fill + a warm sun with wide, soft shadows
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#c9ced8", 1.5));
    const sun = new THREE.DirectionalLight("#fff6ea", 2.4);
    sun.position.set(-14, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({ color: COLORS.select, transparent: true, opacity: 0.9 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.scene.add(this.ring, this.dynamic);

    this.ready = this.loadModels();
    this.renderer.domElement.addEventListener("pointerdown", this.onDown);
    this.renderer.domElement.addEventListener("pointerup", this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.loop();
  }

  // ---------- models ----------

  private async loadModels() {
    const manager = new THREE.LoadingManager();
    let kit = "city";
    manager.setURLModifier((url) => (url.endsWith("colormap.png") ? MODELS[`${kit}/texture`] : url));
    // Textures load through an <img> (allowed by img-src data:) instead of fetch()
    manager.addHandler(/colormap\.png$/i, new THREE.TextureLoader(manager));
    const loader = new GLTFLoader(manager);
    for (const key of Object.keys(MODELS)) {
      if (key.endsWith("/texture")) continue;
      kit = key.split("/")[0];
      // Decode in memory (no fetch), so the strict connect-src security policy stays as it is
      const b64 = MODELS[key].slice(MODELS[key].indexOf(",") + 1);
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const gltf = await loader.parseAsync(buf.buffer, "");
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      this.templates.set(key, gltf.scene);
    }
  }

  private model(key: string) {
    const t = this.templates.get(key);
    return t ? t.clone(true) : new THREE.Group();
  }

  // ---------- building blocks ----------

  private label(html: string, cls = "") {
    const el = document.createElement("div");
    el.className = `viz-label ${cls}`;
    el.innerHTML = html;
    return new CSS2DObject(el);
  }

  private pad(x: number, z: number, r: number, color = COLORS.pad) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    return m;
  }

  private road(points: THREE.Vector3[]) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.95 });
    const dash = new THREE.MeshBasicMaterial({ color: COLORS.line });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, len + 1.1), mat);
      seg.position.set(mid.x, 0.015, mid.z);
      seg.rotation.y = ang;
      seg.receiveShadow = true;
      g.add(seg);
      for (let d = 0.6; d < len - 0.4; d += 1.0) {
        const p = a.clone().lerp(b, d / len);
        const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.4), dash);
        dm.rotation.set(-Math.PI / 2, 0, ang);
        dm.position.set(p.x, 0.03, p.z);
        g.add(dm);
      }
    }
    return g;
  }

  /** Street route from the hub to a point: along x first, then z (city-block style). */
  private route(to: THREE.Vector3) {
    return [HUB.clone(), new THREE.Vector3(to.x, 0, HUB.z), new THREE.Vector3(to.x, 0, to.z - Math.sign(to.z - HUB.z || 1) * 1.6)];
  }

  private cylinderMesh(count: number, color: string, radius = 0.13, height = 0.42) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 18);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = count;
    return mesh;
  }

  /** Neat rows of cylinders: `n` shown (capped), laid out from (x, z). */
  private stack(n: number, color: string, x: number, z: number, cols = 4) {
    const shown = Math.min(n, cols * 4 * 2);
    const mesh = this.cylinderMesh(shown, color);
    const m = new THREE.Matrix4();
    for (let i = 0; i < shown; i++) {
      const layer = Math.floor(i / (cols * 4));
      const k = i % (cols * 4);
      m.setPosition(x + (k % cols) * 0.3, 0.21 + layer * 0.44, z + Math.floor(k / cols) * 0.3);
      mesh.setMatrixAt(i, m);
    }
    return mesh;
  }

  // ---------- update from data ----------

  async update(model: SceneModel) {
    await this.ready;
    if (this.disposed) return;
    this.dynamic.clear();
    this.picks = [];
    this.areaPos.clear();

    // Warehouse with its yard and stock
    const wh = new THREE.Group();
    wh.add(this.pad(0, 0.4, 6.4));
    const shed = this.model("city/building-garage");
    shed.scale.setScalar(3.4);
    shed.position.set(0, 0, -0.6);
    wh.add(shed);
    let sx = -6.7;
    for (const s of model.warehouse.full) {
      if (!s.n) continue;
      wh.add(this.stack(s.n, s.commercial ? COLORS.commercial : COLORS.domestic, sx, -2.6, 4));
      sx += 1.35;
    }
    if (model.warehouse.empty) wh.add(this.stack(model.warehouse.empty, COLORS.empty, -6.7, 0.9, 8));
    wh.userData.pick = { kind: "warehouse", id: "WH" } satisfies Pick;
    const whLabel = this.label(`<b>Main warehouse</b><span>${model.warehouse.total} full · ${model.warehouse.empty} empty</span>`, "viz-main");
    whLabel.position.set(0, 4.2, -0.6);
    wh.add(whLabel);
    this.dynamic.add(wh);
    this.picks.push(wh);

    // Plant
    const plantPos = new THREE.Vector3(model.plant.x, 0, model.plant.z);
    this.dynamic.add(this.road([HUB, new THREE.Vector3(plantPos.x, 0, HUB.z), new THREE.Vector3(plantPos.x, 0, plantPos.z + 1.8)]));
    const plant = new THREE.Group();
    plant.add(this.pad(plantPos.x, plantPos.z, 3));
    const pb = this.model("city/building-small-c");
    pb.scale.setScalar(2.4);
    pb.position.copy(plantPos);
    plant.add(pb);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshStandardMaterial({ color: "#f4f5f7", roughness: 0.3, metalness: 0.2 }));
    tank.position.set(plantPos.x + 2, 0.9, plantPos.z + 0.6);
    tank.castShadow = true;
    plant.add(tank);
    plant.userData.pick = { kind: "plant", id: "PLANT" } satisfies Pick;
    const pl = this.label(`<b>${model.plant.name}</b><span>LPG bottling plant</span>`);
    pl.position.set(plantPos.x, 3.2, plantPos.z);
    plant.add(pl);
    this.dynamic.add(plant);
    this.picks.push(plant);

    // Customer areas, each reached by a street from the hub
    model.areas.forEach((a, i) => {
      const p = new THREE.Vector3(a.x, 0, a.z);
      this.areaPos.set(a.name, p);
      this.dynamic.add(this.road(this.route(p)));
      const g = new THREE.Group();
      g.add(this.pad(a.x, a.z, 2.2));
      const n = Math.min(3, Math.max(1, Math.ceil(a.customers / 4)));
      for (let k = 0; k < n; k++) {
        const b = this.model(HOUSES[(i + k) % HOUSES.length]);
        const ang = (k / n) * Math.PI * 2 + i;
        b.position.set(a.x + (n > 1 ? Math.cos(ang) * 1 : 0), 0, a.z + (n > 1 ? Math.sin(ang) * 1 : 0) - 0.3);
        b.scale.setScalar(1.25);
        g.add(b);
      }
      if (i % 2 === 0) { const t = this.model("city/grass-trees"); t.position.set(a.x + 1.9, 0, a.z + 1.2); t.scale.setScalar(0.8); g.add(t); }
      g.userData.pick = { kind: "area", id: a.name } satisfies Pick;
      const chips = [`${a.customers} customers`, a.delivered ? `${a.delivered} delivered today` : "", a.pending ? `${a.pending} awaiting approval` : "", a.orders ? `${a.orders} new orders` : ""].filter(Boolean);
      const l = this.label(`<b>${a.name}</b><span>${chips.join(" · ")}</span>`, a.orders ? "viz-alert" : "");
      l.position.set(a.x, 2.3, a.z - 0.4);
      g.add(l);
      this.dynamic.add(g);
      this.picks.push(g);
    });

    // Scenery: a few trees around the edge
    for (const [x, z] of [[-7, -6], [7.5, -5.5], [-9, 6], [10, 7], [3, -8]]) {
      const t = this.model("city/grass-trees-tall");
      t.position.set(x, 0, z);
      t.scale.setScalar(1.1);
      this.dynamic.add(t);
    }

    this.syncTrucks(model.trucks);
    this.placeRing();
    if (!this.framed) this.frame(model);
  }

  private framed = false;
  private camEnd = new THREE.Vector3(16, 26, 26);
  /** Fit everything in view on first load, looking down at a calm angle. */
  private frame(model: SceneModel) {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(model.plant.x, 0, model.plant.z), ...model.areas.map((a) => new THREE.Vector3(a.x, 0, a.z))];
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2 + 4;
    const fit = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect * 0.9);
    const dist = THREE.MathUtils.clamp(fit * 0.7, 18, 70);
    this.controls.maxDistance = Math.max(70, dist * 1.3);
    this.controls.target.copy(c);
    this.camEnd.set(c.x + dist * 0.32, dist * 0.78, c.z + dist * 0.55);
    this.framed = true;
    this.intro = 0;
    (this.scene.fog as THREE.Fog).near = dist * 1.4;
    (this.scene.fog as THREE.Fog).far = dist * 3;
  }

  private parking(i: number) {
    // Bays along the front of the warehouse yard
    return new THREE.Vector3(3.0 + (i % 3) * 1.25, 0, -2.2 + Math.floor(i / 3) * 1.8);
  }

  private truckTarget(t: VizTruck, i: number) {
    if (t.status === "out" && t.at && this.areaPos.has(t.at)) {
      const p = this.areaPos.get(t.at)!;
      return { path: this.route(p), key: `at:${t.at}` };
    }
    if (t.status === "out") return { path: [this.parking(i), HUB.clone().add(new THREE.Vector3(0, 0, 1.2))], key: "leaving" };
    return { path: [this.parking(i)], key: "home" };
  }

  private syncTrucks(list: VizTruck[]) {
    const seen = new Set<string>();
    list.forEach((t, i) => {
      seen.add(t.id);
      let o = this.trucks.get(t.id);
      const target = this.truckTarget(t, i);
      if (!o) {
        const group = new THREE.Group();
        const body = this.model(TRUCK_MODELS[i % TRUCK_MODELS.length]);
        body.scale.setScalar(0.62);
        group.add(body);
        const wheels: THREE.Object3D[] = [];
        body.traverse((c) => { if (c.name.startsWith("wheel")) wheels.push(c); });
        const cargo = this.cylinderMesh(12, COLORS.domestic, 0.09, 0.28);
        group.add(cargo);
        const label = this.label("");
        label.position.set(0, 2.1, 0);
        group.add(label);
        // Trucks that are out drive from the yard to where they are now, so the scene opens in motion
        const yard = this.parking(i);
        group.position.copy(target.key === "home" ? target.path[target.path.length - 1] : yard);
        group.rotation.y = Math.PI;
        group.userData.pick = { kind: "truck", id: t.id } satisfies Pick;
        this.scene.add(group);
        o = { group, wheels, cargo, label, path: target.key === "home" ? [] : [yard.clone(), ...target.path], seg: 0, key: target.key, home: yard, data: t, idle: Math.random() * 6 };
        this.trucks.set(t.id, o);
      } else if (o.key !== target.key) {
        // Drive there along the streets: back to the hub first if it's out somewhere
        const from = o.group.position.clone();
        const back = o.key.startsWith("at:") ? [...this.route(this.areaPos.get(o.key.slice(3)) ?? HUB)].reverse() : [];
        o.path = [from, ...back, ...target.path];
        o.seg = 0;
        o.key = target.key;
      }
      o.data = t;
      o.home = this.parking(i);
      // cylinders on the truck bed (2 layers of 6)
      const shown = Math.min(t.full, 12);
      const m = new THREE.Matrix4();
      for (let k = 0; k < shown; k++) { m.setPosition(-0.18 + (k % 3) * 0.18, 0.62 + Math.floor(k / 6) * 0.29, -0.55 + (Math.floor(k / 3) % 2) * 0.2); o.cargo.setMatrixAt(k, m); }
      o.cargo.count = shown;
      o.cargo.instanceMatrix.needsUpdate = true;
      const status = t.status === "out" ? (t.at ? `At ${t.at}` : "Leaving warehouse") : t.status === "back" ? "Returned" : "At warehouse";
      o.label.element.className = `viz-label viz-truck ${t.status === "out" ? "viz-out" : ""}`;
      o.label.visible = t.status === "out";
      o.label.element.innerHTML = `<b>${t.reg}</b><span>${status} · ${t.full} full${t.delivered ? ` · ${t.delivered} delivered` : ""}</span>`;
    });
    for (const [id, o] of this.trucks) {
      if (seen.has(id)) continue;
      this.scene.remove(o.group);
      this.trucks.delete(id);
    }
    this.picks.push(...[...this.trucks.values()].map((o) => o.group));
  }

  // ---------- animation ----------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + dt * 0.5);
      const e = 1 - Math.pow(1 - this.intro, 3);
      const start = this.camEnd.clone().multiplyScalar(1.25).setY(this.camEnd.y * 1.3);
      this.camera.position.lerpVectors(start, this.camEnd, e);
    }
    for (const o of this.trucks.values()) this.animateTruck(o, dt, t);
    if (this.ring.visible) {
      const s = 1 + Math.sin(t * 3) * 0.06;
      this.ring.scale.set(this.ring.userData.r * s, this.ring.userData.r * s, 1);
      const tr = this.selected?.kind === "truck" ? this.trucks.get(this.selected.id) : undefined;
      if (tr) this.ring.position.set(tr.group.position.x, 0.03, tr.group.position.z);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  private animateTruck(o: TruckObj, dt: number, t: number) {
    const g = o.group;
    if (o.path.length > 1 && o.seg < o.path.length - 1) {
      const a = g.position, b = o.path[o.seg + 1];
      const d = b.clone().sub(a);
      const len = d.length();
      const step = SPEED * dt * Math.min(1, 0.35 + len); // ease in near corners
      if (len <= step) { g.position.copy(b); o.seg++; }
      else {
        g.position.add(d.multiplyScalar(step / len));
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        let diff = ang - g.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        g.rotation.y += diff * Math.min(1, dt * 8); // smooth steering
        for (const w of o.wheels) w.rotation.x += step * 3.2;
        g.position.y = Math.abs(Math.sin(t * 22)) * 0.012; // road rumble
      }
      if (o.seg >= o.path.length - 1) o.path = [];
      return;
    }
    // Parked: idle engine shake when out on delivery, otherwise still and facing the yard
    g.position.y = o.data.status === "out" ? Math.abs(Math.sin((t + o.idle) * 30)) * 0.006 : 0;
    if (o.key === "home") {
      let diff = Math.PI - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 3);
    }
  }

  // ---------- picking ----------

  private down = { x: 0, y: 0 };
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) return; // was a drag
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.picks, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.pick) o = o.parent;
    this.select((o?.userData.pick as Pick | undefined) ?? null);
    this.onPick(this.selected);
  };

  select(p: Pick | null) {
    this.selected = p;
    this.placeRing();
  }

  private placeRing() {
    const p = this.selected;
    if (!p) { this.ring.visible = false; return; }
    let pos: THREE.Vector3 | undefined, r = 1.4;
    if (p.kind === "warehouse") { pos = new THREE.Vector3(0, 0, 0.4); r = 6.6; }
    if (p.kind === "plant") { const g = this.picks.find((x) => (x.userData.pick as Pick).kind === "plant"); pos = (g?.children[1] as THREE.Object3D | undefined)?.position; r = 3.2; }
    if (p.kind === "area") { pos = this.areaPos.get(p.id); r = 2.4; }
    if (p.kind === "truck") { pos = this.trucks.get(p.id)?.group.position; r = 1.1; }
    if (!pos) { this.ring.visible = false; return; }
    this.ring.visible = true;
    this.ring.userData.r = r;
    this.ring.position.set(pos.x, 0.03, pos.z);
  }

  focus(p: Pick) {
    const tr = p.kind === "truck" ? this.trucks.get(p.id)?.group.position : p.kind === "area" ? this.areaPos.get(p.id) : undefined;
    if (tr) this.controls.target.lerp(new THREE.Vector3(tr.x, 0, tr.z), 0.6);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.host.classList.toggle("viz-compact", w < 640);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onUp);
    this.renderer.dispose();
    this.host.replaceChildren();
  }
}
