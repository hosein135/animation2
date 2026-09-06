/** Procedural object factories (JS port of factories.py). */

import { mulberry32, v3 } from "./math.js";
import * as P from "./prims.js";

function mat(materials, name) {
  if (!materials[name]) throw new Error(`Factory material not found: ${name}`);
  return materials[name];
}

function parent(obj, parentNode) {
  if (parentNode != null) P.parentTo(obj, parentNode);
  return obj;
}

export function bicycle_wheel(params, materials, parentNode = null) {
  const label = params.label || "Wheel";
  const c = v3(params.center);
  const major = Number(params.tire_major ?? 0.91);
  const minor = Number(params.tire_minor ?? 0.095);
  const rimMajor = Number(params.rim_major ?? 0.82);
  const spokeCount = Number(params.spokes ?? 28);
  const spokeLen = Number(params.spoke_length ?? 0.81);

  const tire = P.torus(`${label} tire`, c, major, minor, mat(materials, "Graphite rubber"));
  const rim = P.torus(
    `${label} silver rim`,
    c,
    rimMajor,
    Number(params.rim_minor ?? 0.035),
    mat(materials, "Brushed aluminum"),
  );
  const hub = P.rod(
    `${label} hub`,
    [c[0], -0.15, c[2]],
    [c[0], 0.15, c[2]],
    0.1,
    mat(materials, "Brushed aluminum"),
  );
  const wheelGroup = P.empty(`${label}Wheel`, c);
  for (const part of [tire, rim, hub]) {
    // Offset parts into wheel-local space
    if (part.type === "torus" || part.type === "sphere" || part.type === "box") {
      part.location = [part.location[0] - c[0], part.location[1] - c[1], part.location[2] - c[2]];
    } else if (part.type === "rod") {
      part.from = [part.from[0] - c[0], part.from[1] - c[1], part.from[2] - c[2]];
      part.to = [part.to[0] - c[0], part.to[1] - c[1], part.to[2] - c[2]];
    }
    P.parentTo(part, wheelGroup);
  }

  const chrome = mat(materials, "Brushed aluminum");
  for (let i = 0; i < spokeCount; i++) {
    const t = (i * Math.PI * 2) / spokeCount;
    const sp = P.rod(
      `${label} spoke`,
      [0, i % 2 ? -0.035 : 0.035, 0],
      [spokeLen * Math.cos(t), 0, spokeLen * Math.sin(t)],
      0.009,
      chrome,
    );
    P.parentTo(sp, wheelGroup);
  }

  const mgR = Number(params.mudguard_radius ?? major + minor + 0.06);
  const pts = [];
  for (let i = 0; i < 19; i++) {
    const ang = ((24 + (i * 132) / 18) * Math.PI) / 180;
    pts.push([c[0] + mgR * Math.cos(ang), 0, c[2] + mgR * Math.sin(ang)]);
  }
  const mg = P.path(`${label} curved mudguard`, pts, 0.055, mat(materials, "Butter yellow"));
  if (parentNode != null) {
    P.parentTo(mg, parentNode);
    P.parentTo(wheelGroup, parentNode);
  }
  return wheelGroup;
}

export function pelican_pouch(params, materials, parentNode = null) {
  const verts = [];
  const faces = [];
  const nr = Number(params.nr ?? 28);
  const ns = Number(params.ns ?? 40);
  for (let i = 0; i <= nr; i++) {
    const t = i / nr;
    const x = 0.55 + 1.45 * t;
    const width = 0.235 * (1 - t) ** 0.65 + 0.008;
    const depth = 0.4 * Math.sin(Math.PI * t) ** 0.75 + 0.015;
    for (let j = 0; j < ns; j++) {
      const a = (Math.PI * 2 * j) / ns;
      verts.push([x, width * Math.cos(a), 4.32 - 0.055 * t - (depth * (Math.sin(a) + 1)) / 2]);
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < ns; j++) {
      const a = i * ns + j;
      const b = i * ns + ((j + 1) % ns);
      faces.push([a, b, b + ns, a + ns]);
    }
  }
  const o = P.mesh("Sculpted soft pelican pouch", verts, faces, mat(materials, "Soft amber throat pouch"), 0);
  return parent(o, parentNode);
}

export function pelican_bill(params, materials, parentNode = null) {
  const verts = [];
  const faces = [];
  for (let i = 0; i < 31; i++) {
    const t = i / 30;
    for (let j = 0; j < 24; j++) {
      const a = (j * Math.PI * 2) / 24;
      verts.push([
        0.55 + 1.45 * t,
        (0.235 * (1 - t) ** 0.7 + 0.003) * Math.cos(a),
        4.345 - 0.06 * t + 0.05 * (1 - t) * Math.sin(a),
      ]);
    }
  }
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 24; j++) {
      const a = i * 24 + j;
      const b = i * 24 + ((j + 1) % 24);
      faces.push([a, b, b + 24, a + 24]);
    }
  }
  const o = P.mesh("Elegant tapered upper bill", verts, faces, mat(materials, "Golden orange bill"), 0);
  return parent(o, parentNode);
}

export function woven_basket(params, materials, parentNode = null) {
  const [cx, cy, cz] = params.center || [1.64, 0.13, 2.43];
  const wicker = mat(materials, "Honey wicker");
  const leaf = mat(materials, "Emerald palm leaves");
  const gold = mat(materials, "Sunshine");
  const white = mat(materials, "Warm ivory plumage");
  const coral = mat(materials, "Festival coral");
  const root = P.empty(params.name || "FlowerBasket", [cx, cy, cz]);
  if (parentNode != null) P.parentTo(root, parentNode);

  for (let k = 0; k < 10; k++) {
    const z = -0.32 + k * 0.055;
    const rx = 0.28 + k * 0.008;
    const ry = 0.23 + k * 0.006;
    const pts = [];
    for (let j = 0; j <= 40; j++) {
      const a = (j * Math.PI * 2) / 40;
      pts.push([rx * Math.cos(a), ry * Math.sin(a), z]);
    }
    const o = P.path("Woven basket horizontal", pts, 0.018, wicker);
    P.parentTo(o, root);
  }
  for (let j = 0; j < 24; j++) {
    const a = (j * Math.PI * 2) / 24;
    const o = P.rod(
      "Woven basket upright",
      [0.28 * Math.cos(a), 0.23 * Math.sin(a), -0.33],
      [0.36 * Math.cos(a), 0.29 * Math.sin(a), 0.19],
      0.013,
      wicker,
    );
    P.parentTo(o, root);
  }

  const rng = mulberry32(Number(params.seed ?? 14));
  for (let i = 0; i < 7; i++) {
    const fx = rng() * 0.5 - 0.25;
    const fy = rng() * 0.4 - 0.2;
    const fz = 0.35 + rng() * 0.3;
    const stalk = P.rod("Flower stalk", [0, 0, -0.05], [fx, fy, fz], 0.012, leaf);
    P.parentTo(stalk, root);
    const center = P.ell("Daisy center", [fx, fy - 0.025, fz], [0.06, 0.032, 0.06], gold);
    P.parentTo(center, root);
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI * 2) / 8;
      const petal = P.ell(
        "Daisy petal",
        [fx + 0.1 * Math.cos(a), fy, fz + 0.1 * Math.sin(a)],
        [0.075, 0.025, 0.035],
        i % 2 ? white : coral,
      );
      petal.rotation = [0, -a, 0];
      P.parentTo(petal, root);
    }
  }
  return root;
}

export function boardwalk_planks(params, materials, parentNode = null) {
  const count = Number(params.count ?? 60);
  if (!materials["Sunlit peach timber"]) {
    materials["Sunlit peach timber"] = P.woodPlankMaterial();
  }
  const planks = materials["Sunlit peach timber"];
  const root = P.empty(params.name || "Boardwalk", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  for (let i = 0; i < count; i++) {
    const y = -12 + i * 0.26;
    const o = P.box("Individual boardwalk plank", [0, y, -0.045], [32, 0.25, 0.08], planks, 0.01);
    P.parentTo(o, root);
  }
  return root;
}

export function horizon_sky(params, materials, parentNode = null, ctx = null) {
  const cam = ctx?.camera;
  const camLoc = cam?.location || [5.6, -21, 6.3];
  const forward = (() => {
    const f = [-camLoc[0], -camLoc[1], 0];
    const L = Math.hypot(f[0], f[1]) || 1;
    return [f[0] / L, f[1] / L, 0];
  })();
  const right = [forward[1], -forward[0], 0];
  const dist = Number(params.distance ?? 20);
  const center = [forward[0] * dist, forward[1] * dist, 0];
  if (!materials["Sunset sky gradient"]) {
    materials["Sunset sky gradient"] = P.sunsetSkyMaterial();
  }
  const skyMat = materials["Sunset sky gradient"];
  const verts = [
    [center[0] - right[0] * 80, center[1] - right[1] * 80, 0],
    [center[0] + right[0] * 80, center[1] + right[1] * 80, 0],
    [center[0] + right[0] * 80, center[1] + right[1] * 80, 16],
    [center[0] - right[0] * 80, center[1] - right[1] * 80, 16],
  ];
  const o = P.mesh("Horizon sky", verts, [[0, 1, 2, 3]], skyMat, 0);
  const sunEmpty = P.empty("SkySunAnchor", [
    center[0] - forward[0] * 0.15 + right[0] * 2.65,
    center[1] - forward[1] * 0.15 + right[1] * 2.65,
    2.2,
  ]);
  if (parentNode != null) {
    P.parentTo(o, parentNode);
    P.parentTo(sunEmpty, parentNode);
  }
  if (ctx) ctx.objects[sunEmpty.name] = sunEmpty;
  return o;
}

export function golden_sun(params, materials, parentNode = null, ctx = null) {
  const anchor = ctx?.objects?.SkySunAnchor;
  const loc = params.location
    ? v3(params.location)
    : anchor
      ? [...anchor.location]
      : [0, 20, 2.2];
  if (!materials["Glowing apricot sun"]) {
    materials["Glowing apricot sun"] = {
      name: "Glowing apricot sun",
      color: [1, 0.63, 0.2],
      metallic: 0,
      roughness: 0.4,
      emission: { color: [1, 0.44, 0.12], strength: 1.5 },
    };
  }
  const o = P.ell("Low golden sun", loc, [0.76, 0.76, 0.76], materials["Glowing apricot sun"]);
  return parent(o, parentNode);
}

export function rolling_waves(params, materials, parentNode = null) {
  const foam = mat(materials, "Seafoam");
  const white = mat(materials, "Warm ivory plumage");
  const root = P.empty(params.name || "Waves", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  for (let i = 0; i < 8; i++) {
    const y = 11.7 + i * 0.8;
    const pts = [];
    for (let k = -75; k <= 75; k++) {
      const x = k * 0.2;
      pts.push([x, y + 0.12 * Math.sin(x * 1.7 + i), 0.03 + 0.03 * Math.sin(x * 0.8 + i) ** 2]);
    }
    const o = P.path("Rolling wave crest", pts, i < 3 ? 0.028 : 0.013, foam);
    P.parentTo(o, root);
  }
  for (let i = 0; i < 3; i++) {
    const y = 11.5 + i * 0.18;
    const pts = [];
    for (let k = -65; k <= 65; k++) {
      const x = k * 0.22;
      pts.push([x, y + 0.18 * Math.sin(x * 0.9), 0.021]);
    }
    const o = P.path("Lapping shore foam", pts, 0.018, white);
    P.parentTo(o, root);
  }
  return root;
}

export function sunset_clouds(params, materials, parentNode = null) {
  if (!materials["Luminous peach clouds"]) {
    materials["Luminous peach clouds"] = {
      name: "Luminous peach clouds",
      color: [0.98, 0.82, 0.66],
      metallic: 0,
      roughness: 0.5,
      emission: { color: [1, 0.79, 0.62], strength: 0.45 },
    };
  }
  const cloudmat = materials["Luminous peach clouds"];
  const root = P.empty(params.name || "Clouds", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  const centers = params.centers || [
    [-4, 18, 2.7],
    [-1.5, 18, 3.4],
    [4.9, 18, 2.6],
  ];
  for (const [x, y, z] of centers) {
    for (let j = 0; j < 5; j++) {
      const o = P.ell(
        "Soft sunset cloud",
        [x + j * 0.28, y, z + 0.12 * Math.sin(j)],
        [0.39, 0.15, 0.14 + 0.08 * Math.sin(j)],
        cloudmat,
      );
      P.parentTo(o, root);
    }
  }
  return root;
}

export function palm_tree(params, materials, parentNode = null) {
  const x = params.x;
  const y = params.y;
  const h = params.height;
  const wood = mat(materials, "Palm trunks");
  const leaf = mat(materials, "Emerald palm leaves");
  const top = [x - 0.3, y, h];
  const root = P.empty(params.name || "Palm", [x, y, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  const trunk = P.path(
    "Leaning palm",
    [
      [0, 0, 0],
      [0.08, 0, h * 0.45],
      [top[0] - x, top[1] - y, top[2]],
    ],
    0.1,
    wood,
  );
  P.parentTo(trunk, root);
  for (let j = 0; j < 8; j++) {
    const a = (j * Math.PI * 2) / 8;
    const d = [Math.cos(a), Math.sin(a), 0];
    const side = [-Math.sin(a), Math.cos(a), 0];
    const localTop = [top[0] - x, top[1] - y, top[2]];
    const palmpt = (t) => [
      localTop[0] + d[0] * 1.6 * t,
      localTop[1] + d[1] * 1.6 * t,
      localTop[2] + 0.45 * Math.sin(Math.PI * t) - 0.48 * t,
    ];
    const rib = P.path(
      "Frond rib",
      Array.from({ length: 11 }, (_, k) => palmpt(k / 10)),
      0.013,
      leaf,
    );
    P.parentTo(rib, root);
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const v = palmpt(t);
      const w = 0.26 * Math.sin(Math.PI * t) ** 0.6;
      for (const sign of [-1, 1]) {
        const leaflet = P.mesh(
          "Palm leaflet",
          [
            [v[0] - d[0] * 0.07, v[1] - d[1] * 0.07, v[2]],
            [
              v[0] + side[0] * w * sign - d[0] * 0.13,
              v[1] + side[1] * w * sign - d[1] * 0.13,
              v[2] - 0.08,
            ],
            [v[0] + d[0] * 0.12, v[1] + d[1] * 0.12, v[2]],
          ],
          [[0, 1, 2]],
          leaf,
          0.007,
        );
        P.parentTo(leaflet, root);
      }
    }
  }
  return root;
}

export function festival_flags(params, materials, parentNode = null) {
  const wood = mat(materials, "Palm trunks");
  const paletteNames = params.palette || [
    "Festival coral",
    "Butter yellow",
    "Turquoise enamel",
    "Lavender",
    "Lime",
    "Golden orange bill",
  ];
  const palette = paletteNames.map((n) => mat(materials, n));
  const root = P.empty(params.name || "FestivalFlags", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  const string = P.path(
    "High festival string",
    [
      [-5, 2, 6.15],
      [-2.5, 2, 5.65],
      [0, 2, 5.58],
      [2.5, 2, 5.78],
      [5, 2, 6.2],
    ],
    0.012,
    wood,
  );
  P.parentTo(string, root);
  for (let i = 0; i < 20; i++) {
    const x = -4.75 + i * 0.5;
    const z = 5.58 + 0.62 * (x / 5) ** 2;
    const flag = P.mesh(
      "Fabric festival flag",
      [
        [x - 0.17, 2, z],
        [x + 0.17, 2, z],
        [x + 0.05, 1.95, z - 0.31],
      ],
      [[0, 1, 2]],
      palette[i % 6],
      0.008,
    );
    P.parentTo(flag, root);
  }
  return root;
}

export function confetti(params, materials, parentNode = null) {
  const paletteNames = params.palette || [
    "Festival coral",
    "Butter yellow",
    "Turquoise enamel",
    "Lavender",
    "Lime",
    "Golden orange bill",
  ];
  const palette = paletteNames.map((n) => mat(materials, n));
  const rng = mulberry32(Number(params.seed ?? 14));
  const root = P.empty(params.name || "Confetti", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  for (let i = 0; i < Number(params.count ?? 30); i++) {
    const x = rng() * 8 - 4;
    const y = rng() * 4.8 - 2.5;
    const o = P.box("Celebration confetti", [x, y, 0.012], [0.055, 0.1, 0.012], palette[Math.floor(rng() * palette.length)], 0.005);
    o.rotation = [0, 0, rng() * 6];
    P.parentTo(o, root);
  }
  return root;
}

export function seashells(params, materials, parentNode = null) {
  const white = mat(materials, "Warm ivory plumage");
  const root = P.empty(params.name || "Seashells", [0, 0, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  const centers = params.centers || [
    [3, 3.5],
    [2.7, 4],
    [-2.5, 3.7],
  ];
  for (const [x, y] of centers) {
    for (let i = 0; i < 6; i++) {
      const a = i * 0.23;
      const o = P.ell(
        "Scalloped seashell",
        [x + 0.06 * Math.cos(a), y + 0.06 * Math.sin(a), 0.035],
        [0.12, 0.035, 0.025],
        white,
      );
      o.rotation = [0, 0, a];
      P.parentTo(o, root);
    }
  }
  return root;
}

export function beach_cabin(params, materials, parentNode = null) {
  const x = params.x;
  const y = params.y;
  const col = mat(materials, params.color);
  const white = mat(materials, "Warm ivory plumage");
  const dark = mat(materials, "Deep teal leather");
  const root = P.empty(params.name || "BeachCabin", [x, y, 0]);
  if (parentNode != null) P.parentTo(root, parentNode);
  const body = P.box("Painted beach cabin", [0, 0, 0.66], [1.13, 1.1, 1.32], col);
  P.parentTo(body, root);
  for (const dx of [-0.48, -0.32, -0.16, 0, 0.16, 0.32, 0.48]) {
    const b = P.box("Cabin wood batten", [dx, -0.558, 0.7], [0.023, 0.025, 1.2], white, 0.005);
    P.parentTo(b, root);
  }
  const door = P.box("Cabin door", [0.17, -0.59, 0.55], [0.4, 0.05, 1.05], white);
  P.parentTo(door, root);
  const inset = P.box("Door inset", [0.17, -0.624, 0.62], [0.29, 0.025, 0.72], col);
  P.parentTo(inset, root);
  const roof = P.mesh(
    "Cabin roof",
    [
      [-0.7, -0.66, 1.32],
      [0.7, -0.66, 1.32],
      [0, -0.66, 1.91],
      [-0.7, 0.66, 1.32],
      [0.7, 0.66, 1.32],
      [0, 0.66, 1.91],
    ],
    [
      [0, 2, 5, 3],
      [2, 1, 4, 5],
      [0, 1, 2],
    ],
    dark,
    0.035,
  );
  P.parentTo(roof, root);
  const step = P.box("Cabin step", [0, -0.75, 0.07], [1.13, 0.38, 0.14], white);
  P.parentTo(step, root);
  return root;
}

export const FACTORY_REGISTRY = {
  bicycle_wheel,
  pelican_pouch,
  pelican_bill,
  woven_basket,
  boardwalk_planks,
  horizon_sky,
  golden_sun,
  rolling_waves,
  sunset_clouds,
  palm_tree,
  festival_flags,
  confetti,
  seashells,
  beach_cabin,
};

export function knownFactories() {
  return new Set(Object.keys(FACTORY_REGISTRY));
}

export function runFactory(name, params, materials, parentNode = null, ctx = null) {
  const fn = FACTORY_REGISTRY[name];
  if (!fn) throw new Error(`Unknown factory: ${name}`);
  if (name === "horizon_sky" || name === "golden_sun") {
    return fn(params || {}, materials, parentNode, ctx);
  }
  return fn(params || {}, materials, parentNode);
}
