(function (G) {
  'use strict';

  // Mapas de los enfrentamientos (inspirados en los de los vídeos de referencia, con diseño propio).
  // Cada mapa se describe una vez con primitivas en coordenadas del mundo (suelo, muros, edificios,
  // contenedores, muebles, vehículos, árboles, hierba alta, charcos) y World los aplica chunk a chunk.
  // Los mapas no dependen del modo: cualquier enfrentamiento (asalto o caza) puede tocar en cualquiera.
  //
  // Contenedores de carga: ocupan casillas enteras (2 de ancho, 6 o 12 de largo). Sus costados son aristas
  // CONT (tapan la vista y el paso como una pared) y su techo es transitable (deck): se puede trepar a uno
  // de una altura y, desde arriba, a los de encima. Los abiertos se pueden recorrer por dentro.

  const U = G.Util;
  const MAPS = {};
  const LEVEL_H = 2.6;           // alto de un contenedor

  // ---------- Constructor de primitivas ----------
  function maker() {
    const P = { ground: [], edges: [], blds: [], furn: [], conts: [], obj: [], tall: [], occ: new Map() };
    const key = (x, z) => x + ',' + z;
    const occ = (x0, z0, x1, z1, v) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) P.occ.set(key(x, z), v || 1); };
    const free = (x0, z0, x1, z1) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (P.occ.has(key(x, z))) return false; return true; };
    // lo sólido ya puesto (muebles, vehículos, contenedores) y los troncos de los árboles: así nada se pisa
    const solids = [], trunks = [];
    const overlaps = (a) => solids.some((b) => a.x0 < b.x1 - 0.03 && a.x1 > b.x0 + 0.03 && a.z0 < b.z1 - 0.03 && a.z1 > b.z0 + 0.03) ||
      trunks.some(([tx, tz]) => tx > a.x0 - 0.4 && tx < a.x1 + 0.4 && tz > a.z0 - 0.4 && tz < a.z1 + 0.4);
    const api = {
      P, occ, free,
      ground(x0, z0, x1, z1, g) { P.ground.push([x0, z0, x1, z1, g]); },
      // muro a lo largo de x en la línea z (casillas x0..x1-1) o a lo largo de z en la línea x
      wallN(x0, x1, z, e) { for (let x = x0; x < x1; x++) P.edges.push(['N', x, z, e]); },
      wallW(z0, z1, x, e) { for (let z = z0; z < z1; z++) P.edges.push(['W', x, z, e]); },
      edge(o, x, z, e) { P.edges.push([o, x, z, e]); },
      building(id, ox, oz, w, h, front, post) { P.blds.push({ id, ox, oz, front, post }); occ(ox - 1, oz - 1, ox + w + 1, oz + h + 1, 'b'); },
      // mueble centrado en (x, z), con el frente hacia (fx, fz); ex: más campos (col, open...)
      put(type, x, z, fx, fz, ex) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        const f = Object.assign({ type, lv: 0, x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, y: 0, h: t.h, fx, fz, solid: !t.deco, cont: null }, ex || {});
        // si pisa algo que ya está, se corre un poco hacia un lado libre (y si no cabe en ningún sitio cerca, no se pone)
        if (!t.deco && !t.flat && overlaps(f)) {
          let ok = false;
          for (const d of [0.3, 0.55, 0.8, 1.1, 1.5, 2.0]) {
            for (let k = 0; k < 8 && !ok; k++) {
              const a = k * Math.PI / 4, dx = Math.round(Math.sin(a) * d * 100) / 100, dz = Math.round(Math.cos(a) * d * 100) / 100;
              const g = { x0: f.x0 + dx, x1: f.x1 + dx, z0: f.z0 + dz, z1: f.z1 + dz };
              if (!overlaps(g)) { Object.assign(f, g); ok = true; }
            }
            if (ok) break;
          }
          if (!ok) return null;
        }
        if (!t.deco && !t.flat) solids.push({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
        P.furn.push(f);
        if (!t.flat) occ(Math.floor(f.x0), Math.floor(f.z0), Math.ceil(f.x1), Math.ceil(f.z1), 'f');
        return f;
      },
      // ¿cabe un mueble ahí (con un margen libre alrededor)?
      fits(type, x, z, fx, fz, m) {
        const t = G.Furniture.T[type], along = Math.abs(fz) > 0.5;
        const hw = (along ? t.w : t.d) / 2, hd = (along ? t.d : t.w) / 2;
        m = m == null ? 1 : m;
        return free(Math.floor(x - hw) - m, Math.floor(z - hd) - m, Math.ceil(x + hw) + m, Math.ceil(z + hd) + m);
      },
      // contenedor: esquina (x, z) de su planta, eje 'x' o 'z', largo 6 o 12, pisos apilados (1 a 3)
      // o: { open: true (solo de un piso: puertas abiertas en el extremo final), cols: [colores por piso] }
      cont(x, z, axis, len, levels, o) {
        o = o || {};
        const w = axis === 'x' ? len : 2, d = axis === 'x' ? 2 : len;
        P.conts.push({ x, z, axis, len, levels: o.open ? 1 : levels, open: o.open || false, cols: o.cols || null, w, d, lod: o.lod || 0 });
        solids.push({ x0: x, x1: x + w, z0: z, z1: z + d });
        occ(x, z, x + w, z + d, 'c');
      },
      tree(x, z, pine) {
        // (no encima de un mueble)
        if (solids.some((b) => x + 0.5 > b.x0 - 0.35 && x + 0.5 < b.x1 + 0.35 && z + 0.5 > b.z0 - 0.35 && z + 0.5 < b.z1 + 0.35)) return;
        P.obj.push([x, z, pine ? 2 : 1]); occ(x, z, x + 1, z + 1, 't'); trunks.push([x + 0.5, z + 0.5]);
      },
      bush(x, z) { P.obj.push([x, z, 4]); },
      pole(x, z) { P.obj.push([x, z, 3]); occ(x, z, x + 1, z + 1, 't'); trunks.push([x + 0.5, z + 0.5]); },
      tall(x0, z0, x1, z1) { P.tall.push(['r', x0, z0, x1, z1]); },
      tallCircle(x, z, r) { P.tall.push(['c', x, z, r]); },
      puddle(x, z, w, d) { P.furn.push({ type: 'charco', lv: 0, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: 0, h: 0.01, fx: 0, fz: 1, solid: false, cont: null }); }
    };
    return api;
  }

  // Porches y terrazas al aire (abiertos abajo, con barandilla arriba) y dos salidas como mínimo en cada
  // habitación: si le falta, se abre un hueco en una pared (hacia fuera en la planta baja, si no hacia otra
  // habitación). Así nunca te quedas encerrada
  function fixBuilding(c, bb, li, E, inC) {
    const bi = c.buildings.indexOf(bb) + 1, bp = bb.bp, floors = bb.floors || 1;
    for (const r of bb.rooms) if (r.type === 'terraza' || r.type === 'ruina') { r.on = false; r.noLamp = true; }
    const passable = (e, lv, out) => e === E.NONE || e === E.ARCH || e === E.DOOR || e === E.DOOR_OPEN || e === E.DOOR_BROKEN || e === E.GATE ||
      (!lv && out && (e === E.WIN || e === E.WIN_OPEN || e === E.WIN_BROKEN));
    for (let lv = 0; lv < floors; lv++) {
      const L = lv ? c.up : c;
      if (!L) continue;
      const base = bp.rooms.length;
      const typeOf = (r) => (lv ? bp.up.rooms[r - 1 - base] : bp.rooms[r - 1]) || { type: '' };
      const roomAt = (x, z) => (inC(x, z) && L.bld[li(x, z)] === bi ? L.rm[li(x, z)] : 0);
      const stair = (x, z) => inC(x, z) && c.stairMap && c.stairMap[li(x, z)];
      const sides = (x, z) => [
        { i: li(x, z), arr: L.eN, nx: x, nz: z - 1 }, { i: inC(x, z + 1) ? li(x, z + 1) : -1, arr: L.eN, nx: x, nz: z + 1 },
        { i: li(x, z), arr: L.eW, nx: x - 1, nz: z }, { i: inC(x + 1, z) ? li(x + 1, z) : -1, arr: L.eW, nx: x + 1, nz: z }];
      const rooms = new Map();
      for (let z = bb.z0; z < bb.z0 + bb.h; z++) for (let x = bb.x0; x < bb.x0 + bb.w; x++) {
        const r = roomAt(x, z);
        if (r) { if (!rooms.has(r)) rooms.set(r, []); rooms.get(r).push([x, z]); }
      }
      // porches y terrazas: al aire
      for (const [r, tl] of rooms) {
        const t = typeOf(r).type;
        if (t !== 'porche' && t !== 'terraza') continue;
        for (const [x, z] of tl) for (const sd of sides(x, z)) {
          if (sd.i < 0 || roomAt(sd.nx, sd.nz)) continue;
          sd.arr[sd.i] = lv ? E.RAIL : E.NONE;
        }
      }
      // dos salidas por habitación
      for (const [r, tl] of rooms) {
        if (typeOf(r).type === 'escalera') continue;
        for (let it = 0; it < 4; it++) {
          let n = 0; const nb = new Set(); const cand = [];
          for (const [x, z] of tl) for (const sd of sides(x, z)) {
            if (sd.i < 0) continue;
            const r2 = roomAt(sd.nx, sd.nz);
            if (r2 === r) continue;
            const e = sd.arr[sd.i];
            if (passable(e, lv, !r2)) { n++; nb.add(r2); }
            else if (e === E.WALL && (r2 || !lv) && !stair(x, z) && !stair(sd.nx, sd.nz)) cand.push({ sd, r2, x, z });
          }
          if (n >= 2 && (nb.size >= 2 || (!lv && nb.has(0)))) break;
          if (!cand.length) break;
          const cx = tl.reduce((a, q) => a + q[0], 0) / tl.length, cz = tl.reduce((a, q) => a + q[1], 0) / tl.length;
          const score = (q) => (nb.has(q.r2) ? 10 : 0) + (!lv && q.r2 === 0 ? -2 : 0) + Math.hypot(q.x - cx, q.z - cz) * 0.3;
          cand.sort((a, b) => score(a) - score(b));
          const q = cand[0];
          q.sd.arr[q.sd.i] = E.ARCH;
        }
      }
    }
  }

  function prims(id) {
    const m = MAPS[id];
    if (!m.P) {
      const api = maker();
      m.build(api, U.mulberry32(m.seed || 7));
      m.P = api.P;
    }
    return m.P;
  }

  // ---------- Aplicar a un chunk ----------
  // phase 'base': suelo, muros, edificios, contenedores (aristas y techos), árboles e hierba alta
  // phase 'props': muebles, vehículos y los modelos de los contenedores (después de amueblar los edificios)
  function apply(id, c, cx, cz, rng, W, phase) {
    const P = prims(id), CS = G.World.CS, E = G.World.E;
    const X0 = cx * CS, Z0 = cz * CS;
    const inC = (x, z) => x >= X0 && z >= Z0 && x < X0 + CS && z < Z0 + CS;
    const li = (x, z) => (z - Z0) * CS + (x - X0);
    if (phase === 'base') {
      for (const [x0, z0, x1, z1, g] of P.ground) {
        for (let z = Math.max(z0, Z0); z < Math.min(z1, Z0 + CS); z++) for (let x = Math.max(x0, X0); x < Math.min(x1, X0 + CS); x++) c.ground[li(x, z)] = g;
      }
      // contenedores: costados (aristas) y techos transitables
      for (const k of P.conts) {
        const x1 = k.x + k.w, z1 = k.z + k.d;
        const deckH = k.open ? 0 : Math.round(k.levels * LEVEL_H * 10);
        for (let z = k.z; z < z1; z++) {
          for (let x = k.x; x < x1; x++) {
            if (!inC(x, z)) continue;
            if (deckH) { if (!c.deck) c.deck = new Uint8Array(CS * CS); c.deck[li(x, z)] = Math.max(c.deck[li(x, z)], deckH); }
            else { if (!c.croof) c.croof = new Uint8Array(CS * CS); c.croof[li(x, z)] = Math.round(LEVEL_H * 10); }   // abierto: techo por dentro
            c.tall[li(x, z)] = 0;
          }
        }
        // abierto: las puertas del extremo final (o de los dos extremos: un túnel que se cruza)
        const endA = k.open === 'both', endB = !!k.open;
        for (let x = k.x; x < x1; x++) {
          if (inC(x, k.z) && !(k.axis === 'z' && endA)) c.eN[li(x, k.z)] = E.CONT;
          if (inC(x, z1) && !(k.axis === 'z' && endB)) c.eN[li(x, z1)] = E.CONT;
        }
        for (let z = k.z; z < z1; z++) {
          if (inC(k.x, z) && !(k.axis === 'x' && endA)) c.eW[li(k.x, z)] = E.CONT;
          if (inC(x1, z) && !(k.axis === 'x' && endB)) c.eW[li(x1, z)] = E.CONT;
        }
      }
      for (const [o, x, z, e] of P.edges) {
        if (!inC(x, z)) continue;
        (o === 'N' ? c.eN : c.eW)[li(x, z)] = e;
      }
      for (const b of P.blds) {
        if (!inC(b.ox, b.oz)) continue;
        const bb = W.placeBuilding(b.id, b.ox - X0, b.oz - Z0, b.front);
        // en los mapas no hay puertas: los huecos quedan abiertos. Salvo en el salón recreativo (jefe final): ahí
        // las puertas están (abiertas al empezar), porque el hongomorfo no cabe por ellas
        const keep = !!(bb.bp && bb.bp.def && bb.bp.def.breakable);
        const to = keep ? E.DOOR_OPEN : E.ARCH;
        for (let z = bb.z0; z <= bb.z0 + bb.h; z++) {
          for (let x = bb.x0; x <= bb.x0 + bb.w; x++) {
            if (!inC(x, z)) continue;
            const i = li(x, z);
            if (c.eN[i] === E.DOOR || c.eN[i] === E.DOOR_OPEN || c.eN[i] === E.DOOR_BROKEN) c.eN[i] = to;
            if (c.eW[i] === E.DOOR || c.eW[i] === E.DOOR_OPEN || c.eW[i] === E.DOOR_BROKEN) c.eW[i] = to;
          }
        }
        if (b.post) b.post(c, bb, (x, z) => li(x, z), E);
        if (MAPS[id].escape2) fixBuilding(c, bb, li, E, inC);
        // con relieve: el suelo alrededor, a la altura de la base (una casilla) y una de transición
        if (MAPS[id].height) {
          const R1 = CS + 1;
          for (let z = bb.oz - 2; z <= bb.oz + bb.h + 2; z++) for (let x = bb.ox - 2; x <= bb.ox + bb.w + 2; x++) {
            if (x < 0 || z < 0 || x > CS || z > CS) continue;
            const dd = Math.max(bb.ox - x, x - (bb.ox + bb.w), bb.oz - z, z - (bb.oz + bb.h), 0), i = z * R1 + x;
            if (dd <= 1) c.th[i] = bb.baseY - 0.05; else c.th[i] = (c.th[i] + bb.baseY - 0.05) / 2;
          }
        }
      }
      for (const [x, z, o] of P.obj) if (inC(x, z)) { c.obj[li(x, z)] = o; c.tall[li(x, z)] = 0; }
      for (let z = Z0; z < Z0 + CS; z++) {
        for (let x = X0; x < X0 + CS; x++) {
          const i = li(x, z);
          if (c.bld[i] || c.ground[i] === G.World.F.ROAD) continue;
          if (c.deck && c.deck[i]) continue;
          for (const t of P.tall) {
            const hit = t[0] === 'r' ? (x >= t[1] && z >= t[2] && x < t[3] && z < t[4]) : Math.hypot(x + 0.5 - t[1], z + 0.5 - t[2]) < t[3];
            if (hit) { if (MAPS[id].tallGrass && c.ground[i] !== G.World.F.SIDEWALK) c.tall[i] = 1; break; }   // (solo en los mapas que la piden)
          }
        }
      }
      return;
    }
    // ----- muebles, vehículos y contenedores -----
    for (const f of P.furn) {
      const cxm = (f.x0 + f.x1) / 2, czm = (f.z0 + f.z1) / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      const g = Object.assign({}, f, { seed: Math.floor(rng() * 1e9) });
      if (G.Furniture.T[f.type].vehicle) g.vehicle = true;
      // sobre el relieve del mapa (lo de dentro de un edificio, a la altura de su suelo)
      if (MAPS[id].height) {
        const lx = cxm - X0, lz = czm - Z0, R1 = CS + 1, ix = Math.min(CS - 1, Math.floor(lx)), iz = Math.min(CS - 1, Math.floor(lz)), tx = lx - ix, tz = lz - iz;
        const a = c.th[iz * R1 + ix], b = c.th[iz * R1 + ix + 1], d = c.th[(iz + 1) * R1 + ix], e = c.th[(iz + 1) * R1 + ix + 1];
        const bi = c.bld[li(Math.floor(cxm), Math.floor(czm))];
        g.y = bi ? c.buildings[bi - 1].baseY - 0.04 : (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
        if (f.yOff) g.y += f.yOff;                 // (algo encima de otra cosa: un coche sobre otro)
      }
      c.furn.push(g);
    }
    for (const k of P.conts) {
      const cxm = k.x + k.w / 2, czm = k.z + k.d / 2;
      if (!inC(Math.floor(cxm), Math.floor(czm))) continue;
      for (let l = 0; l < k.levels; l++) {
        const type = k.len >= 12 ? 'cont12' : 'cont6';
        const along = k.axis === 'z';          // el largo va en z: el frente mira a x
        c.furn.push({
          type, lv: 0, x0: k.x + 0.03, x1: k.x + k.w - 0.03, z0: k.z + 0.03, z1: k.z + k.d - 0.03, y: l * LEVEL_H, h: LEVEL_H,
          fx: along ? 1 : 0, fz: along ? 0 : 1, solid: false, cont: null, seed: Math.floor(rng() * 1e9),
          col: k.cols ? k.cols[l % k.cols.length] : undefined, open: l === 0 ? k.open : false, lod: k.lod
        });
      }
    }
  }

  // =====================================================================================================
  // Terminal de carga: un patio de contenedores apilados (de uno a tres de alto) con callejones y algún
  // contenedor abierto que se cruza como un túnel. Un solo interior, grande y alto: la nave del taller al
  // noroeste (donde se empieza), con un taller y un almacén al fondo, sin puertas. Montacargas, camionetas,
  // tanques, palés, lonas, barreras de hormigón, charcos y hierba alta. Valla de alambre con espino y, detrás,
  // pilas altas de contenedores y galpones que tapan la vista (como en el vídeo)
  // =====================================================================================================
  MAPS.terminal = {
    name: 'Terminal de carga', min: 6, max: 46, spawn: { x: 16.5, z: 21.5 }, seed: 4242, fence: 'chain',
    board: { x: 14.2, z: 19.15, fx: 0, fz: 1 },        // modo libre: el panel de los mapas (contra la nave)
    // luz: cielo cubierto, gris azulado, con algo de neblina (como en el vídeo)
    mood: { sky: 0x939ea4, fog: 0.8, hemi: [0xc2cace, 0x4c4a40, 0.74], sun: [0xe6ecee, 0.62],
      ground: { 0: [0x5a6a3c, 0x6e7646], 3: [0x5e5444, 0x6a604c], 1: [0x4a4b4c, 0x535352] } },
    skyline: { col: 0x7d888e, h: [8, 26], cranes: [0.7, 1.1, 4.2], towers: [0.25] },
    build(M, rng) {
      const F = G.World.F;
      // Recinto de 40 x 40 m (más recogido: el combate se mantiene cerca). Una calle principal este-oeste
      // delante de la nave, una calle norte-sur y una transversal al sur; entre ellas, patios de contenedores
      M.ground(0, 0, 64, 64, F.DIRT);
      M.ground(6, 6, 28, 20, F.ROAD);          // explanada de la nave
      M.ground(6, 20, 46, 23, F.ROAD);         // calle principal
      M.ground(28, 6, 32, 46, F.ROAD);         // calle norte-sur
      M.ground(6, 34, 46, 37, F.ROAD);         // calle del sur
      for (const [x0, z0, x1, z1] of [[33, 7, 46, 20], [7, 24, 28, 34], [32, 24, 46, 34], [7, 37, 28, 46], [32, 37, 46, 46]]) M.ground(x0, z0, x1, z1, F.GRASS);

      // la nave del taller: grande (20 x 12) y alta (6 m), con dos portones abiertos al sur, uno al este y huecos
      // sin puertas hacia el taller y el almacén del fondo
      M.building('nave_t', 7, 7, 20, 12, 'S', (c, b, li, E2) => {
        for (const x of [9, 10, 11, 12, 16, 17, 18, 19]) c.eN[li(x, 19)] = E2.GATE;
        for (const z of [9, 10, 11]) c.eW[li(27, z)] = E2.GATE;
        for (const z of [8, 9, 10, 14, 15, 16, 17]) c.eW[li(21, z)] = E2.ARCH;
        for (const x of [23, 24]) c.eN[li(x, 13)] = E2.ARCH;
      });
      M.put('persiana', 13.0, 6.92, 0, -1); M.put('persiana', 21.5, 6.92, 0, -1); M.put('persiana', 6.92, 13.5, -1, 0);

      // ----- vehículos (antes que los contenedores: estos no se les echan encima) -----
      M.put('montacargas', 29.5, 21.5, 1, 0);
      M.put('camioneta', 39.5, 21.5, -1, 0);
      M.put('coche', 30.0, 13.5, 0, 1);
      M.put('montacargas', 30.0, 30.5, 0, 1);
      M.put('camioneta', 30.0, 42.0, 0, -1);
      M.put('montacargas', 21.5, 35.5, 1, 0);
      M.put('coche', 40.0, 35.5, -1, 0);
      // barreras de hormigón y tanques junto al inicio (como en la entrada del vídeo)
      M.put('barrera', 9.0, 22.5, 0, 1); M.put('barrera', 11.2, 22.5, 0, 1);
      M.put('ibc', 23.5, 21.5, 0, 1); M.put('ibc', 24.8, 21.5, 0, 1);

      // ----- patios de contenedores -----
      // Cada contenedor va SUELTO: nunca pegado a otro ni por los costados ni por los extremos (al menos 2 m
      // libres alrededor), así se ve entero y por encima no hay rendijas por las que colarse. Se apilan solo
      // en vertical (de uno a tres de alto). Filas separadas por callejones de 3 m
      const pickLv = () => { const r = rng(); return r < 0.45 ? 1 : (r < 0.85 ? 2 : 3); };
      const fill = (x0, z0, x1, z1, ax) => {
        const across0 = ax === 'x' ? z0 : x0, across1 = ax === 'x' ? z1 : x1;
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1;
        for (let r = across0; r + 2 <= across1; r += 5) {
          let a = along0 + Math.floor(rng() * 2);
          while (a + 6 <= along1) {
            if (rng() < 0.1) { a += 3; continue; }                       // hueco más ancho
            const len = along1 - a >= 12 && rng() < 0.35 ? 12 : 6;
            const op = len === 6 && rng() < 0.15 ? (rng() < 0.5 ? 'both' : true) : false;
            const w = ax === 'x' ? len : 2, d = ax === 'x' ? 2 : len;
            const cx = ax === 'x' ? a : r, cz = ax === 'x' ? r : a;
            // 2 casillas libres alrededor
            if (M.free(cx - 2, cz - 2, cx + w + 2, cz + d + 2)) {
              M.cont(cx, cz, ax, len, op ? 1 : pickLv(), { open: op });
              a += len + 2 + (rng() < 0.3 ? 1 : 0);
            } else a += 1;
          }
        }
      };
      fill(33, 7, 46, 20, 'x');
      fill(7, 24, 28, 34, 'x');
      fill(33, 24, 46, 34, 'z');
      fill(7, 37, 28, 46, 'z');
      fill(33, 37, 46, 46, 'x');

      // ----- fuera de la valla: pilas altas de contenedores y galpones que tapan la vista -----
      // (aquí sí van en fila, pegados: no se puede llegar)
      const ring = (x0, z0, x1, z1, ax, lo, hi) => {
        const along0 = ax === 'x' ? x0 : z0, along1 = ax === 'x' ? x1 : z1, r = ax === 'x' ? z0 : x0;
        for (let a = along0; a + 6 <= along1;) {
          const len = along1 - a >= 12 && rng() < 0.5 ? 12 : 6;
          const lv = lo + Math.floor(rng() * (hi - lo + 1));
          if (ax === 'x') M.cont(a, r, 'x', len, lv, { lod: 1 }); else M.cont(r, a, 'z', len, lv, { lod: 1 });
          a += len;
        }
      };
      ring(0, 1, 33, 3, 'x', 3, 4); ring(4, 3, 33, 5, 'x', 2, 3);
      ring(47, 1, 59, 3, 'x', 3, 4);
      M.put('galpon', 40.0, 2.5, 0, 1);
      ring(4, 47, 48, 49, 'x', 2, 3); ring(0, 49, 56, 51, 'x', 3, 4);
      ring(1, 5, 3, 47, 'z', 3, 4); ring(3, 6, 5, 46, 'z', 2, 3);
      ring(49, 3, 51, 49, 'z', 3, 4); ring(47, 6, 49, 46, 'z', 2, 3);

      // ----- dentro de la nave: palés con cajas y bultos en el centro -----
      M.put('palets', 12.5, 12.5, 1, 0); M.put('lona', 15.0, 12.5, 0, 1); M.put('palets', 17.5, 14.5, 0, 1);
      M.put('bidones', 12.5, 15.5, 1, 0);

      // ----- cosas sueltas por el patio (donde quepan) -----
      const scatter = (type, n, m) => {
        for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
          const x = 8 + Math.floor(rng() * 36) + 0.5, z = 8 + Math.floor(rng() * 36) + 0.5;
          const fx = rng() < 0.5 ? 1 : 0, fz = fx ? 0 : 1;
          if (!M.fits(type, x, z, fx, fz, m)) continue;
          M.put(type, x, z, fx, fz);
          k++;
        }
      };
      M.put('lona', 27.4, 18.0, 1, 0);
      scatter('ibc', 5, 1); scatter('palets', 6, 1); scatter('lona', 5, 1); scatter('barrera', 5, 1);
      scatter('bidones', 4, 1); scatter('tubo', 2, 1); scatter('bloques', 3, 1);
      for (let k = 0, tries = 0; k < 11 && tries < 300; tries++) {
        const x = 8 + rng() * 36, z = 8 + rng() * 36;
        if (!M.free(Math.floor(x - 1.5), Math.floor(z - 1), Math.ceil(x + 1.5), Math.ceil(z + 1))) continue;
        M.puddle(x, z, 2 + rng() * 3, 1.5 + rng() * 2); k++;
      }
      for (let k = 0; k < 22; k++) M.tallCircle(8 + rng() * 36, 8 + rng() * 36, 1.8 + rng() * 3.0);
      for (const [x, z] of [[7, 21], [45, 7], [45, 22], [7, 45], [45, 45], [27, 45], [45, 33], [7, 34]]) if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, true);
      for (const [x, z] of [[28, 7], [32, 9], [32, 23], [32, 38], [27, 24]]) if (M.free(x, z, x + 1, z + 1)) M.pole(x, z);
    }
  };

  // =====================================================================================================
  // Barrio de casas (complejo urbano, 88 x 88: la parte vieja al noroeste y, alrededor, la avenida, la calle del
  // sur con seis casas, la gasolinera y la plaza). Al norte, cuatro casas de dos pisos distintas y amplias, en fila
  // y en alto (un muro de contención las separa de la calle): una con galería de balcones delante y terraza
  // detrás, otra con terraza delante, y otras dos con tejado a dos aguas. Pasillos entre ellas hacen de atajos
  // entre los porches y los patios de atrás. En un patio, un camión aparcado contra la casa: se trepa por la
  // camioneta de al lado y desde el techo del camión se entra por una ventana del piso de arriba. Desde los
  // balcones, terrazas y ventanas de arriba se puede saltar abajo. Todo viejo y abandonado (humedad, desconchones,
  // tablas, enredaderas). Calle con hierba por las grietas. Al otro lado, un edificio desmoronado, un jardín
  // comunitario y un solar abandonado con un montículo de chasqueadores quemados. Rastros de supervivientes,
  // árboles caídos, lomas, arboledas y, fuera de la valla, pinos y edificios que tapan el horizonte. Cada
  // habitación tiene dos salidas como mínimo
  // =====================================================================================================
  const BX = { A: 0x8f9cab, B: 0x9aa78f, C: 0xcfc5a8, D: 0x6f8090 };       // fachadas: gris azulado, verde gris, crema, azul oscuro
  const paint = (sid, roof) => (c, b) => { b.siding = sid; if (roof) b.roofColor = roof; b.worn = true; };
  MAPS.barrio = {
    name: 'Barrio', min: 6, max: 56, spawn: { x: 24.5, z: 29.5 }, seed: 9191, fence: 'wood', tallGrass: true, escape2: true,
    board: { x: 14.0, z: 24.3, fx: 0, fz: 1 },          // modo libre: el panel de los mapas (jardín de la casa A)
    // luz: cielo nublado y húmedo, verde grisáceo (como en el vídeo)
    mood: { sky: 0x9aa59c, fog: 0.75, hemi: [0xc6d0c4, 0x4a5038, 0.76], sun: [0xeef0e2, 0.7],
      ground: { 0: [0x56703a, 0x6a8244], 3: [0x5a5040, 0x665a46], 1: [0x45474a, 0x505255], 2: [0x8a8a84, 0x96958e] } },
    skyline: { col: 0x5f6e5a, h: [7, 14] },
    // desniveles: el lado de las casas, más alto que la calle (con el muro de contención), y lomas suaves al sur
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 501) - 0.5, n2 = V(x / 16, z / 16, 502) - 0.5;
      if (z >= 25.8 && z <= 33.2) return 0;                       // calle y aceras
      if (z < 25.8) return U.clamp((25.8 - z) / 0.45, 0, 1) * (0.55 + n * 0.35 + n2 * 0.45);
      return U.clamp((z - 33.2) / 2.5, 0, 1) * (0.25 + n * 0.8 + n2 * 1.0);
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 64, 64, F.GRASS);
      M.ground(6, 26, 56, 27, F.SIDEWALK);            // acera norte
      M.ground(6, 27, 56, 32, F.ROAD);                // calle
      M.ground(6, 32, 56, 33, F.SIDEWALK);            // acera sur

      // ---- las cuatro casas, más amplias (ninguna cruza el borde de un trozo del mundo, en x = 32) ----
      M.building('bar_a', 7, 11, 10, 11, 'S', paint(BX.A, 0x4e4c48));      // galería de balcones + terraza
      M.building('bar_b', 20, 11, 11, 11, 'S', (c, b, li, E2) => {          // terraza delante
        paint(BX.B, 0x55524c)(c, b);
        // la ventana del pasillo de arriba que da al patio (se entra desde el techo del camión)
        if (c.up) c.up.eN[li(29, 11)] = E2.WIN_OPEN;
      });
      M.building('bar_c', 33, 11, 11, 11, 'S', paint(BX.C, 0x4a3f3a));     // dos aguas, dormitorio delante
      M.building('bar_d', 46, 11, 10, 11, 'S', paint(BX.D, 0x3f4650));     // dos aguas, balcones cubiertos
      // caminos de cemento a la acera (la A y la D tienen porche abierto; la C, un porche de madera)
      for (const dx of [11, 28, 35, 51]) M.ground(dx, 22, dx + 1, 26, F.SIDEWALK);
      M.put('porche', 35.5, 22.9, 0, 1, { x0: 33.9, x1: 37.1, z0: 22.05, z1: 23.75 });
      M.put('poste', 34.02, 23.62, 0, 1); M.put('poste', 36.98, 23.62, 0, 1);
      // muros bajos de contención junto a la acera (el jardín está más alto que la calle), con hueco en cada camino
      for (const [x0, x1] of [[6.2, 10.6], [12.4, 27.6], [29.4, 34.6], [36.4, 50.6], [52.4, 55.8]]) {
        M.put('muro_bajo', (x0 + x1) / 2, 25.75, 0, 1, { x0, x1, z0: 25.6, z1: 25.9, h: 0.8 });
      }

      // ---- atajos entre las casas ----
      M.put('cubos', 18.5, 19.6, 1, 0);                                                      // A-B: cubos
      M.put('valla_rota', 32.0, 16.0, 0, 1, { x0: 31.1, x1: 32.9, z0: 15.9, z1: 16.1 });     // B-C: valla caída
      M.wallN(44, 45, 15, FE);                                                               // C-D: valla con hueco

      // ---- patios de atrás (z 6 a 11), vallas de tablas con huecos ----
      M.wallW(6, 8, 18, FE); M.wallW(9, 11, 18, FE);
      M.wallW(6, 7, 32, FE); M.wallW(8, 11, 32, FE);
      M.wallW(6, 8, 45, FE); M.wallW(9, 11, 45, FE);
      // A: cobertizo y jardineras
      M.put('cobertizo', 8.6, 7.6, 0, 1); M.put('jardinera', 14.6, 7.4, 0, 1); M.put('jardinera', 14.6, 9.8, 0, 1);
      // B: el camión de mudanzas aparcado contra la casa y una camioneta al lado: se trepa a la camioneta, de
      // ahí al techo del camión y desde arriba se entra por la ventana del piso de arriba
      M.put('camion', 28.0, 9.35, 1, 0, { col: 0xd8d4c8 });
      M.put('camioneta', 28.2, 7.05, 1, 0, { col: 0x7a3a2e });
      M.tall(20, 6, 23, 8);
      // C: campamento de supervivientes
      M.put('fogata', 37.6, 8.4, 0, 1); M.put('refugio_lona', 41.6, 8.2, -1, 0); M.put('tablas', 34.6, 7.0, 0, 1);
      M.put('barricada', 39.0, 6.6, 0, 1); M.put('bidones', 43.4, 10.2, 0, 1);
      // D: plataforma de vigilancia, cobertizo y hierba alta
      M.put('tarima', 49.4, 8.4, 0, 1); M.put('cobertizo', 53.8, 7.6, 0, 1); M.put('tablas', 47.0, 7.0, 1, 0);
      M.tall(50, 6, 53, 11);
      for (const [x, z] of [[19, 7], [33, 7]]) M.tree(x, z);

      // ---- jardines de delante ----
      M.tall(19, 23, 23, 25); M.tall(38, 24, 42, 26); M.tall(44, 23, 49, 25);
      M.bush(18, 24); M.bush(45, 23); M.tree(6, 23); M.tree(55, 23);

      // ---- calle: coches, hierba por las grietas, un árbol caído y farolas ----
      M.put('coche', 12.0, 28.4, 1, 0); M.put('camioneta', 37.0, 30.6, -1, 0); M.put('coche', 20.5, 31.0, -1, 0, { col: 0x5a6a7a });
      M.put('arbol_caido', 49.0, 29.4, 1, 0);
      for (let k = 0; k < 16; k++) {
        const x = R(7, 55), z = R(27.3, 31.7), w = R(1.2, 3.4), d = R(0.5, 1.4);
        M.put('cesped', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      }
      for (let k = 0; k < 6; k++) { const x = R(7, 55), z = rng() < 0.5 ? 26.5 : 32.5, w = R(0.8, 2); M.put('cesped', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - 0.4, z1: z + 0.4 }); }
      M.puddle(27, 28.4, 3, 1.5); M.puddle(15, 30.6, 2.4, 1.2);
      for (const [x, z] of [[14, 26], [31, 26], [22, 32], [46, 32]]) M.pole(x, z);

      // ---- al otro lado: el edificio desmoronado (solo la planta baja, sin techo, paredes rotas) ----
      M.building('ruina', 19, 36, 12, 9, 'N', (c, b, li, E2) => {
        b.worn = true;
        // tramos de pared caídos (casillas del plano ya girado: el frente da al norte)
        for (const [o, lx, lz] of [['N', 2, 0], ['N', 3, 0], ['N', 9, 0], ['W', 0, 3], ['W', 0, 6], ['W', 12, 2], ['W', 12, 7], ['N', 5, 9], ['N', 6, 9], ['N', 10, 9]]) {
          const X = b.x0 + lx, Z = b.z0 + lz;
          (o === 'N' ? c.eN : c.eW)[li(X, Z)] = E2.NONE;
        }
      });
      // dentro: cascotes, una losa caída, y el campamento de los supervivientes
      M.put('escombro_grande', 21.6, 38.0, 0, 1); M.put('losa', 27.4, 39.0, 1, 0); M.put('escombro_grande', 29.4, 43.0, 0, 1);
      M.put('fogata', 23.6, 42.4, 0, 1); M.put('tablas', 21.2, 43.4, 0, 1); M.put('barricada', 24.0, 36.6, 0, 1);
      M.put('escombros', 25.0, 41.0, 0, 1, { x0: 24.2, x1: 25.8, z0: 40.4, z1: 41.6 });
      M.put('escombro_grande', 18.0, 39.5, 1, 0);                     // cascotes que cayeron fuera
      M.put('escombro_grande', 32.2, 41.0, 1, 0);
      M.put('cubos', 20.2, 34.2, 0, -1); M.put('muro_bajo', 27.0, 33.75, 0, 1, { x0: 25.0, x1: 29.0, z0: 33.6, z1: 33.9 });
      M.tall(19, 45, 32, 50);
      for (const [x, z] of [[20, 51], [23, 53], [26, 50], [29, 53], [31, 51], [21, 55], [27, 55]]) M.tree(x, z, rng() < 0.4);

      // ---- jardín comunitario (suroeste): jardineras, cobertizo, un coche viejo y una arboleda ----
      for (const [x, z] of [[8.0, 36.4], [11.6, 36.4], [8.0, 39.0], [11.6, 39.0], [15.2, 39.0]]) M.put('jardinera', x, z, 0, 1);
      M.put('muro_bajo', 6.4, 38.0, 1, 0, { x0: 6.25, x1: 6.55, z0: 34.5, z1: 41.5 });
      M.put('cobertizo', 9.0, 47.0, 0, -1); M.put('coche', 16.0, 44.5, 0, 1, { col: 0x6a6e62 });
      M.put('arbol_caido', 12.0, 52.0, 1, 0);
      M.tall(6, 42, 13, 50); M.tall(14, 34, 18, 37);
      for (const [x, z] of [[7, 53], [10, 55], [14, 54], [17, 50], [16, 56], [7, 49]]) M.tree(x, z, rng() < 0.5);
      M.bush(13, 42); M.bush(17, 35);

      // ---- solar abandonado (sureste): campamento con plataforma de vigilancia, coche quemado, árbol caído ----
      M.wallW(34, 38, 33, FE); M.wallW(39, 46, 33, FE); M.wallW(47, 56, 33, FE);
      M.put('cadaveres', 44.2, 46.8, 0, 1);                                  // montículo de chasqueadores quemados
      M.put('tarima', 40.0, 40.0, 0, 1); M.put('fogata', 43.6, 43.0, 0, 1); M.put('refugio_lona', 46.6, 41.4, 0, -1);
      M.put('barricada', 38.0, 44.6, 1, 0); M.put('tablas', 44.6, 38.2, 0, 1); M.put('bidones', 36.4, 37.0, 0, 1);
      M.put('coche', 51.0, 47.5, 1, 0, { col: 0x3a3632 }); M.put('arbol_caido', 39.0, 51.0, 1, 0);
      M.put('palets', 53.4, 37.6, 0, 1); M.put('lona', 35.6, 54.0, 0, 1); M.put('cubos', 34.4, 34.4, 0, 1);
      M.tall(34, 46, 46, 56); M.tall(48, 34, 56, 44);
      for (const [x, z] of [[49, 52], [52, 54], [55, 50], [54, 45], [47, 55], [44, 49], [55, 56]]) M.tree(x, z, rng() < 0.5);
      M.bush(37, 41); M.bush(50, 39);

      // ---- edificios de fuera de la valla (tapan el horizonte en parte del borde; el resto, pinos) ----
      M.put('fachada', 26.0, 2.6, 0, 1, { x0: 12.0, x1: 40.0, z0: 1.0, z1: 4.6, h: 13.5, style: 0 });       // norte, detrás de los patios
      M.put('fachada', 60.0, 22.0, -1, 0, { x0: 58.2, x1: 62.0, z0: 8.0, z1: 36.0, h: 11.0, style: 1 });    // este
      M.put('fachada', 3.0, 46.0, 1, 0, { x0: 1.0, x1: 4.6, z0: 36.0, z1: 58.0, h: 15.0, style: 2 });       // oeste, junto al jardín
      M.put('fachada', 44.0, 60.2, 0, -1, { x0: 34.0, x1: 54.0, z0: 58.2, z1: 62.0, h: 10.5, style: 0 });   // sur
      // ---- anillo de pinos fuera de la valla: tapa el horizonte ----
      for (let a = 0; a < 64; a += 2) {
        for (const off of [1, 3]) {
          const j = Math.floor(rng() * 2);
          for (const [x, z] of [[off + j, a], [62 - off - j, a + 1], [a, off + j], [a + 1, 62 - off - j]]) {
            if (x >= 0 && z >= 0 && x < 64 && z < 64 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.7);
          }
        }
      }
    }
  };
  // Barrio completo (88 x 88): el barrio original y, al este y al sur, la avenida, la calle del sur con sus casas,
  // la gasolinera y la plaza. No sale en los enfrentamientos ni en el modo libre (hidden): se guarda para el modo
  // supervivencia. De aquí sale también el mapa de la estación de servicio (ver MAPS.servicio)
  MAPS.barrio_completo = {
    name: 'Barrio (completo)', hidden: true, min: 4, max: 92, enemyMul: 1.4, spawn: { x: 24.5, z: 29.5 }, seed: 9191, fence: 'wood', tallGrass: true, escape2: true,
    board: { x: 14.0, z: 24.3, fx: 0, fz: 1 },          // modo libre: el panel de los mapas (jardín de la casa A)
    // luz: cielo nublado y húmedo, verde grisáceo (como en el vídeo)
    mood: { sky: 0x9aa59c, fog: 0.75, hemi: [0xc6d0c4, 0x4a5038, 0.76], sun: [0xeef0e2, 0.7],
      ground: { 0: [0x56703a, 0x6a8244], 3: [0x5a5040, 0x665a46], 1: [0x45474a, 0x505255], 2: [0x8a8a84, 0x96958e] } },
    skyline: { col: 0x5f6e5a, h: [7, 14] },
    // desniveles: el lado de las casas, más alto que la calle (con el muro de contención), y lomas suaves al sur
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 501) - 0.5, n2 = V(x / 16, z / 16, 502) - 0.5;
      const C = U.clamp;
      // calles: la principal (z 26 a 33), la avenida (x 58 a 65) y la del sur (z 65 a 72), planas
      const roadD = Math.min(Math.abs(z - 29.5) - 3.7, Math.abs(x - 61.5) - 3.5, Math.abs(z - 68.5) - 3.5);
      if (roadD <= 0) return 0;
      if (z < 25.8 && x < 57) return C((25.8 - z) / 0.45, 0, 1) * (0.55 + n * 0.35 + n2 * 0.45);       // las casas del norte, en alto
      if (z > 72.2) return C((z - 72.2) / 0.45, 0, 1) * (0.5 + n * 0.25 + n2 * 0.35);                // las del sur, también
      const k = C(roadD / 2.5, 0, 1);
      if (x > 65) return k * (0.12 + Math.max(0, n) * 0.2);                                          // gasolinera y plaza: casi llano
      return k * Math.max(0, 0.25 + n * 0.8 + n2 * 1.0);
    },
    build(M, rng) {
      const F = G.World.F, FE = G.World.E.FENCE;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 96, 96, F.GRASS);
      M.ground(4, 26, 56, 27, F.SIDEWALK);            // acera norte
      M.ground(4, 27, 56, 32, F.ROAD);                // calle
      M.ground(4, 32, 56, 33, F.SIDEWALK);            // acera sur

      // ---- las cuatro casas, más amplias (ninguna cruza el borde de un trozo del mundo, en x = 32) ----
      M.building('bar_a', 7, 11, 10, 11, 'S', paint(BX.A, 0x4e4c48));      // galería de balcones + terraza
      M.building('bar_b', 20, 11, 11, 11, 'S', (c, b, li, E2) => {          // terraza delante
        paint(BX.B, 0x55524c)(c, b);
        // la ventana del pasillo de arriba que da al patio (se entra desde el techo del camión)
        if (c.up) c.up.eN[li(29, 11)] = E2.WIN_OPEN;
      });
      M.building('bar_c', 33, 11, 11, 11, 'S', paint(BX.C, 0x4a3f3a));     // dos aguas, dormitorio delante
      M.building('bar_d', 46, 11, 10, 11, 'S', paint(BX.D, 0x3f4650));     // dos aguas, balcones cubiertos
      // caminos de cemento a la acera (la A y la D tienen porche abierto; la C, un porche de madera)
      for (const dx of [11, 28, 35, 51]) M.ground(dx, 22, dx + 1, 26, F.SIDEWALK);
      M.put('porche', 35.5, 22.9, 0, 1, { x0: 33.9, x1: 37.1, z0: 22.05, z1: 23.75 });
      M.put('poste', 34.02, 23.62, 0, 1); M.put('poste', 36.98, 23.62, 0, 1);
      // muros bajos de contención junto a la acera (el jardín está más alto que la calle), con hueco en cada camino
      for (const [x0, x1] of [[6.2, 10.6], [12.4, 27.6], [29.4, 34.6], [36.4, 50.6], [52.4, 55.8]]) {
        M.put('muro_bajo', (x0 + x1) / 2, 25.75, 0, 1, { x0, x1, z0: 25.6, z1: 25.9, h: 0.8 });
      }

      // ---- atajos entre las casas ----
      M.put('cubos', 18.5, 19.6, 1, 0);                                                      // A-B: cubos
      M.put('valla_rota', 32.0, 16.0, 0, 1, { x0: 31.1, x1: 32.9, z0: 15.9, z1: 16.1 });     // B-C: valla caída
      M.wallN(44, 45, 15, FE);                                                               // C-D: valla con hueco

      // ---- patios de atrás (z 6 a 11), vallas de tablas con huecos ----
      M.wallW(6, 8, 18, FE); M.wallW(9, 11, 18, FE);
      M.wallW(6, 7, 32, FE); M.wallW(8, 11, 32, FE);
      M.wallW(6, 8, 45, FE); M.wallW(9, 11, 45, FE);
      // A: cobertizo y jardineras
      M.put('cobertizo', 8.6, 7.6, 0, 1); M.put('jardinera', 14.6, 7.4, 0, 1); M.put('jardinera', 14.6, 9.8, 0, 1);
      // B: el camión de mudanzas aparcado contra la casa y una camioneta al lado: se trepa a la camioneta, de
      // ahí al techo del camión y desde arriba se entra por la ventana del piso de arriba
      M.put('camion', 28.0, 9.35, 1, 0, { col: 0xd8d4c8 });
      M.put('camioneta', 28.2, 7.05, 1, 0, { col: 0x7a3a2e });
      M.tall(20, 6, 23, 8);
      // C: campamento de supervivientes
      M.put('fogata', 37.6, 8.4, 0, 1); M.put('refugio_lona', 41.6, 8.2, -1, 0); M.put('tablas', 34.6, 7.0, 0, 1);
      M.put('barricada', 39.0, 6.6, 0, 1); M.put('bidones', 43.4, 10.2, 0, 1);
      // D: plataforma de vigilancia, cobertizo y hierba alta
      M.put('tarima', 49.4, 8.4, 0, 1); M.put('cobertizo', 53.8, 7.6, 0, 1); M.put('tablas', 47.0, 7.0, 1, 0);
      M.tall(50, 6, 53, 11);
      for (const [x, z] of [[19, 7], [33, 7]]) M.tree(x, z);

      // ---- jardines de delante ----
      M.tall(19, 23, 23, 25); M.tall(38, 24, 42, 26); M.tall(44, 23, 49, 25);
      M.bush(18, 24); M.bush(45, 23); M.tree(6, 23); M.tree(55, 23);

      // ---- calle: coches, hierba por las grietas, un árbol caído y farolas ----
      M.put('coche', 12.0, 28.4, 1, 0); M.put('camioneta', 37.0, 30.6, -1, 0); M.put('coche', 20.5, 31.0, -1, 0, { col: 0x5a6a7a });
      for (let k = 0, t = 0; k < 7 && t < 60; t++) {
        const x = R(7, 55), z = R(27.3, 31.7), w = R(1.2, 3.4), d = R(0.5, 1.4);
        if (!M.free(Math.floor(x - w / 2), Math.floor(z - d / 2), Math.ceil(x + w / 2), Math.ceil(z + d / 2))) continue;    // (no debajo de un coche)
        if ((Math.abs(x - 27) < 3.4 && Math.abs(z - 28.4) < 1.8) || (Math.abs(x - 15) < 2.9 && Math.abs(z - 30.6) < 1.5)) continue;   // (ni sobre los charcos)
        M.put('cesped', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); k++;
      }
      const sw = [];
      for (let k = 0, t = 0; k < 6 && t < 60; t++) {
        const x = R(7, 55), z = rng() < 0.5 ? 26.5 : 32.5, w = R(0.8, 2);
        if (sw.some(([a, b, c]) => b === z && Math.abs(a - x) < (c + w) / 2 + 0.3)) continue;      // (que no se pisen)
        if (!M.free(Math.floor(x - w / 2), Math.floor(z - 0.4), Math.ceil(x + w / 2), Math.ceil(z + 0.4))) continue;
        sw.push([x, z, w]); M.put('cesped', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - 0.4, z1: z + 0.4 }); k++;
      }
      M.puddle(27, 28.4, 3, 1.5); M.puddle(15, 30.6, 2.4, 1.2);
      for (const [x, z] of [[14, 26], [31, 26], [22, 32], [46, 32]]) M.pole(x, z);

      // ---- al otro lado: el edificio desmoronado (solo la planta baja, sin techo, paredes rotas) ----
      M.building('ruina', 19, 36, 12, 9, 'N', (c, b, li, E2) => {
        b.worn = true;
        // tramos de pared caídos (casillas del plano ya girado: el frente da al norte)
        for (const [o, lx, lz] of [['N', 2, 0], ['N', 3, 0], ['N', 9, 0], ['W', 0, 3], ['W', 0, 6], ['W', 12, 2], ['W', 12, 7], ['N', 5, 9], ['N', 6, 9], ['N', 10, 9]]) {
          const X = b.x0 + lx, Z = b.z0 + lz;
          (o === 'N' ? c.eN : c.eW)[li(X, Z)] = E2.NONE;
        }
      });
      // dentro: cascotes, una losa caída, y el campamento de los supervivientes
      M.put('escombro_grande', 21.6, 38.0, 0, 1); M.put('losa', 27.4, 39.0, 1, 0); M.put('escombro_grande', 29.4, 43.0, 0, 1);
      M.put('fogata', 23.6, 42.4, 0, 1); M.put('tablas', 21.2, 43.4, 0, 1); M.put('barricada', 24.0, 36.6, 0, 1);
      M.put('escombros', 25.0, 41.0, 0, 1, { x0: 24.2, x1: 25.8, z0: 40.4, z1: 41.6 });
      M.put('escombro_grande', 18.0, 39.5, 1, 0);                     // cascotes que cayeron fuera
      M.put('escombro_grande', 32.2, 41.0, 1, 0);
      M.put('cubos', 20.2, 34.2, 0, -1); M.put('muro_bajo', 27.0, 33.75, 0, 1, { x0: 25.0, x1: 29.0, z0: 33.6, z1: 33.9 });
      M.tall(19, 45, 32, 50);
      for (const [x, z] of [[20, 51], [23, 53], [26, 50], [29, 53], [31, 51], [21, 55], [27, 55]]) M.tree(x, z, rng() < 0.4);

      // ---- jardín comunitario (suroeste): jardineras, cobertizo, un coche viejo y una arboleda ----
      for (const [x, z] of [[8.0, 36.4], [11.6, 36.4], [8.0, 39.0], [11.6, 39.0], [15.2, 39.0]]) M.put('jardinera', x, z, 0, 1);
      M.put('muro_bajo', 6.4, 38.0, 1, 0, { x0: 6.25, x1: 6.55, z0: 34.5, z1: 41.5 });
      M.put('cobertizo', 9.0, 47.0, 0, -1); M.put('coche', 16.0, 44.5, 0, 1, { col: 0x6a6e62 });
      M.put('arbol_caido', 12.0, 52.0, 1, 0);
      M.tall(6, 42, 13, 50); M.tall(14, 34, 18, 37);
      for (const [x, z] of [[7, 53], [10, 55], [14, 54], [17, 50], [16, 56], [7, 49]]) M.tree(x, z, rng() < 0.5);
      M.bush(13, 42); M.bush(17, 35);

      // ---- solar abandonado (sureste): campamento con plataforma de vigilancia, coche quemado, árbol caído ----
      M.wallW(34, 38, 33, FE); M.wallW(39, 46, 33, FE); M.wallW(47, 56, 33, FE);
      M.put('cadaveres', 44.2, 46.8, 0, 1);                                  // montículo de chasqueadores quemados
      M.put('tarima', 40.0, 40.0, 0, 1); M.put('fogata', 43.6, 43.0, 0, 1); M.put('refugio_lona', 46.6, 41.4, 0, -1);
      M.put('barricada', 38.0, 44.6, 1, 0); M.put('tablas', 44.6, 38.2, 0, 1); M.put('bidones', 36.4, 37.0, 0, 1);
      M.put('coche', 51.0, 47.5, 1, 0, { col: 0x3a3632 }); M.put('arbol_caido', 39.0, 51.0, 1, 0);
      M.put('palets', 53.4, 37.6, 0, 1); M.put('lona', 35.6, 54.0, 0, 1); M.put('cubos', 34.4, 34.4, 0, 1);
      M.tall(34, 46, 46, 56); M.tall(48, 34, 56, 44);
      for (const [x, z] of [[49, 52], [52, 54], [55, 50], [54, 45], [47, 55], [44, 49], [55, 56]]) M.tree(x, z, rng() < 0.5);
      M.bush(37, 41); M.bush(50, 39);

      // ======== AMPLIACIÓN (88 x 88): la avenida, la calle del sur con sus casas, la gasolinera y la plaza ========
      const pal = [0xc9b8a0, 0x9fb0b8, 0xb8a090, 0xa8b49a, 0xd8cfb8, 0x8e9aa8, 0xc8a890];
      const roofs = [0x5a4234, 0x3f4650, 0x4a3f3a, 0x544c46];
      // ---- la avenida (norte-sur) y la calle del sur ----
      M.ground(58, 0, 59, 96, F.SIDEWALK); M.ground(59, 0, 64, 96, F.ROAD); M.ground(64, 0, 65, 96, F.SIDEWALK);
      M.ground(4, 65, 92, 66, F.SIDEWALK); M.ground(4, 66, 92, 71, F.ROAD); M.ground(4, 71, 92, 72, F.SIDEWALK);
      M.ground(56, 26, 92, 27, F.SIDEWALK); M.ground(56, 27, 92, 32, F.ROAD); M.ground(56, 32, 92, 33, F.SIDEWALK);
      M.ground(59, 26, 64, 33, F.ROAD); M.ground(59, 65, 64, 72, F.ROAD);
      // pasos de cebra en los cruces y en las calles
      for (const [x, z, w, d] of [[61.5, 25.3, 5, 1.4], [61.5, 34.0, 5, 1.4], [57.4, 29.5, 1.4, 5], [65.6, 29.5, 1.4, 5], [61.5, 64.2, 5, 1.4], [61.5, 72.8, 5, 1.4], [57.4, 68.5, 1.4, 5], [65.6, 68.5, 1.4, 5], [24.5, 68.5, 1.6, 5]]) {
        const al = w > d; M.put('paso_cebra', x, z, al ? 1 : 0, al ? 0 : 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      }
      // semáforos, señales de stop y bocas de incendio en las esquinas
      for (const [x, z, fx, fz] of [[58.4, 25.6, 0, 1], [64.6, 33.4, 0, -1], [58.4, 64.6, 0, 1], [64.6, 72.4, 0, -1]]) M.put('semaforo', x, z, fx, fz);
      for (const [x, z, fx, fz] of [[64.6, 25.6, -1, 0], [58.4, 33.4, 1, 0], [64.6, 64.6, -1, 0], [58.4, 72.4, 1, 0]]) M.put('senal', x, z, fx, fz);
      for (const [x, z] of [[40.5, 26.4], [58.5, 50.0], [64.5, 12.0], [30.5, 71.6], [80.5, 65.4], [12.5, 65.4]]) M.put('hidrante', x, z, 0, 1);
      // coches aparcados en fila junto a la acera (alguno mal aparcado, un par chocados en el cruce)
      M.put('coche', 59.9, 10.0, 0, 1, { col: 0x5a6a7a }); M.put('coche', 59.9, 16.5, 0, 1, { col: 0x8a3a32 }); M.put('camioneta', 63.2, 44.0, 0, -1, { col: 0x3a4a3a });
      M.put('coche', 63.2, 55.0, 0, -1, { col: 0xb8b0a0 }); M.put('coche', 59.9, 82.0, 0, 1, { col: 0x2e3e5a }); M.put('coche', 63.2, 88.0, 0, -1);
      M.put('coche', 70.0, 27.7, 1, 0, { col: 0x6a5a3a }); M.put('coche', 84.0, 31.3, -1, 0, { col: 0x3a3a3a }); M.put('camioneta', 77.0, 27.7, 1, 0, { col: 0x7a3a2e });
      M.put('coche', 14.0, 66.7, 1, 0, { col: 0x4a5a6a }); M.put('coche', 40.0, 70.3, -1, 0, { col: 0x8a7a5a }); M.put('coche', 75.0, 66.7, 1, 0, { col: 0x5a2a2a });
      M.put('coche', 61.2, 68.6, 0.7, 0.7, { col: 0x9a9a92 }); M.put('coche', 53.4, 66.9, 1, 0, { col: 0x3a4a5a });     // el choque del cruce
      M.put('barrera', 61.5, 6.0, 0, 1); M.put('barrera', 61.5, 90.6, 0, 1); M.put('cubos', 58.6, 40.0, 1, 0);
      // paradas de autobús, papeleras y farolas a lo largo de las aceras
      M.put('parada', 36.0, 64.6, 0, 1); M.put('parada', 72.0, 25.4, 0, 1);
      for (const [x, z] of [[33.0, 64.9], [70.0, 25.6], [58.6, 22.0], [64.4, 58.0], [52.0, 71.4]]) M.put('papelera', x, z, 0, 1);
      for (const z of [10, 20, 40, 50, 80, 88]) { M.pole(58, z); }
      for (const x of [70, 80, 90]) { M.pole(x, 26); M.pole(x - 4, 32); }
      for (const x of [10, 20, 30, 40, 50, 70, 80, 90]) { M.pole(x, 65); M.pole(x - 5, 71); }

      // ---- la calle del sur: seis casas mirando a la calle (jardín delante con su caminito, buzón y seto;
      // patio detrás con valla, cobertizo, huerto, tendedero y algún juego), y la tienda de la esquina ----
      const SH = [['casa2', 6, 11], ['casa5', 20, 10], ['bar_c', 34, 11], ['casa1', 48, 10], ['tienda1', 66, 12], ['casa6', 80, 11]];
      SH.forEach(([id, ox, w], i) => {
        M.building(id, ox, 74, w, id === 'bar_c' ? 11 : 9, 'N', paint(pal[i % pal.length], roofs[i % roofs.length]));
        const cx = ox + w / 2;
        M.ground(Math.floor(cx) - 1, 72, Math.floor(cx) + 1, 74, F.SIDEWALK);                // caminito
        // muro bajo de contención con el hueco del caminito, setos y el buzón
        M.put('muro_bajo', (ox + cx - 1.2) / 2, 72.25, 0, 1, { x0: ox, x1: cx - 1.2, z0: 72.1, z1: 72.4, h: 0.7 });
        M.put('muro_bajo', (cx + 1.2 + ox + w) / 2, 72.25, 0, 1, { x0: cx + 1.2, x1: ox + w, z0: 72.1, z1: 72.4, h: 0.7 });
        if (id !== 'tienda1') {
          M.put('seto', ox + 2.2, 73.1, 0, 1, { x0: ox + 0.4, x1: ox + 4.0, z0: 72.75, z1: 73.45, h: 1.0 });
          M.put('buzon', cx + 1.7, 72.9, 0, 1);
        }
        // patio de atrás (z 86 a 92): valla entre los patios con un hueco, y cosas de cada casa
        if (i > 0 && id !== 'tienda1') { M.wallW(86, 89, ox - 1, FE); M.wallW(90, 92, ox - 1, FE); }
      });
      M.put('cobertizo', 9.0, 89.8, 0, -1); M.put('jardinera', 14.6, 88.6, 0, 1); M.put('tendedero', 12.0, 87.0, 1, 0);
      M.put('columpio', 25.0, 89.6, 0, -1); M.put('cubos', 29.4, 86.6, 0, 1);
      M.put('tendedero', 38.0, 88.8, 0, 1); M.put('mesa_campo', 42.6, 89.6, 0, 1); M.put('banco_parque', 42.6, 91.0, 0, -1);
      M.put('cobertizo', 55.0, 90.0, 0, -1); M.put('jardinera', 50.4, 88.0, 1, 0); M.put('jardinera', 50.4, 90.6, 1, 0);
      M.put('palets', 70.0, 89.0, 0, 1); M.put('cajas', 72.0, 89.0, 0, 1); M.put('cubos', 76.0, 87.0, 0, 1); M.put('bidones', 74.0, 91.0, 1, 0);
      M.put('jardinera', 84.0, 89.6, 0, 1); M.put('tobogan', 88.6, 88.4, -1, 0);
      for (const [x, z] of [[18, 90], [32, 89], [46, 90], [62, 87], [78, 90]]) M.tree(x, z, false);
      M.puddle(28, 69.4, 2.6, 1.2); M.puddle(84, 67.6, 2.0, 1.0);

      // ---- la franja entre el jardín, el solar y la calle del sur: setos, bancos y árboles en fila ----
      for (let x = 7; x < 56; x += 6) if (x < 22 || x > 26) M.tree(x, 61, false);
      M.put('seto', 15.0, 63.6, 0, 1, { x0: 6.0, x1: 22.0, z0: 63.3, z1: 64.0, h: 0.9 });
      M.put('seto', 44.0, 63.6, 0, 1, { x0: 28.0, x1: 55.0, z0: 63.3, z1: 64.0, h: 0.9 });
      M.put('banco_parque', 24.5, 62.5, 0, 1); M.put('papelera', 26.4, 62.8, 0, 1);

      // ---- la gasolinera (noreste): la tienda, la marquesina con los surtidores, el cartel de precios,
      // neumáticos, cubos y un coche que se quedó repostando ----
      M.ground(66, 4, 92, 26, F.ROAD);
      M.building('tienda2', 80, 6, 10, 8, 'S', paint(0xd8d4cc, 0xb8302a));
      M.put('marquesina', 73.0, 19.5, 0, 1, { x0: 68.5, x1: 77.5, z0: 16.5, z1: 22.5, h: 4.4 });
      for (const [x, z] of [[69.1, 17.1], [76.9, 17.1], [69.1, 21.9], [76.9, 21.9]]) M.put('poste', x, z, 0, 1, { h: 4.4 });
      M.put('surtidor', 71.0, 19.5, 1, 0); M.put('surtidor', 75.0, 19.5, 1, 0);
      M.put('coche', 73.0, 17.6, 1, 0, { col: 0x2e4a6a });
      M.put('cartel_precios', 67.4, 24.0, 0, 1);
      M.put('neumaticos', 90.4, 16.0, 0, 1); M.put('neumaticos', 90.4, 17.2, 0, 1); M.put('cubos', 79.0, 15.2, 0, 1);
      M.put('bidones', 67.4, 8.0, 1, 0); M.put('ibc', 67.4, 10.6, 1, 0);
      M.puddle(72, 23.4, 3, 1.4);

      // ---- la plaza (este): caminos de losas, la fuente en medio, juegos infantiles con su arenero y seto,
      // bancos, el quiosco, un busto en su pedestal, farolas y árboles ----
      M.ground(65, 48, 92, 50, F.SIDEWALK); M.ground(77, 33, 79, 65, F.SIDEWALK); M.ground(73, 44, 83, 54, F.SIDEWALK);
      M.ground(84, 35, 91, 45, F.DIRT);
      M.put('fuente', 78.0, 49.0, 0, 1);
      for (const [x, z, fx, fz] of [[74.6, 45.4, 0, 1], [81.4, 45.4, 0, 1], [74.6, 52.6, 0, -1], [81.4, 52.6, 0, -1]]) M.put('banco_parque', x, z, fx, fz);
      M.put('columpio', 87.5, 37.6, 0, 1); M.put('tobogan', 86.0, 42.2, 1, 0);
      M.put('seto', 83.6, 40.0, 1, 0, { x0: 83.25, x1: 83.95, z0: 35.0, z1: 45.0, h: 0.9 });
      M.put('banco_parque', 85.0, 46.5, 0, -1);
      M.put('kiosco', 70.0, 38.0, 1, 0); M.put('papelera', 72.0, 40.2, 0, 1);
      M.put('pedestal', 78.0, 59.0, 0, -1); M.put('banco_parque', 75.6, 59.0, 1, 0); M.put('banco_parque', 80.4, 59.0, -1, 0);
      M.put('seto', 71.0, 62.6, 0, 1, { x0: 66.0, x1: 76.0, z0: 62.3, z1: 63.0, h: 0.9 }); M.put('seto', 85.5, 62.6, 0, 1, { x0: 80.0, x1: 91.0, z0: 62.3, z1: 63.0, h: 0.9 });
      for (const [x, z] of [[68, 35], [74, 35], [83, 34], [68, 44], [68, 55], [72, 58], [85, 52], [89, 56], [88, 49]]) M.tree(x, z, false);
      for (const [x, z] of [[73, 47], [83, 51], [76, 57], [70, 51]]) M.pole(x, z);
      M.bush(66, 46); M.bush(90, 60); M.bush(66, 60);

      // ---- fuera de la valla: edificios que tapan el horizonte y pinos ----
      M.put('fachada', 22.0, 1.6, 0, 1, { x0: 8.0, x1: 36.0, z0: 0.2, z1: 3.4, h: 13.5, style: 0 });
      M.put('fachada', 78.0, 1.6, 0, 1, { x0: 68.0, x1: 90.0, z0: 0.2, z1: 3.4, h: 11.0, style: 1 });
      M.put('fachada', 94.4, 48.0, -1, 0, { x0: 92.8, x1: 96.0, z0: 36.0, z1: 62.0, h: 12.0, style: 2 });
      M.put('fachada', 36.0, 94.4, 0, -1, { x0: 22.0, x1: 50.0, z0: 92.8, z1: 96.0, h: 10.5, style: 1 });
      M.put('fachada', 1.6, 78.0, 1, 0, { x0: 0.0, x1: 3.2, z0: 66.0, z1: 90.0, h: 14.0, style: 0 });
      for (let a = 0; a < 96; a += 2) {
        for (const off of [0, 2]) {
          const j = Math.floor(rng() * 2);
          for (const [x, z] of [[off + j, a], [94 - off - j, a + 1], [a, off + j], [a + 1, 94 - off - j]]) {
            if (x >= 0 && z >= 0 && x < 96 && z < 96 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.7);
          }
        }
      }
    }
  };

  // =====================================================================================================
  // Estación de servicio (46 x 46): la parte nueva del barrio completo, por su cuenta. El cruce de la avenida
  // con la calle principal; al noreste la gasolinera (la tienda, la marquesina con los surtidores, el cartel de
  // precios y un coche que se quedó repostando); al sureste la plaza (la fuente, bancos, el quiosco, juegos
  // infantiles y un busto); al noroeste un aparcamiento con coches abandonados y un camión, y al suroeste un
  // solar con un campamento de supervivientes. Edificios y pinos tapan el horizonte. Las piezas de la
  // gasolinera son las mismas del barrio completo (allí 44 casillas más al este)
  // =====================================================================================================
  MAPS.servicio = {
    name: 'Estación de servicio', min: 4, max: 50, spawn: { x: 17.5, z: 46.5 }, seed: 9393, fence: 'wood', tallGrass: true, escape2: true,
    board: { x: 24.5, z: 34.2, fx: 0, fz: -1 },
    mood: MAPS.barrio.mood,
    skyline: { col: 0x5f6e5a, h: [7, 14] },
    // las calles planas; lo demás, casi llano con alguna loma suave
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 7, z / 7, 531) - 0.5, n2 = V(x / 16, z / 16, 532) - 0.5;
      const roadD = Math.min(Math.abs(z - 29.5) - 3.7, Math.abs(x - 17.5) - 3.5);
      if (roadD <= 0) return 0;
      const k = U.clamp(roadD / 2.5, 0, 1);
      if (x < 14) return k * Math.max(0, 0.2 + n * 0.5 + n2 * 0.6);           // el aparcamiento y el solar
      return k * (0.12 + Math.max(0, n) * 0.2);                                 // gasolinera y plaza: casi llano
    },
    build(M, rng) {
      const F = G.World.F;
      // las piezas copiadas del barrio completo, con sus coordenadas de allí (44 casillas más al este)
      const D = 44, S = {
        ground: (x0, z0, x1, z1, g) => M.ground(x0 - D, z0, x1 - D, z1, g),
        building: (id, ox, oz, w, h, fr, post) => M.building(id, ox - D, oz, w, h, fr, post),
        put: (t, x, z, fx, fz, ex) => {
          if (ex && ex.x0 != null) ex = Object.assign({}, ex, { x0: ex.x0 - D, x1: ex.x1 - D });
          return M.put(t, x - D, z, fx, fz, ex);
        },
        puddle: (x, z, w, d) => M.puddle(x - D, z, w, d)
      };
      M.ground(0, 0, 64, 64, F.GRASS);
      // ---- la avenida (norte-sur) y la calle principal (este-oeste), con el cruce ----
      M.ground(14, 0, 15, 64, F.SIDEWALK); M.ground(15, 0, 20, 64, F.ROAD); M.ground(20, 0, 21, 64, F.SIDEWALK);
      M.ground(0, 26, 64, 27, F.SIDEWALK); M.ground(0, 27, 64, 32, F.ROAD); M.ground(0, 32, 64, 33, F.SIDEWALK);
      M.ground(15, 26, 20, 33, F.ROAD);
      for (const [x, z, w, d] of [[17.5, 25.3, 5, 1.4], [17.5, 34.0, 5, 1.4], [13.4, 29.5, 1.4, 5], [21.6, 29.5, 1.4, 5]]) {
        const al = w > d; M.put('paso_cebra', x, z, al ? 1 : 0, al ? 0 : 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      }
      M.put('semaforo', 14.4, 25.6, 0, 1); M.put('semaforo', 20.6, 33.4, 0, -1);
      M.put('senal', 20.6, 25.6, -1, 0); M.put('senal', 14.4, 33.4, 1, 0);
      M.put('hidrante', 20.5, 12.0, 0, 1); M.put('hidrante', 14.5, 40.0, 0, 1);
      // coches parados en la avenida y la calle (uno chocado contra el semáforo)
      M.put('coche', 15.9, 10.0, 0, 1, { col: 0x5a6a7a }); M.put('coche', 15.9, 16.5, 0, 1, { col: 0x8a3a32 });
      M.put('camioneta', 19.2, 42.0, 0, -1, { col: 0x3a4a3a });
      M.put('coche', 26.0, 27.7, 1, 0, { col: 0x6a5a3a }); M.put('coche', 40.0, 31.3, -1, 0, { col: 0x3a3a3a });
      M.put('camioneta', 33.0, 27.7, 1, 0, { col: 0x7a3a2e });
      M.put('coche', 8.0, 30.6, 0.9, -0.45, { col: 0x9a9a92 });
      M.put('barrera', 17.5, 5.6, 0, 1); M.put('barrera', 6.0, 28.4, 1, 0);
      M.put('parada', 28.0, 25.4, 0, 1); M.put('papelera', 26.0, 25.6, 0, 1); M.put('papelera', 14.6, 22.0, 0, 1);
      for (const z of [10, 20, 40, 47]) M.pole(14, z);
      for (const x of [26, 36, 46]) { M.pole(x, 26); M.pole(x - 4, 32); }
      M.pole(8, 26); M.pole(10, 32);
      M.puddle(24, 30.6, 2.4, 1.1); M.puddle(17, 37.5, 1.8, 1.0);

      // ---- la gasolinera (noreste) ----
      S.ground(66, 4, 92, 26, F.ROAD);
      S.building('tienda2', 80, 6, 10, 8, 'S', paint(0xd8d4cc, 0xb8302a));
      S.put('marquesina', 73.0, 19.5, 0, 1, { x0: 68.5, x1: 77.5, z0: 16.5, z1: 22.5, h: 4.4 });
      for (const [x, z] of [[69.1, 17.1], [76.9, 17.1], [69.1, 21.9], [76.9, 21.9]]) S.put('poste', x, z, 0, 1, { h: 4.4 });
      S.put('surtidor', 71.0, 19.5, 1, 0); S.put('surtidor', 75.0, 19.5, 1, 0);
      S.put('coche', 73.0, 17.6, 1, 0, { col: 0x2e4a6a });
      S.put('cartel_precios', 67.4, 24.0, 0, 1);
      S.put('neumaticos', 90.4, 16.0, 0, 1); S.put('neumaticos', 90.4, 17.2, 0, 1); S.put('cubos', 79.0, 15.2, 0, 1);
      S.put('bidones', 67.4, 8.0, 1, 0); S.put('ibc', 67.4, 10.6, 1, 0);
      S.puddle(72, 23.4, 3, 1.4);
      // detrás de la tienda y junto a la valla: el lavadero, palés, una grúa de taller y un coche sin ruedas
      M.put('palets', 24.0, 5.6, 0, 1); M.put('cajas', 26.0, 5.6, 0, 1); M.put('cubos', 34.4, 5.0, 0, 1);
      M.put('coche', 42.0, 21.0, 1, 0, { col: 0x6a6e62 }); M.put('neumaticos', 38.6, 23.4, 0, 1);
      M.put('lona', 30.0, 9.0, 0, 1); M.put('barricada', 47.0, 22.6, 1, 0);

      // ---- la plaza (sureste): la fuente en medio, caminos de losas, bancos, el quiosco, juegos y un busto ----
      M.ground(21, 40, 48, 42, F.SIDEWALK); M.ground(33, 33, 35, 50, F.SIDEWALK); M.ground(29, 36, 39, 46, F.SIDEWALK);
      M.ground(40, 35, 47, 45, F.DIRT);
      M.put('fuente', 34.0, 41.0, 0, 1);
      for (const [x, z, fx, fz] of [[30.6, 37.4, 0, 1], [37.4, 37.4, 0, 1], [30.6, 44.6, 0, -1], [37.4, 44.6, 0, -1]]) M.put('banco_parque', x, z, fx, fz);
      M.put('kiosco', 25.0, 37.0, 1, 0); M.put('papelera', 27.2, 39.2, 0, 1);
      M.put('columpio', 43.5, 37.4, 0, 1); M.put('tobogan', 44.0, 43.0, -1, 0);
      M.put('seto', 39.6, 39.5, 1, 0, { x0: 39.25, x1: 39.95, z0: 35.0, z1: 39.6, h: 0.9 });
      M.put('banco_parque', 42.0, 46.4, 0, -1);
      M.put('pedestal', 25.0, 45.0, 1, 0); M.put('banco_parque', 27.6, 47.6, 0, -1);
      M.put('seto', 34.0, 48.8, 0, 1, { x0: 28.0, x1: 33.0, z0: 48.5, z1: 49.2, h: 0.9 });
      for (const [x, z] of [[23, 35], [37, 34], [46, 34], [22, 43], [29, 48], [38, 48], [47, 48], [46, 41]]) M.tree(x, z, false);
      M.pole(29, 41); M.pole(38, 43);
      M.bush(23, 48); M.bush(36, 47); M.tall(40, 45, 47, 50);

      // ---- el aparcamiento (noroeste): coches abandonados en fila, un camión y una caseta ----
      M.ground(4, 6, 13, 25, F.ROAD);
      for (const z of [8.5, 13.0, 17.5]) M.put('coche', 6.6, z, 1, 0, { col: U.pick(rng, [0x5a6a7a, 0x8a7a5a, 0x4a4a4e, 0x7a3a32, 0x9aa09a]) });
      M.put('coche', 11.2, 10.6, -1, 0, { col: 0x3e4a52 });
      M.put('camion', 8.5, 22.4, 1, 0, { col: 0xd8d4c8 });
      M.put('cubos', 12.4, 6.2, 0, 1); M.put('carrito', 11.6, 15.0, 0.6, 0.8); M.put('carrito', 12.2, 17.2, -1, 0.2);
      M.tall(4, 4, 13, 6);
      for (const [x, z] of [[5, 4], [9, 4]]) M.tree(x, z, false);

      // ---- el solar (suroeste): hierba alta, un campamento con plataforma de vigilancia y un coche quemado ----
      M.put('tarima', 10.6, 37.6, 0, 1); M.put('fogata', 8.0, 42.0, 0, 1); M.put('refugio_lona', 6.4, 38.0, 1, 0);
      M.put('tablas', 11.6, 43.6, 1, 0); M.put('bidones', 5.6, 45.0, 0, 1);
      M.put('coche', 9.0, 48.0, 1, 0, { col: 0x3a3632 }); M.put('arbol_caido', 12.0, 46.0, 0, 1);
      M.put('cadaveres', 6.0, 35.2, 0, 1);
      M.tall(4, 34, 13, 37); M.tall(4, 44, 8, 50);
      for (const [x, z] of [[12, 40], [5, 47], [11, 34]]) M.tree(x, z, rng() < 0.4);

      // ---- fuera de la valla: edificios que tapan el horizonte y pinos (sin tapar la avenida ni la calle) ----
      M.put('fachada', 34.0, 1.6, 0, 1, { x0: 22.0, x1: 46.0, z0: 0.2, z1: 3.4, h: 11.0, style: 1 });
      M.put('fachada', 52.4, 16.0, -1, 0, { x0: 50.8, x1: 54.0, z0: 4.0, z1: 25.0, h: 12.0, style: 2 });
      M.put('fachada', 52.4, 43.0, -1, 0, { x0: 50.8, x1: 54.0, z0: 35.0, z1: 50.0, h: 10.0, style: 0 });
      M.put('fachada', 34.0, 52.4, 0, -1, { x0: 24.0, x1: 46.0, z0: 50.8, z1: 54.0, h: 10.5, style: 1 });
      M.put('fachada', 1.6, 42.0, 1, 0, { x0: 0.0, x1: 3.2, z0: 35.0, z1: 50.0, h: 14.0, style: 0 });
      for (let a = 0; a < 56; a += 2) {
        for (const off of [0, 2]) {
          const j = Math.floor(rng() * 2);
          for (const [x, z] of [[off + j, a], [53 - off - j, a + 1], [a, off + j], [a + 1, 53 - off - j]]) {
            if ((x >= 13 && x <= 21) || (z >= 25 && z <= 33)) continue;          // (la avenida y la calle siguen)
            if (x >= 0 && z >= 0 && x < 56 && z < 56 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.7);
          }
        }
      }
    }
  };

  // =====================================================================================================
  // Supermercado (48 x 48): un súper grande abandonado con el techo hundido por partes. Por los agujeros entró
  // la nieve: montones debajo y una capa por el suelo, vigas y planchas caídas y el aire acondicionado del techo
  // en medio de la fruta. Se empieza en el almacén de atrás (oscuro). Sala de ventas: vitrinas refrigeradas en
  // la pared del fondo, pasillos de góndolas vacías (alguna caída), la zona de fruta con fruteros de madera y
  // cajas, una zona de arcones congeladores tapados de nieve y las cajas registradoras delante. Fuera, el
  // aparcamiento nevado con coches, carritos y farolas, y un callejón de carga detrás. Edificios y pinos tapan
  // el horizonte
  // =====================================================================================================
  MAPS.super = {
    name: 'Supermercado', min: 2, max: 50, spawn: { x: 8.5, z: 10.5 }, seed: 5150, fence: 'chain', escape2: true,
    board: { x: 6.0, z: 31.3, fx: 0, fz: 1 },             // modo libre: el panel de los mapas (en la acera de delante)
    // luz: invierno, cielo blanco grisáceo y neblina fría (dentro, la luz entra por el techo roto)
    mood: { sky: 0x9aa2a8, fog: 1.15, hemi: [0xb4bcc4, 0x40444a, 0.58], sun: [0xdfe6ee, 0.36],
      ground: { 0: [0xdfe3e6, 0xe9ecee], 1: [0x55595e, 0x5f6368], 2: [0x9ea2a6, 0xa8acb0], 3: [0x7a7670, 0x847f78] } },
    skyline: { col: 0x8a9298, h: [8, 22] },
    build(M, rng) {
      const F = G.World.F;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 64, 64, F.GRASS);                 // (la hierba aquí es nieve)
      M.ground(2, 33, 50, 50, F.ROAD);                 // aparcamiento
      M.ground(2, 30, 50, 33, F.SIDEWALK);             // acera delante del súper
      M.ground(2, 2, 34, 8, F.ROAD);                   // callejón de carga
      // ---- el edificio: dos mitades unidas en x = 32 ----
      const front = (c, b, li, E2) => {
        b.worn = true;
        for (const r of b.rooms) if (r.type === 'super') r.on = rng() < 0.3;
        // escaparate: ventanas en la fachada de la sala (sin tocar las puertas ni lo de al lado)
        const z = b.z0 + b.h;
        for (let x = b.x0 + 1; x < b.x0 + b.w - 1; x++) {
          const e = c.eN[li(x, z)], l = c.eN[li(x - 1, z)], r = c.eN[li(x + 1, z)];
          const isDoor = (q) => q === E2.DOOR || q === E2.ARCH || q === E2.DOOR_OPEN;
          if (e === E2.WALL && !isDoor(l) && !isDoor(r) && (x - b.x0) % 3 !== 0) c.eN[li(x, z)] = E2.WIN_OPEN;
        }
      };
      M.building('super_w', 4, 8, 28, 22, 'S', front);
      M.building('super_e', 32, 8, 14, 22, 'S', (c, b, li, E2) => {
        front(c, b, li, E2);
        // la pared que da a la otra mitad: abierta en la sala; en el almacén, un hueco a la cámara
        for (let z = 13; z < 30; z++) c.eW[li(32, z)] = E2.NONE;
        c.eW[li(32, 10)] = E2.NONE;
      });

      // ---- sala de ventas ----
      // vitrinas refrigeradas en la pared del fondo (sin tapar las puertas del almacén)
      for (const x of [5.2, 7.3, 13.0, 15.1, 22.0, 24.1, 30.1, 34.0, 36.1, 42.2, 44.3]) M.put('vitrina', x, 13.5, 0, 1);
      // pasillos de góndolas (bajo el primer agujero del techo, caídas)
      for (const z of [16.5, 22.6]) { M.put('gondola', 7.0, z, 1, 0); M.put('gondola', 10.4, z, 1, 0); M.put('gondola', 13.8, z, 1, 0); }
      M.put('gondola', 7.0, 19.55, 1, 0);
      M.put('gondola_caida', 10.6, 19.6, 1, 0); M.put('gondola_caida', 14.2, 19.4, -1, 0);
      for (const z of [16.2, 19.4, 22.6]) M.put('gondola', 45.35, z, -1, 0);
      for (const [x, z] of [[8.7, 19.5], [12.1, 17.0], [27.0, 19.0], [40.0, 23.5]]) M.put('cartel_colgante', x, z, 1, 0, { hang: 3.7 });
      // agujero 1: nieve y vigas sobre los pasillos
      M.put('nieve', 12.5, 19.2, 0, 1, { x0: 9.0, x1: 16.0, z0: 16.4, z1: 22.4 });
      M.put('monton_nieve', 12.4, 18.9, 0, 1, { x0: 11.2, x1: 13.6, z0: 17.7, z1: 20.1, h: 0.75 });
      M.put('vigas', 12.0, 21.4, 1, 0, { x0: 11.2, x1: 12.8, z0: 19.6, z1: 23.0, h: 1.3 });
      // zona de fruta: fruteros y cajas; agujero 2 con el aire acondicionado caído encima
      for (const [x, z] of [[18.8, 16.8], [22.6, 16.8], [26.4, 16.8], [18.8, 20.0]]) M.put('frutero', x, z, 0, 1);
      M.put('frutero', 29.6, 20.4, 1, 0);
      for (const [x, z] of [[29.7, 16.4], [17.6, 23.0], [29.0, 24.6], [17.4, 26.0]]) M.put('cajas_fruta', x, z, 0, 1);
      M.put('nieve', 23.0, 23.0, 0, 1, { x0: 19.0, x1: 27.5, z0: 20.6, z1: 26.6 });
      M.put('aire_caido', 22.6, 22.6, 0, 1);
      M.put('monton_nieve', 25.4, 24.4, 0, 1, { x0: 24.0, x1: 27.0, z0: 23.3, z1: 25.5, h: 0.6 });
      M.put('vigas', 20.6, 24.9, 0, 1, { x0: 19.2, x1: 22.4, z0: 24.2, z1: 25.6, h: 1.1 });
      M.put('escombro_grande', 26.8, 21.6, 0, 1);
      // zona de congeladores (lado este), con el tercer agujero
      M.put('nieve', 38.5, 21.5, 0, 1, { x0: 33.0, x1: 44.0, z0: 15.0, z1: 28.0 });
      M.put('monton_nieve', 37.5, 18.5, 0, 1, { x0: 36.0, x1: 39.2, z0: 17.2, z1: 19.8, h: 0.8 });
      for (const [x, z, fx, fz] of [[34.2, 24.4, 0, 1], [37.2, 24.4, 0, 1], [41.6, 17.2, 1, 0], [42.8, 21.6, 0, 1], [40.4, 26.4, 0, 1], [34.6, 16.4, 0, 1]]) M.put('congelador', x, z, fx, fz);
      M.put('vigas', 39.6, 21.0, 1, 0, { x0: 38.8, x1: 40.4, z0: 19.4, z1: 22.4, h: 1.2 });
      // cajas registradoras delante (sin tapar las tres entradas)
      for (const x of [6.2, 15.0, 18.4, 21.8, 29.0, 33.4, 43.2]) M.put('caja_reg', x, 27.6, 0, 1);
      for (const [x, z] of [[12.6, 25.6], [26.6, 27.0], [41.0, 28.6], [31.2, 15.2], [8.8, 26.0]]) M.put('carrito', x, z, R(-1, 1) < 0 ? 1 : -1, 0);
      M.put('escombros', 30.4, 22.0, 0, 1, { x0: 29.6, x1: 31.2, z0: 21.4, z1: 22.6 });

      // ---- fuera: aparcamiento nevado ----
      for (const [t, x, z, fx, fz] of [['coche', 8, 37.5, 0, 1], ['coche', 14.5, 38.0, 0, -1], ['camioneta', 26, 38.2, 0, -1], ['coche', 33.0, 44.6, 1, 0], ['coche', 45.0, 38.0, 0, 1], ['camion', 40.0, 46.0, 1, 0]]) M.put(t, x, z, fx, fz, t === 'coche' ? { col: U.pick(rng, [0x6a7480, 0x8a3a30, 0x4a5a4a, 0xb8b4a8]) } : null);
      for (const [x, z] of [[18.0, 35.2], [19.2, 41.0], [30.4, 36.0], [47.2, 35.0], [11.0, 33.8]]) M.put('carrito', x, z, 0, rng() < 0.5 ? 1 : -1);
      for (const [x, z] of [[12, 41], [28, 41], [44, 41]]) M.pole(x, z);
      for (const [x, z, w, d, h] of [[5.5, 46.5, 3.4, 2.4, 0.7], [22.0, 46.8, 4.0, 2.2, 0.6], [48.0, 43.0, 2.4, 3.6, 0.8], [3.4, 31.6, 2.6, 2.0, 0.5]]) M.put('monton_nieve', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
      for (let k = 0; k < 14; k++) { const x = R(4, 48), z = R(34, 48), w = R(2, 5), d = R(1.2, 3); M.put('nieve', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); }
      // ---- callejón de carga (detrás) ----
      M.put('cubos', 16.0, 3.4, 0, 1); M.put('cubos', 18.0, 3.4, 0, 1); M.put('palets', 6.4, 4.0, 0, 1); M.put('palets', 7.8, 4.2, 0, 1);
      M.put('camioneta', 27.0, 4.6, 1, 0, { col: 0x9a9890 }); M.put('bidones', 22.2, 3.2, 0, 1);
      M.put('monton_nieve', 12.0, 4.0, 0, 1, { x0: 10.6, x1: 13.4, z0: 2.9, z1: 5.1, h: 0.5 });
      // ---- fuera de la valla: edificios y pinos que tapan el horizonte ----
      M.put('fachada', 18.0, 0.0, 0, 1, { x0: 2.0, x1: 34.0, z0: -1.8, z1: 1.8, h: 12.5, style: 1 });
      M.put('fachada', 0.0, 30.0, 1, 0, { x0: -1.8, x1: 1.8, z0: 6.0, z1: 54.0, h: 14.0, style: 0 });
      M.put('fachada', 53.4, 16.0, -1, 0, { x0: 51.6, x1: 55.2, z0: 2.0, z1: 30.0, h: 11.0, style: 2 });
      M.put('fachada', 22.0, 53.4, 0, -1, { x0: 8.0, x1: 36.0, z0: 51.6, z1: 55.2, h: 10.0, style: 1 });
      for (let a = 0; a < 64; a += 2) for (const off of [52, 55, 58]) {
        const j = Math.floor(rng() * 2);
        for (const [x, z] of [[off + j, a], [a + 1, off + j]]) if (x >= 0 && z >= 0 && x < 64 && z < 64 && M.free(x, z, x + 1, z + 1)) M.tree(x, z, true);
      }
    }
  };

  // =====================================================================================================
  // Asentamiento en la playa (inspirado en la pantalla de inicio): la playa al sur con el bote varado y una
  // balsa, palmeras y rocas; al oeste un montículo de tierra y arena seca; árboles, arbustos y hierba de
  // otoño; y en el centro el asentamiento de los Escorpiones, cerrado por un muro pero con un portón que da a la
  // playa. Dentro: el museo (vestíbulo enorme con un esqueleto de dinosaurio y dos salas detrás: dormitorio y
  // armería) y un patio amplio con terrazas a distinta altura (huerto al oeste, tiendas y contenedores apilados
  // al este), la sala de vigilancia en el medio, una hoguera encendida, banderas con el escorpión y todo
  // ordenado: viven aquí y se nota que acaban de estar. A lo lejos, el faro (en el horizonte, como en el
  // inicio). El mar, las llamas, el humo, las banderas y el faro los pone G.Maps.decor / skyline
  // =====================================================================================================
  // La montaña del este de la playa: sube desde el muro (x 77) hasta pasado el borde, con crestas y barrancos;
  // al acercarse al mar se corre hacia el este y cae en un cabo de roca. También cierra un poco la esquina norte
  function playaMount(x, z) {
    const V = G.World.vnoise, C = U.clamp;
    const x0 = 78 + C((z - 60) / 24, 0, 1) * 8;               // el pie de la montaña (se va al este junto al mar)
    const t = C((x - x0) / 14, 0, 1);
    const north = C((x - 58) / 20, 0, 1) * C((7 - z) / 7, 0, 1);
    if (t <= 0 && north <= 0) return 0;
    const ridge = V(x / 9, z / 9, 711), gully = V(x / 4.5, z / 4.5, 712) - 0.5, wave = 0.75 + 0.5 * V(z / 13, 1.7, 713);
    let h = 1.2 + Math.pow(t, 1.25) * 9.5 * wave + ridge * 2.2 * t + gully * 0.9 * t;
    h += Math.max(0, x - x0 - 14) * 0.7 * wave;                  // (pasado el borde sigue subiendo: la cumbre)
    h = Math.max(h, 1.2 + north * (3.2 + ridge * 1.5));
    // al mar: el cabo baja en acantilado
    h *= C((91 - z) / 5, 0, 1);
    return h;
  }
  MAPS.playa = {
    name: 'Asentamiento en la playa', min: 4, max: 92, enemyMul: 1.5, spawn: { x: 48.5, z: 82.5 }, seed: 6161, fence: 'none', tallGrass: true, escape2: true, autumn: true,     // (enemyMul: grande, la mitad más de enemigos)
    board: { x: 50.5, z: 80.0, fx: 0, fz: -1 },
    // atardecer cálido (como la pantalla de inicio): cielo anaranjado, sol bajo, la niebla lejos
    wallCol: 0xa09482,            // muro del asentamiento: hormigón viejo, tostado
    mood: { sky: 0xf4d6bc, fog: 1.3, hemi: [0xf2c8a0, 0x5a4a3a, 0.74], sun: [0xffc48a, 1.0],
      ground: { 0: [0x7c7546, 0x88804c], 1: [0x5e5a52, 0x67625a], 2: [0xa69c8a, 0xb2a894], 3: [0xc8ac82, 0xd4b88e] } },
    skyline: { beach: true, col: 0x8c7f7c },
    // dónde van las banderas (x, z, hacia dónde ondean), las hogueras y barriles encendidos y los estandartes
    flags: [[37.2, 63.2, 0], [46.8, 63.2, 0], [35.6, 31.8, 0], [60.4, 31.8, 0], [22.6, 59.4, 1, 1.3], [73.4, 59.4, 1, 1.3], [48.6, 71.0, 2, 1.3], [52.6, 41.4, 3]],
    fires: [[40.5, 53.5, 1], [24.5, 25.5, 0], [70.5, 46.5, 0]],
    banners: [[38.0, 30.06], [48.0, 30.06], [58.0, 30.06]],
    // relieve: el patio (1 m) por encima de la playa; terrazas al oeste (2,2 m) y al este (1,8 m) con rampas; el
    // montículo al noroeste; el camino de entrada al oeste (llano); al este, la montaña que rodea el
    // asentamiento por fuera y baja hasta el mar en un cabo de roca; la playa baja hasta el agua (z 89,6)
    height(x, z) {
      const V = G.World.vnoise, n = V(x / 6, z / 6, 701) - 0.5, n2 = V(x / 15, z / 15, 702) - 0.5;
      const C = U.clamp;
      const mt = playaMount(x, z);
      if (z >= 66) {
        const s = C((89.5 - z) / 23, 0, 1);
        const dune = Math.max(0, 1 - Math.abs(z - 69) / 3) * (0.5 + n2) * 0.8;
        return Math.max(0, s * 0.95 + (z < 87 ? n * 0.18 + dune : 0), mt);
      }
      if (x >= 20 && x <= 76 && z >= 8 && z <= 62) {
        let h = 1.0;
        // terraza oeste (rampa en z 46 a 50) y terraza este (rampa en z 46 a 50)
        const rw = z > 46 && z < 50 ? 5 : 0.9, re = z > 46 && z < 50 ? 5 : 0.9;
        h += 1.2 * C((32 - x) / rw, 0, 1) * (z >= 30 ? 1 : 0);
        h += 0.8 * C((x - 66) / re, 0, 1) * (z >= 30 ? 1 : 0);
        // rampa del portón hacia la playa
        if (z > 60) h = U.lerp(h, 0.95, C((z - 60) / 2, 0, 1));
        return h;
      }
      if (z > 62) return Math.max(U.lerp(1.0, 0.95, C((z - 62) / 4, 0, 1)) + n * 0.1, mt);
      if (x < 20) {
        // el montículo (al noroeste del camino) y el camino de la entrada oeste, llano
        const d = Math.hypot(x - 9, z - 45);
        const mound = 1.0 + Math.max(0, 1 - d / 17) * 4.6 * (0.8 + n2 * 0.6) + n * 0.5;
        const road = C((Math.abs(z - 22) - 3.2) / 3, 0, 1);
        return U.lerp(1.0 + n * 0.08, Math.max(mound, 1.0 + n * 0.35), road);
      }
      if (x > 76) return Math.max(1.2 + n * 0.3, mt);
      return 1.1 + n * 0.3;
    },
    build(M, rng) {
      const F = G.World.F, E = G.World.E;
      const R = (a, b) => a + rng() * (b - a);
      M.ground(0, 0, 96, 96, F.GRASS);
      M.ground(0, 64, 96, 96, F.DIRT);                    // playa
      M.ground(5, 32, 17, 58, F.DIRT);                    // el montículo: tierra y arena seca
      M.ground(0, 19, 20, 25, F.ROAD);                    // el camino de la entrada oeste (la de verdad del museo)
      M.ground(20, 8, 34, 30, F.ROAD); M.ground(62, 8, 76, 30, F.ROAD);    // patios de servicio (tierra apisonada)
      M.ground(32, 30, 66, 62, F.SIDEWALK);               // el patio: losas de piedra
      M.ground(38, 62, 46, 66, F.SIDEWALK);               // la salida del portón

      // ---- el museo (fondo del asentamiento) y la sala de vigilancia (en el medio del patio) ----
      M.building('museo', 34, 8, 28, 22, 'S');
      M.building('vigilancia', 45, 42, 6, 5, 'S', (c, b, li, E2) => {
        // ventanas a los cuatro lados (salvo la puerta)
        for (let x = 45; x < 51; x++) for (const z of [42, 47]) { const i = li(x, z); if (c.eN[i] === E2.WALL) c.eN[i] = E2.WIN; }
        for (let z = 42; z < 47; z++) for (const x of [45, 51]) { const i = li(x, z); if (c.eW[i] === E2.WALL) c.eW[i] = E2.WIN; }
      });

      // ---- el muro del asentamiento, con el portón a la playa y un tramo caído al este ----
      M.wallN(20, 34, 8, E.WALL); M.wallN(62, 76, 8, E.WALL);
      M.wallW(8, 19, 20, E.WALL); M.wallW(25, 62, 20, E.WALL);      // (z 19 a 25: la entrada oeste, tapiada)
      M.wallW(8, 50, 76, E.WALL); M.wallW(53, 62, 76, E.WALL);
      M.wallN(20, 38, 62, E.WALL); M.wallN(46, 76, 62, E.WALL);
      M.put('escombro_grande', 77.4, 51.5, 1, 0); M.put('escombro_grande', 74.6, 51.0, 0, 1);
      // portón: barricadas a los lados, sacos terreros y dos torres de vigilancia en las esquinas
      M.put('sacos', 36.6, 64.0, 0, 1, { x0: 35.2, x1: 38.0, z0: 63.7, z1: 64.3, h: 0.85 });
      M.put('sacos', 47.4, 64.0, 0, 1, { x0: 46.0, x1: 48.8, z0: 63.7, z1: 64.3, h: 0.85 });
      M.put('tarima', 22.6, 59.4, 0, -1); M.put('tarima', 73.4, 59.4, 0, -1);
      M.put('tarima', 21.8, 10.2, 0, 1);

      // ---- la entrada oeste (la principal del museo, la del camino): cerrada a cal y canto. Los Escorpiones la
      // taparon con un camión cruzado, coches (uno encima de otro), barricadas y sacos, para que solo se entre
      // por la playa, donde se ve venir a cualquiera ----
      M.put('pilar', 20.0, 18.6, 1, 0); M.put('pilar', 20.0, 25.4, 1, 0);
      M.put('arco', 20.0, 22.0, 1, 0);
      for (const z of [19.9, 22.0, 24.1]) M.put('barricada', 20.55, z, 1, 0);
      M.put('sacos', 21.35, 22.0, 1, 0, { x0: 21.05, x1: 21.65, z0: 19.2, z1: 24.8, h: 0.85 });
      M.put('camion', 15.4, 22.0, 0, 1, { col: 0x7a6a52 });
      const car = M.put('coche', 18.3, 20.6, 0.2, 1, { col: 0x5a3a32 });
      if (car) M.P.furn.push(Object.assign({}, car, { type: 'coche', fx: -0.3, fz: 1, solid: false, yOff: 1.42, col: 0x3e4a52, x0: car.x0 + 0.1, x1: car.x1 + 0.1 }));
      M.put('coche', 17.4, 26.9, 1, 0.15, { col: 0x6a6e62 });
      M.put('barricada', 18.2, 17.6, 0, 1); M.put('barricada', 18.3, 24.0, 1, 0);
      M.put('neumaticos', 12.4, 18.6, 0, 1); M.put('neumaticos', 12.6, 25.6, 0, 1);
      M.put('senal', 11.6, 25.2, 1, 0);
      M.put('coche', 6.6, 21.4, 1, 0.2, { col: 0x8a8f86 });            // otro, abandonado en el camino
      M.put('escombros', 9.8, 23.6, 0, 1, { x0: 9.0, x1: 10.6, z0: 23.0, z1: 24.2 });
      M.put('barrera', 3.2, 23.6, 1, 0);
      M.puddle(10.5, 20.4, 1.8, 1.1);

      // ---- dentro del museo ----
      // vestíbulo (z 17 a 30): el esqueleto en el centro, pedestales y vitrinas; el comedor al este y la
      // recepción junto a la entrada
      M.put('esqueleto', 48.0, 23.0, 0, 1);
      for (const [x, z] of [[41.5, 20.0], [41.5, 26.0], [54.5, 20.0], [54.5, 26.0]]) M.put('pedestal', x, z, 0, 1);
      M.put('vitrina', 34.5, 20.5, 1, 0); M.put('vitrina', 34.5, 24.5, 1, 0);
      M.put('cuadro', 34.08, 27.5, 1, 0); M.put('cuadro', 61.92, 19.5, -1, 0); M.put('cuadro', 61.92, 27.5, -1, 0);
      M.put('mesa_campo', 58.6, 23.2, 1, 0); M.put('mesa_campo', 58.6, 26.0, 1, 0);
      M.put('banco_parque', 57.0, 23.2, 1, 0); M.put('banco_parque', 57.0, 26.0, 1, 0);
      M.put('mostrador', 37.6, 28.4, 0, -1);
      // sala oeste (dormitorio): sacos de dormir en dos filas, ordenados
      for (let k = 0; k < 6; k++) { M.put('saco_dormir', 35.6 + k * 2.0, 10.2, 0, 1); M.put('saco_dormir', 35.6 + k * 2.0, 15.2, 0, -1); }
      M.put('cajas', 46.6, 12.6, -1, 0);
      // sala este (armería y almacén): armeros, estanterías, cajas y el tablero con el mapa de la zona
      M.put('armero', 51.0, 8.5, 0, 1); M.put('armero', 53.4, 8.5, 0, 1);
      M.put('estanteria', 58.0, 8.6, 0, 1); M.put('estanteria', 61.4, 11.5, -1, 0);
      M.put('tablero', 55.0, 13.8, 0, 1);
      M.put('cajas', 60.6, 15.6, -1, 0); M.put('bidones', 50.2, 15.8, 0, -1);
      // pórtico: columnas (sin tapar las dos puertas)
      for (const x of [37.0, 45.0, 49.0, 52.0, 59.0]) M.put('columna', x, 31.2, 0, 1);

      // ---- patio de servicio oeste (almacén ordenado) y este (vehículos) ----
      for (let k = 0; k < 4; k++) { M.put('palets', 22.4 + k * 1.5, 10.6, 0, 1); M.put('cajas', 22.4 + k * 1.5, 13.0, 0, 1); }
      M.put('bidones', 30.6, 10.4, 0, 1); M.put('bidones', 30.6, 12.2, 0, 1);
      M.put('lona', 27.6, 18.0, 0, 1); M.put('barril_fuego', 24.5, 25.5, 0, 1); M.put('tablas', 30.4, 22.6, 1, 0);
      M.put('camioneta', 69.0, 13.0, 0, 1, { col: 0x5a4a3a }); M.put('coche', 69.2, 22.6, 0, -1, { col: 0x3a4a5a });
      M.put('bidones', 74.6, 12.0, -1, 0); M.put('ibc', 74.6, 16.6, -1, 0);

      // ---- terraza oeste: el huerto, un tendedero y el muro de contención con su rampa ----
      for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) M.put('jardinera', 23.6 + k * 4.0, 34.0 + r * 3.0, 0, 1);
      M.put('tendedero', 25.6, 50.0, 0, 1);
      M.put('tendedero', 25.6, 54.6, 0, 1);
      M.put('muro_bajo', 32.15, 38.0, 1, 0, { x0: 32.0, x1: 32.3, z0: 30.4, z1: 45.6, h: 0.8 });
      M.put('muro_bajo', 32.15, 56.0, 1, 0, { x0: 32.0, x1: 32.3, z0: 50.4, z1: 61.6, h: 0.8 });
      M.put('banco_parque', 29.6, 58.6, 0, -1);

      // ---- terraza este: contenedores apilados (se suben), tiendas en fila y el taller ----
      M.cont(71, 31, 'z', 6, 2, { cols: [0x6a3a2e, 0x2e4a5a] });
      M.cont(74, 31, 'z', 6, 1, { cols: [0x4a5a3a] });
      for (const [x, z] of [[68.6, 52.0], [72.4, 52.0], [68.6, 57.4], [72.4, 57.4]]) M.put('tienda', x, z, 0, -1);
      M.put('barril_fuego', 70.5, 46.5, 0, 1); M.put('mesa_campo', 70.6, 42.0, 0, 1);
      M.put('muro_bajo', 65.85, 38.0, 1, 0, { x0: 65.7, x1: 66.0, z0: 30.4, z1: 45.6, h: 0.6 });
      M.put('muro_bajo', 65.85, 56.0, 1, 0, { x0: 65.7, x1: 66.0, z0: 50.4, z1: 61.6, h: 0.6 });

      // ---- el patio: la hoguera con bancos, una mesa, sacos alrededor de la sala de vigilancia, palmeras en
      // jardineras y farolas ----
      M.put('fogata_viva', 40.5, 53.5, 0, 1);
      M.put('banco_parque', 40.5, 51.6, 0, 1); M.put('banco_parque', 40.5, 55.4, 0, -1); M.put('banco_parque', 38.4, 53.5, 1, 0);
      M.put('mesa_campo', 35.6, 49.0, 0, 1);
      M.put('sacos', 43.9, 44.5, 1, 0, { x0: 43.6, x1: 44.2, z0: 42.6, z1: 46.4, h: 0.85 });
      M.put('sacos', 52.1, 44.5, 1, 0, { x0: 51.8, x1: 52.4, z0: 42.6, z1: 46.4, h: 0.85 });
      M.put('consola', 48.0, 42.55, 0, 1);
      M.put('palmera', 34.6, 36.6, 0, 1); M.put('palmera', 63.4, 36.6, 0, 1); M.put('palmera', 56.0, 57.6, 0, 1);
      M.put('carrito', 60.2, 50.0, 0, 1); M.put('cajas', 62.6, 33.2, 0, 1); M.put('cajas', 63.8, 33.2, 0, 1);
      for (const [x, z] of [[36, 43], [60, 43], [44, 60], [56, 32]]) M.pole(x, z);

      // ---- la playa: el bote varado, la balsa en la orilla, palmeras, rocas, troncos y dunas con hierba ----
      M.put('bote', 55.0, 80.6, 0.86, -0.5);
      M.put('balsa', 63.0, 86.4, 1, 0);
      for (const [x, z] of [[30, 70], [35.5, 75.5], [70, 68], [78.5, 76], [24, 80], [86, 70], [12, 72]]) M.put('palmera', x + 0.5, z + 0.5, 0, 1);
      for (const [x, z, w, d] of [[20, 84, 2.2, 1.6], [84, 82, 2.6, 1.8], [9, 76, 1.8, 1.4], [90, 88, 2.0, 1.6], [42, 87, 1.4, 1.1]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.6 + rng() * 0.8 });
      M.put('arbol_caido', 38.0, 83.0, 1, 0);
      M.put('tarima', 48.6, 71.0, 0, 1); M.put('sacos', 52.0, 70.4, 0, 1, { x0: 50.8, x1: 53.2, z0: 70.1, z1: 70.7, h: 0.85 });
      M.tall(6, 65, 28, 71); M.tall(66, 64, 90, 69); M.tall(14, 74, 20, 80);

      // ---- el montículo (oeste) y la ladera (este): hierba seca, arbustos y árboles de otoño ----
      M.tall(5, 6, 19, 17); M.tall(5, 28, 19, 62); M.tall(78, 30, 86, 60);
      for (let k = 0; k < 16; k++) { const x = Math.floor(R(5, 18)), z = Math.floor(R(8, 62)); if (z >= 17 && z <= 27) continue; if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, false); }
      // ---- la montaña del este (rodea el asentamiento por fuera y baja al mar en un cabo): peñas y
      // afloramientos de roca, pinos arriba y árboles de otoño abajo, arbustos, troncos caídos, un
      // desprendimiento junto al muro caído y el viejo sendero con su cartel ----
      for (const [x, z, w, d, h] of [[83, 12, 3.4, 2.6, 2.4], [88, 22, 4.0, 3.0, 3.0], [81.5, 33, 2.6, 2.2, 1.8], [89, 40, 3.6, 3.0, 2.8],
        [84, 47, 3.0, 2.4, 2.2], [90, 56, 4.2, 3.2, 3.2], [85, 63, 3.2, 2.6, 2.6], [88.5, 72, 3.6, 3.0, 3.0], [90.5, 80, 3.0, 2.6, 2.4],
        [80.5, 4.5, 3.0, 2.4, 2.0], [70, 3.2, 2.6, 2.0, 1.6], [91, 6, 3.0, 2.6, 2.6]]) {
        M.put('pena', x, z, rng() < 0.5 ? 1 : -1, 0.3, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
      }
      for (let k = 0; k < 14; k++) { const x = R(79, 91), z = R(6, 84), w = R(1.0, 1.9), d = R(0.8, 1.5); M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.5 + rng() * 0.8 }); }
      M.put('escombros', 79.8, 47.6, 1, 0, { x0: 78.8, x1: 80.8, z0: 46.6, z1: 48.6 });
      M.put('arbol_caido', 84.0, 28.0, 0.3, 1); M.put('arbol_caido', 82.5, 56.6, 1, 0.2);
      M.put('senal', 79.4, 40.6, -1, 0);                                     // «peligro: desprendimientos»
      for (let k = 0; k < 34; k++) {
        const x = Math.floor(R(79, 92)), z = Math.floor(R(2, 70));
        if (z > 62 && x < 82) continue;
        if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, x > 85 ? rng() < 0.7 : rng() < 0.15);
      }
      for (let k = 0; k < 8; k++) { const x = Math.floor(R(60, 79)), z = Math.floor(R(1, 6)); if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.4); }
      // arriba (pasado el borde): un pinar cerrado en la cresta
      for (let z = 1; z < 78; z += 2) for (const x of [92, 94]) if (rng() < 0.8) M.tree(x + (z % 4 ? 1 : 0), z, rng() < 0.8);
      for (let x = 6; x < 90; x += 4) { const z = 4 + Math.floor(rng() * 3); if (M.free(x, z, x + 1, z + 1)) M.tree(x, z, rng() < 0.25); }
      for (let k = 0; k < 22; k++) { const z = Math.floor(R(8, 64)); if (z < 17 || z > 27) M.bush(Math.floor(R(5, 19)), z); }
      for (let k = 0; k < 30; k++) M.bush(Math.floor(R(78, 92)), Math.floor(R(2, 76)));
      for (const [x, z] of [[23, 44], [29, 32], [70, 37], [64, 59]]) M.tree(x, z, false);
      for (const [x, z, w, d] of [[11, 27, 2.4, 1.8], [16, 50, 1.8, 1.4], [7, 58, 2.0, 1.6]]) M.put('roca', x, z, 0, 1, { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: 0.8 + rng() * 1.0 });
    }
  };

  // =====================================================================================================
  // Salón recreativo (solo para el jefe final): un local de máquinas abandonado. Se empieza en el medio de la
  // sala grande (20 x 12, como el interior de la nave de la terminal). Detrás de la pared norte está la
  // trastienda, la guarida del hongomorfo (siempre sale por ese tramo de pared); en cada una de las otras tres
  // paredes, una habitación con puerta (despacho, depósito y vestíbulo), conectadas también entre sí para dar
  // vueltas. El hongomorfo no cabe por las puertas: derriba las paredes. Moqueta con dibujos de neón comida por el hongo, máquinas volcadas,
  // neones en las paredes (algunos rotos, parpadeando) y escombros
  // =====================================================================================================
  const AX = 8, AZ = 8;          // esquina del edificio
  MAPS.arcade = {
    name: 'Salón recreativo', boss: true, min: 2, max: 54, spawn: { x: AX + 13, z: AZ + 10.6 }, seed: 777, fence: 'chain',
    skyline: { col: 0x1c1a24, h: [9, 24] },
    // fuera: calle de noche (solo se llega si el hongomorfo tira una de las paredes de fuera); las luces de la
    // calle están en G.Maps.decor
    outLamps: [[18, 37.4, 0xffa04a], [44, 20, 0xffb060], [6, 46, 0xff9a40]],
    board: { x: AX + 13, z: AZ + 15.85, fx: 0, fz: -1 }, // modo libre: el panel de los mapas (pared sur)
    // dentro: penumbra morada; la luz la ponen los neones y las pantallas
    mood: { sky: 0x07060b, fog: 0.55, hemi: [0x8a7ab0, 0x2a2232, 0.9], sun: [0xb4a6d8, 0.05], ground: { 3: [0x2a2630, 0x302b36], 1: [0x232227, 0x28272c], 2: [0x36353a, 0x3d3c42], 0: [0x1f2a1e, 0x253124] } },
    // datos del jefe (coordenadas del mundo): la sala, la guarida, el tramo de pared que se derriba al empezar
    // (aristas N en z = AZ + 4, de x0 a x1 - 1) y por dónde sale el blindado
    arena: { hall: { x0: AX + 3, z0: AZ + 4, x1: AX + 23, z1: AZ + 16 }, lair: { x: AX + 13, z: AZ + 2 },
      breach: { z: AZ + 4, x0: AX + 11, x1: AX + 15 }, nemi: { x: AX + 7, z: AZ + 2 } },
    build(M, rng) {
      const F = G.World.F;
      M.ground(0, 0, 56, 56, F.ROAD);
      // ---- fuera ----
      // calle al sur (z 30..36) con aceras, aparcamiento del otro lado, patio de carga al este, callejones al
      // norte y al oeste y un descampado al sureste
      M.ground(2, 28, 54, 30, F.SIDEWALK); M.ground(2, 36, 54, 38, F.SIDEWALK);
      M.ground(34, 2, 36, 28, F.SIDEWALK);
      M.ground(40, 40, 54, 54, F.DIRT); M.ground(2, 2, 8, 8, F.DIRT);
      M.ground(46, 2, 54, 10, F.GRASS); M.ground(2, 48, 12, 54, F.GRASS);
      // la calle: coches abandonados, uno de policía cruzado y una ambulancia con las puertas abiertas
      M.put('coche', 12.5, 32.4, 1, 0, { col: 0x3a4a5a }); M.put('patrulla', 24.5, 33.6, -0.94, 0.34);
      M.put('coche', 33.0, 34.4, -1, 0, { col: 0x5a2a26 }); M.put('ambulancia', 45.0, 32.6, 1, 0);
      M.put('arbol_caido', 6.0, 33.2, 1, 0);
      M.put('barrera', 18.0, 31.0, 0, 1); M.put('barrera', 39.0, 35.2, 0, 1);
      M.puddle(20, 34.5, 3, 1.4); M.puddle(37, 31.3, 2.2, 1);
      // aparcamiento (z 38..48): coches, carritos tirados y un campamento abandonado
      M.put('coche', 9.0, 41.5, 0, 1, { col: 0x6a6e62 }); M.put('camioneta', 15.5, 42.0, 0, -1, { col: 0x2e3a2c });
      M.put('coche', 27.0, 41.6, 0, 1, { col: 0x4a4038 }); M.put('coche', 33.5, 45.5, 0, -1, { col: 0x26262a });
      M.put('carrito', 21.0, 40.2, 0.7, 0.7); M.put('carrito', 22.4, 44.6, -1, 0); M.put('carrito', 30.4, 39.4, 0, 1);
      M.put('fogata', 20.5, 49.5, 0, 1); M.put('refugio_lona', 15.5, 50.5, 1, 0); M.put('barricada', 25.6, 51.4, 0, 1);
      M.put('tablas', 11.2, 47.2, 0, 1); M.put('bidones', 28.6, 49.4, 0, 1);
      M.puddle(12, 45.5, 2.6, 1.3); M.puddle(30, 43, 2, 1.2);
      // descampado (sureste): montón de cadáveres quemados, escombros y algún árbol seco
      M.put('cadaveres', 47.0, 47.0, 0, 1); M.put('escombro_grande', 42.5, 43.5, 1, 0); M.put('escombro_grande', 51.0, 41.5, 0, 1);
      M.put('lona', 44.0, 51.5, 0, 1); M.put('palets', 50.5, 51.0, 1, 0);
      for (const [x, z] of [[41, 50], [52, 46], [44, 39]]) M.tree(x, z, false);
      // patio de carga (este, x 36..54, z 2..28): camión en el muelle, contenedores, palés y bidones
      M.put('camion', 41.5, 13.0, 0, 1, { col: 0xb8b4a8 }); M.put('montacargas', 38.6, 19.5, 1, 0);
      M.cont(48, 13, 'z', 6, 1); M.cont(48, 21, 'z', 6, 2);
      M.put('palets', 38.4, 5.0, 0, 1); M.put('palets', 40.6, 5.0, 0, 1); M.put('ibc', 44.0, 4.4, 0, 1);
      M.put('bidones', 37.2, 24.6, 1, 0); M.put('tubo', 44.0, 25.4, 1, 0); M.put('bloques', 52.0, 26.0, 0, 1);
      M.put('lona', 44.6, 8.6, 0, 1); M.put('barrera', 52.0, 16.0, 0, 1);
      M.tree(50, 4, false); M.tree(52, 8, true);
      // callejón de atrás (norte, z 2..8) y callejón del oeste (x 2..8): basura, escombros y una barricada
      M.put('cubos', 12.0, 3.4, 0, 1); M.put('cubos', 13.4, 3.4, 0, 1); M.put('bidones', 22.0, 3.0, 1, 0);
      M.put('palets', 27.5, 4.2, 0, 1); M.put('escombro_grande', 18.0, 5.4, 1, 0); M.put('barricada', 31.0, 5.0, 0, 1);
      M.put('cubos', 4.0, 14.0, 1, 0); M.put('tablas', 4.6, 20.0, 1, 0); M.put('valla_rota', 5.0, 25.0, 1, 0, { x0: 4.9, x1: 5.1, z0: 24.1, z1: 25.9 });
      M.put('escombros', 4.6, 10.0, 0, 1, { x0: 3.8, x1: 5.4, z0: 9.4, z1: 10.6 }); M.put('lona', 3.6, 4.0, 0, 1);
      M.puddle(16, 6, 2.4, 1.2); M.puddle(5, 17, 1.4, 2.2);
      // farolas (las que siguen encendidas tienen luz: ver outLamps)
      for (const [x, z] of [[17.5, 37], [43.5, 19.5], [5.5, 45.5], [30, 28.5], [8, 28.5], [36, 3]]) M.pole(x, z);
      M.building('arcade_b', AX, AZ, 26, 20, 'S', (c, b) => {
        // sin luces del techo: alumbran los neones (G.Maps.decor)
        for (const r of b.rooms) r.on = false;
      });
      const X = (x) => AX + x, Z = (z) => AZ + z;
      // ---- sala grande (x 3..23, z 4..16) ----
      // máquinas contra la pared norte (a los lados de la brecha), mirando al sur
      for (const x of [3.6, 4.45, 5.3, 6.15, 7.0]) M.put('maquina', X(x), Z(4.45), 0, 1);
      for (const x of [18.0, 18.85, 19.7, 21.55, 22.4]) M.put('maquina', X(x), Z(4.45), 0, 1);
      // contra la pared oeste, mirando al este (con huecos)
      for (const z of [6.2, 7.05, 7.9, 11.2, 12.05, 12.9]) M.put('maquina', X(3.42), Z(z), 1, 0);
      // pinballs contra la pared este
      for (const z of [6.0, 8.0, 12.6]) M.put('pinball', X(22.2), Z(z), -1, 0);
      // grúas y cambiador contra la pared sur
      M.put('grua', X(4.0), Z(15.45), 0, -1); M.put('grua', X(5.1), Z(15.45), 0, -1);
      M.put('cambio', X(21.8), Z(15.7), 0, -1);
      for (const x of [16.6, 17.45, 18.3]) M.put('maquina', X(x), Z(15.55), 0, -1);
      // dos islas de máquinas espalda con espalda
      for (const x of [6.6, 7.45, 8.3]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      for (const x of [17.4, 18.25, 19.1]) { M.put('maquina', X(x), Z(9.1), 0, -1); M.put('maquina', X(x), Z(9.9), 0, 1); }
      // hockey en el centro-sur, máquinas volcadas y un sofá destripado
      M.put('hockey', X(13.0), Z(13.6), 1, 0);
      M.put('maquina_rota', X(10.2), Z(6.6), 1, 0); M.put('maquina_rota', X(15.6), Z(12.6), 0, 1);
      M.put('sofa', X(9.5), Z(15.5), 0, -1);
      // hongos sobre la moqueta y escombros
      for (const [x, z, w, d] of [[13, 5.2, 3.2, 1.6], [5.5, 14.2, 2.4, 1.6], [20.6, 13.6, 2.2, 1.8], [11, 10.5, 1.6, 1.2], [16, 6.8, 1.8, 1.2], [4.2, 9.5, 1.4, 1.6]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - w / 2, x1: X(x) + w / 2, z0: Z(z) - d / 2, z1: Z(z) + d / 2 });
      for (const [x, z] of [[20.6, 14.2], [9.8, 13.2], [3.9, 5.2]]) M.put('escombros', X(x), Z(z), 0, 1, { x0: X(x) - 0.8, x1: X(x) + 0.8, z0: Z(z) - 0.6, z1: Z(z) + 0.6 });
      M.put('hongo_pared', X(9.0), Z(4.16), 0, 1);            // la mancha de hongo que delata la guarida
      M.put('hongo_pared', X(3.16), Z(14.6), 1, 0);
      // ---- trastienda (guarida, todo el lado norte): hongo por todas partes ----
      M.put('estante', X(4.2), Z(0.3), 0, 1); M.put('cajas', X(6.0), Z(0.6), 0, 1); M.put('cajas', X(20.8), Z(3.2), 0, 1);
      M.put('estante', X(21.8), Z(0.3), 0, 1); M.put('estante', X(1.0), Z(0.3), 0, 1); M.put('cajas', X(25.0), Z(1.0), 0, 1);
      for (const [x, z] of [[9, 1.5], [13, 2.2], [17.5, 1.4], [5, 2.8], [1.6, 2.6], [24.4, 2.8]]) M.put('hongos', X(x), Z(z), 0, 1, { x0: X(x) - 1.2, x1: X(x) + 1.2, z0: Z(z) - 0.8, z1: Z(z) + 0.8 });
      M.put('hongo_pared', X(13), Z(0.16), 0, 1); M.put('hongo_pared', X(9), Z(0.16), 0, 1); M.put('hongo_pared', X(17), Z(0.16), 0, 1);
      // ---- despacho (oeste, x 0..3): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('escritorio', X(0.75), Z(5.6), 1, 0); M.put('archivador', X(0.35), Z(7.6), 1, 0);
      M.put('archivador', X(0.35), Z(13.2), 1, 0); M.put('cajas', X(0.6), Z(15.2), 0, 1);
      M.put('escombros', X(1.2), Z(12.0), 0, 1, { x0: X(0.6), x1: X(1.8), z0: Z(11.6), z1: Z(12.4) });
      M.put('hongo_pared', X(0.16), Z(10.5), 1, 0);
      // ---- depósito (este, x 23..26): puertas a la sala (z 10) y al vestíbulo (z 18) ----
      M.put('estante', X(25.7), Z(5.6), -1, 0); M.put('estante', X(25.7), Z(7.6), -1, 0);
      M.put('estante', X(25.7), Z(13.0), -1, 0); M.put('cajas', X(25.4), Z(15.2), 0, 1);
      M.put('hongos', X(24.5), Z(9.0), 0, 1, { x0: X(23.6), x1: X(25.4), z0: Z(8.4), z1: Z(9.6) });
      // ---- vestíbulo (sur, z 16..20): puerta a la sala en x 13; mostrador de premios, máquinas y bancos ----
      M.put('mostrador', X(8.4), Z(18.2), 0, -1); M.put('mostrador', X(6.0), Z(18.2), 0, -1);
      M.put('banco_espera', X(17.5), Z(19.5), 0, -1);
      for (const x of [19.8, 20.65]) M.put('maquina', X(x), Z(16.45), 0, 1);
      M.put('grua', X(21.6), Z(19.4), 0, -1);
      M.put('hongos', X(10.8), Z(17.6), 0, 1, { x0: X(9.8), x1: X(11.8), z0: Z(17), z1: Z(18.2) });
    }
  };

  // ---------- Luces de neón (mapas cerrados) ----------
  // Pantallas de las máquinas, carteles de arriba, tubos de neón por las paredes y el techo y un cartel con el
  // nombre del local; brillan solos (sin luz de escena) y algunos parpadean (están rotos). Tres luces de
  // colores dan el tono a la sala. Se crean al cargar el mapa y se quitan al cambiar
  let decoG = null; const decoLights = [], decoFlick = [], decoMach = [], decoAnim = [];   // decoMach: lo de cada máquina (para destrozarla)
  const neonMat = (hex, op) => { const m = new THREE.MeshBasicMaterial({ color: hex, transparent: op != null, opacity: op == null ? 1 : op, depthWrite: op == null }); m.toneMapped = false; return m; };
  function signTex(text, col) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x = cv.getContext('2d');
    x.font = 'italic 900 78px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = col; x.shadowBlur = 26; x.fillStyle = col;
    x.fillText(text, 256, 66); x.shadowBlur = 10; x.fillText(text, 256, 66);
    x.shadowBlur = 0; x.fillStyle = '#fff6fb'; x.globalAlpha = 0.55; x.fillText(text, 256, 66);
    return new THREE.CanvasTexture(cv);
  }
  function decor(scene, id) {
    if (decoG) {
      scene.remove(decoG);
      decoG.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      decoG = null;
    }
    for (const l of decoLights) scene.remove(l);
    decoLights.length = 0; decoFlick.length = 0; decoMach.length = 0; decoAnim.length = 0;
    if (MAPS[id] && MAPS[id].flags) { beachDecor(scene, id); return decoG; }
    if (id !== 'arcade') return null;
    const P = prims(id), wallH = 4.2;
    decoG = new THREE.Group();
    const rng = U.mulberry32(1234);
    const SCR = [0x3fe6ff, 0xff3fa4, 0x7dff6a, 0xffd23f, 0x9b7bff];
    const plane = (w, h, mat, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0, 'YXZ'); decoG.add(m); return m; };
    const tube = (x, y, z, w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); decoG.add(m); return m; };
    // pantallas y carteles de cada máquina (las volcadas, apagadas)
    for (const f of P.furn) {
      if (f.type !== 'maquina' && f.type !== 'pinball') continue;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, ry = Math.atan2(f.fx, f.fz);
      const at = (lz, ly) => [cx + f.fx * lz, ly, cz + f.fz * lz];
      const col = SCR[Math.floor(rng() * SCR.length)];
      const dm = { x: cx, z: cz, parts: [], fl: [] };
      decoMach.push(dm);
      if (f.type === 'maquina') {
        const dead = rng() < 0.22;
        const sm = neonMat(dead ? 0x1a1a24 : col);
        const [sx, sy, sz] = at(0.142, 1.37);
        const s = plane(0.56, 0.44, sm, sx, sy, sz, ry);
        if (!dead) { const fl = { m: sm, base: new THREE.Color(col), k: 0.55 + rng() * 0.35, sp: 2 + rng() * 6, ph: rng() * 9, broken: rng() < 0.15 }; decoFlick.push(fl); dm.fl.push(fl); }
        const [mx, my, mz] = at(0.292, 1.79);
        dm.parts.push(s, plane(0.74, 0.1, neonMat(U.shade(SCR[Math.floor(rng() * SCR.length)], 0.9)), mx, my, mz, ry));
        s.renderOrder = 1;
      } else {
        const [bx, by, bz] = at(-0.515, 1.15);
        dm.parts.push(plane(0.62, 0.32, neonMat(col), bx, by, bz, ry));
      }
    }
    // tubos de neón por las paredes de la sala (con huecos y tramos rotos)
    const a = MAPS.arcade.arena.hall;
    // los neones, separados de la cara de la pared (la pared mide WALL_T: su cara queda a WALL_T / 2 de la línea)
    const IN = G.World.WALL_T / 2 + 0.045;
    const pink = neonMat(0xff3fa4), cyan = neonMat(0x3fe6ff), viol = neonMat(0xa05bff), yel = neonMat(0xffe23f);
    // pared sur (mirando al norte): franja rosa y cartel con el nombre
    tube((a.x0 + a.x1) / 2 - 3, 3.55, a.z1 - IN, 12, 0.05, 0.05, pink);
    tube(a.x0 + 5, 0.35, a.z1 - IN, 8.6, 0.04, 0.04, cyan);       // (cortada por la puerta del vestíbulo)
    tube(a.x1 - 4.5, 0.35, a.z1 - IN, 7.4, 0.04, 0.04, cyan);
    const sign = new THREE.MeshBasicMaterial({ map: signTex('GALAXIA', '#ff4fb0'), transparent: true, depthWrite: false }); sign.toneMapped = false;
    plane(4.6, 1.15, sign, (a.x0 + a.x1) / 2 - 1, 2.85, a.z1 - IN - 0.03, Math.PI);
    decoFlick.push({ m: sign, base: new THREE.Color(0xffffff), k: 1, sp: 1.3, ph: 0, broken: true, sign: true });
    // pared oeste: zigzag cian; pared este: ondas violeta; norte: franja amarilla (cortada por la brecha)
    for (let k = 0; k < 7; k++) { const t = tube(a.x0 + IN, 2.9 + (k % 2 ? 0.25 : -0.25), a.z0 + 1.2 + k * 1.4, 0.04, 0.05, 1.45, cyan); t.rotation.x = k % 2 ? 0.35 : -0.35; }
    for (let k = 0; k < 8; k++) { const t = tube(a.x1 - IN, 3.0 + Math.sin(k) * 0.2, a.z0 + 1 + k * 1.3, 0.04, 0.05, 1.32, k === 5 ? neonMat(0x2a1a3a) : viol); t.rotation.x = Math.cos(k) * 0.3; }
    tube(a.x0 + 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel); tube(a.x1 - 3.5, 3.4, a.z0 + IN, 5.5, 0.05, 0.04, yel);
    // techo: dos tubos largos (uno parpadea)
    const ct1 = neonMat(0xd8b0ff), ct2 = neonMat(0x9fe8ff);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z0 + 4, 13, 0.06, 0.06, ct1);
    tube((a.x0 + a.x1) / 2, wallH - 0.12, a.z1 - 4, 13, 0.06, 0.06, ct2);
    decoFlick.push({ m: ct2, base: new THREE.Color(0x9fe8ff), k: 1, sp: 7, ph: 2, broken: true });
    // luces de color: rosa al oeste, cian al este y violeta en el centro (dan el tono a todo)
    for (const [hex, x, z, I] of [[0xff4fa8, a.x0 + 4, (a.z0 + a.z1) / 2, 3.0], [0x47d8ff, a.x1 - 4, (a.z0 + a.z1) / 2, 3.0], [0x9a6bff, (a.x0 + a.x1) / 2, a.z0 + 5, 2.4]]) {
      const l = new THREE.PointLight(hex, I, 17, 1.3);
      l.position.set(x, 3.2, z);
      scene.add(l); decoLights.push(l);
    }
    // fuera: farolas de sodio que aún funcionan (una parpadea) y la luz que se cuela del cartel de la fachada
    for (const [x, z, hex] of MAPS.arcade.outLamps) {
      const l = new THREE.PointLight(hex, 2.2, 15, 1.4);
      l.position.set(x, 4.6, z);
      scene.add(l); decoLights.push(l);
      tube(x, 4.75, z, 0.5, 0.08, 0.22, neonMat(U.shade(hex, 1.2)));
    }
    const fs = new THREE.MeshBasicMaterial({ map: signTex('GALAXIA', '#ff4fb0'), transparent: true, depthWrite: false }); fs.toneMapped = false;
    plane(6.2, 1.55, fs, AX + 13, 3.4, AZ + 20 + 0.09, 0);
    decoFlick.push({ m: fs, base: new THREE.Color(0xffffff), k: 1, sp: 2.1, ph: 1, broken: true, sign: true });
    // la guarida: un resplandor anaranjado sucio que se cuela cuando se abre la pared
    const lg = new THREE.PointLight(0xff9a50, 0.9, 9, 1.6); lg.position.set(MAPS.arcade.arena.lair.x, 2.5, MAPS.arcade.arena.lair.z);
    scene.add(lg); decoLights.push(lg);
    scene.add(decoG);
    return decoG;
  }
  // ---------- Asentamiento en la playa: mar, espuma, banderas, estandartes, fuego y humo ----------
  const SCORP = 'M16 13 Q20 15 19 21 Q16 24 13 21 Q12 15 16 13 Z M16 13 Q16 9 18 7 Q21 5 22 8 Q22 10 20 10 L21 12 M14 22 Q11 24 10 27 L8 26 M10 27 L11 29 M18 22 Q21 24 22 27 L24 26 M22 27 L21 29 M13 16 L9 14 M13 18 L9 18 M13 20 L9 21 M19 16 L23 14 M19 18 L23 18 M19 20 L23 21';
  // la tela con el escorpión (granate oscuro, el emblema en ámbar dentro de un círculo, bordes deshilachados)
  function scorpTex(w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#6e1e16'); g.addColorStop(1, '#4a120e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,200,160,0.05)'; x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1); }
    const S = Math.min(w, h) * 0.8, ox = (w - S) / 2, oy = (h - S) / 2;
    x.save(); x.translate(ox, oy); x.scale(S / 32, S / 32);
    x.strokeStyle = '#f0a63a'; x.lineWidth = 1.6; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1.8; x.stroke(new Path2D(SCORP));
    x.restore();
    // bordes gastados
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) { x.fillRect(w - 2 - Math.random() * 6, Math.random() * h, 8, 2 + Math.random() * 4); x.fillRect(Math.random() * w, h - 2 - Math.random() * 4, 2 + Math.random() * 3, 6); }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function softTex(r, g, b) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.9)'); gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }
  function beachDecor(scene, id) {
    const m = MAPS[id], W = G.World;
    const ground = (x, z) => (W.terrainAt ? W.terrainAt(x, z) : (m.height ? m.height(x, z) : 0));
    decoG = new THREE.Group();
    // ---- el mar: un plano grande desde la orilla (z 89,6) hacia el sur, con un oleaje suave ----
    const SEA_Z = 89.6;
    const seaGeo = new THREE.PlaneGeometry(520, 240, 52, 24);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate(48, 0.14, SEA_Z + 120);
    const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ color: 0x46524f, transparent: true, opacity: 0.95 }));
    sea.receiveShadow = true;
    decoG.add(sea);
    const sp = seaGeo.attributes.position, base = Float32Array.from(sp.array);
    decoAnim.push((t) => {
      for (let i = 0; i < sp.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        const k = Math.min(1, (z - SEA_Z) / 6);
        sp.array[i * 3 + 1] = base[i * 3 + 1] + k * (Math.sin(x * 0.21 + t * 1.1) * 0.06 + Math.sin(z * 0.17 - t * 0.8) * 0.07);
      }
      sp.needsUpdate = true;
    });
    // brillos del sol bajo sobre el agua (destellos que aparecen y se van)
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.0, depthWrite: false });
    glintMat.toneMapped = false;
    const glints = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + Math.random() * 1.6, 0.05), glintMat.clone());
      g.rotation.x = -Math.PI / 2; g.position.set(10 + Math.random() * 80, 0.2, SEA_Z + 3 + Math.random() * 40);
      decoG.add(g); glints.push({ g, ph: Math.random() * 9, sp: 0.6 + Math.random() * 1.5 });
    }
    decoAnim.push((t) => { for (const q of glints) q.g.material.opacity = 0.55 * Math.max(0, Math.sin(t * q.sp + q.ph)) ** 3; });
    // la espuma: tres franjas que suben por la arena y se apagan (las olas)
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.5, depthWrite: false });
    const foams = [];
    for (let k = 0; k < 3; k++) {
      const fg = new THREE.PlaneGeometry(100, 0.5, 50, 1); fg.rotateX(-Math.PI / 2); fg.translate(48, 0, 0);
      const fm = new THREE.Mesh(fg, foamMat.clone()); decoG.add(fm);
      foams.push({ fm, fg, base: Float32Array.from(fg.attributes.position.array), ph: k / 3 });
    }
    decoAnim.push((t) => {
      for (const f of foams) {
        const u = (t * 0.09 + f.ph) % 1, a = Math.sin(Math.PI * u);
        const z = SEA_Z + 0.6 - u * 3.2;
        const P = f.fg.attributes.position;
        for (let i = 0; i < P.count; i++) {
          const x = f.base[i * 3], zz = z + f.base[i * 3 + 2] + Math.sin(x * 0.25 + f.ph * 6) * 0.35;
          P.array[i * 3 + 1] = Math.max(0.16, ground(x, zz) + 0.03); P.array[i * 3 + 2] = zz;
        }
        P.needsUpdate = true;
        f.fm.material.opacity = 0.55 * a;
      }
    });
    // ---- banderas en sus mástiles (ondean) ----
    const tex = scorpTex(256, 160);
    for (const [x, z, face, off] of m.flags) {
      const gy = ground(x, z) + (off || 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x4a4440 }));
      pole.position.set(x, gy + 2.3, z); pole.castShadow = true; decoG.add(pole);
      const fg = new THREE.PlaneGeometry(1.7, 1.06, 12, 4); fg.translate(0.85, 0, 0);
      const fl = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      fl.position.set(x, gy + 3.95, z); fl.rotation.y = (face || 0) * 0.9 + 0.5; fl.castShadow = true;
      decoG.add(fl);
      const fb = Float32Array.from(fg.attributes.position.array), ph = Math.random() * 6;
      decoAnim.push((t) => {
        const P = fg.attributes.position;
        for (let i = 0; i < P.count; i++) { const u = fb[i * 3]; P.array[i * 3 + 2] = Math.sin(u * 3.2 - t * 4.2 + ph) * 0.13 * u; P.array[i * 3 + 1] = fb[i * 3 + 1] - u * u * 0.06; }
        P.needsUpdate = true; fg.computeVertexNormals();
      });
    }
    // estandartes colgados en la fachada del museo
    const btex = scorpTex(128, 256);
    for (const [x, z] of m.banners) {
      const bg = new THREE.PlaneGeometry(1.5, 3.0, 2, 6);
      const b = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: btex }));
      b.position.set(x, ground(x, z + 1) + 3.1, z + 0.02); decoG.add(b);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a3430 }));
      rod.position.set(x, b.position.y + 1.53, z + 0.05); decoG.add(rod);
    }
    // ---- fuego (la hoguera y los barriles): llamas que bailan, luz que tiembla y humo que sube ----
    const smokeT = softTex(120, 112, 104), flameMat = (c) => { const mm = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }); mm.toneMapped = false; return mm; };
    let nl = 0;
    for (const [x, z, big] of m.fires) {
      const gy = ground(x, z) + (big ? 0.12 : 0.98);
      const fg = new THREE.Group(); fg.position.set(x, gy, z); decoG.add(fg);
      const cones = [];
      for (let k = 0; k < (big ? 5 : 3); k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(big ? 0.22 : 0.15, big ? 0.9 : 0.55, 6), flameMat(k % 2 ? 0xffb040 : 0xff6a1a));
        c.position.set((Math.random() - 0.5) * (big ? 0.35 : 0.2), (big ? 0.4 : 0.25), (Math.random() - 0.5) * (big ? 0.35 : 0.2));
        fg.add(c); cones.push({ c, ph: Math.random() * 9 });
      }
      let light = null;
      if (nl < 3) { light = new THREE.PointLight(0xff8a3a, big ? 2.4 : 1.4, big ? 11 : 7, 1.5); light.position.set(x, gy + 0.8, z); scene.add(light); decoLights.push(light); nl++; }
      const puffs = [];
      for (let k = 0; k < 7; k++) {
        const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeT, transparent: true, depthWrite: false, opacity: 0 }));
        decoG.add(sm); puffs.push({ sm, t: k / 7 });
      }
      decoAnim.push((t, dt) => {
        for (const q of cones) { const s = 0.75 + 0.35 * Math.sin(t * 9 + q.ph) * Math.sin(t * 5.3 + q.ph * 2); q.c.scale.set(1, s, 1); }
        if (light) light.intensity = (big ? 2.4 : 1.4) * (0.8 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.7));
        for (const p of puffs) {
          p.t += (dt || 0.016) * 0.18; if (p.t > 1) p.t -= 1;
          p.sm.position.set(x + Math.sin(p.t * 5 + t * 0.3) * 0.3 + p.t * 0.8, gy + 0.8 + p.t * 4.5, z + p.t * 0.4);
          const s = 0.5 + p.t * 2.2; p.sm.scale.set(s, s, 1);
          p.sm.material.opacity = 0.35 * Math.sin(Math.PI * p.t);
        }
      });
    }
    // farol encendido sobre las mesas del comedor (un punto de luz cálida)
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffd890 }); lampM.toneMapped = false;
    for (const f of prims(id).furn) {
      if (f.type !== 'mesa_campo') continue;
      const lx = Math.abs(f.fz) > 0.5 ? (f.x0 + f.x1) / 2 - (f.x1 - f.x0) / 2 + 0.15 : (f.x0 + f.x1) / 2, lz = (f.z0 + f.z1) / 2 + 0.25;
      const lm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.21, 0.11), lampM); lm.position.set(lx, ground(lx, lz) + 0.94, lz);
      decoG.add(lm);
    }
    scene.add(decoG);
  }

  // una máquina destrozada: se apagan (y quitan) su pantalla y su cartel
  function killDecor(x, z) {
    for (let i = decoMach.length - 1; i >= 0; i--) {
      const d = decoMach[i];
      if (Math.hypot(d.x - x, d.z - z) > 0.5) continue;
      for (const p of d.parts) p.visible = false;
      for (const fl of d.fl) { const k = decoFlick.indexOf(fl); if (k >= 0) decoFlick.splice(k, 1); }
      decoMach.splice(i, 1);
    }
  }
  // parpadeo de las pantallas y de los neones rotos
  let decoT = 0;
  function updateDecor(dt) {
    if (!decoG) return;
    decoT += dt;
    for (const f of decoAnim) f(decoT, dt);
    for (const d of decoFlick) {
      let v = d.k + (1 - d.k) * (0.5 + 0.5 * Math.sin(decoT * d.sp + d.ph));
      if (d.broken) { const n = Math.sin(decoT * 23 + d.ph) * Math.sin(decoT * 7.3 + d.ph * 2); if (n > 0.55) v *= 0.12; }
      if (d.sign) d.m.opacity = v; else d.m.color.copy(d.base).multiplyScalar(v);
    }
  }

  // ---------- Horizonte lejano ----------
  // Siluetas de la ciudad (y grúas, torres, árboles) alrededor del mapa, a unos 44 m de la cámara y sin niebla
  // propia: van con la cámara (como un cielo), en tonos que se funden con la neblina del cielo
  let sky = null;
  let skyBeam = null;
  function skyline(scene, id) {
    if (sky) { scene.remove(sky); sky.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); sky = null; skyBeam = null; }
    const m = id && MAPS[id];
    if (!m || !m.skyline) return null;
    if (m.skyline.beach) return beachSky(scene, m);
    const rng = U.mulberry32((m.seed || 7) + 99);
    const M = new G.Mesher();
    const R = 44, base = -6;
    const col = (k) => U.shade(m.skyline.col, k);
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    // edificios en la distancia (dos capas: lejos más claros)
    for (const [r, k, n] of [[R + 6, 1.1, 46], [R, 0.95, 34]]) {
      for (let i = 0; i < n; i++) {
        const a = (i + rng() * 0.6) / n * Math.PI * 2;
        const [x, z] = at(a, r);
        const h = m.skyline.h[0] + rng() * (m.skyline.h[1] - m.skyline.h[0]);
        const w = 4 + rng() * 7;
        M.box(x, base + h / 2, z, w, h, 3, col(k * (0.92 + rng() * 0.12)), a);
        if (rng() < 0.35) M.box(x + (rng() - 0.5) * 2, base + h + 1.2, z, 1.2, 2.4, 1.2, col(k * 0.95), a);
      }
    }
    // grúas portuarias y una torre (terminal)
    for (const c of m.skyline.cranes || []) {
      const [x, z] = at(c, R - 2);
      const H = 26;
      for (const s of [-1, 1]) M.box(x + Math.cos(c) * s * 2.5, base + H / 2, z - Math.sin(c) * s * 2.5, 0.6, H, 0.6, col(0.8), c);
      M.box(x, base + H, z, 7, 1.2, 1.2, col(0.8), c);
      M.box(x + Math.sin(c) * -5, base + H + 3, z + Math.cos(c) * -5, 0.6, 0.6, 18, col(0.8), c);
      M.box(x, base + H + 4, z, 0.4, 8, 0.4, col(0.8), c);
    }
    for (const t of m.skyline.towers || []) {
      const [x, z] = at(t, R + 2);
      M.box(x, base + 16, z, 4, 32, 4, col(0.88), t);
      M.box(x, base + 33, z, 2.5, 4, 2.5, col(0.86), t);
      M.box(x, base + 37, z, 1, 6, 1, col(0.86), t);
    }
    // copas de árboles entre los edificios
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, [x, z] = at(a, R - 4);
      M.box(x, base + 6 + rng() * 3, z, 3 + rng() * 3, 6 + rng() * 5, 3, col(0.78), a);
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
    sky = new THREE.Mesh(M.build(), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    return sky;
  }
  // Luz del horizonte (día y noche, clima: G.Sky): oscurece los montes y edificios lejanos y los tiñe del
  // color del cielo. La linterna y los haces del faro no (de noche se ven más)
  function skyTint(k, col, amt) {
    if (!sky) return;
    sky.traverse((o) => {
      const m = o.material;
      if (!m || !m.color) return;
      if (m.blending === THREE.AdditiveBlending) { if (m.userData.op0 == null) m.userData.op0 = m.opacity; m.opacity = Math.min(0.9, m.userData.op0 * (1 + (1 - k) * 1.6)); return; }
      if (m.toneMapped === false) return;
      if (!m.userData.c0) m.userData.c0 = m.color.clone();
      m.color.copy(m.userData.c0).lerp(col, amt).multiplyScalar(k * k);          // (k*k: los colores van en lineal)
    });
  }
  function followSky(cam) {
    if (sky && cam) sky.position.set(cam.position.x, 0, cam.position.z);
    if (skyBeam) { const t = performance.now() / 1000; skyBeam.rotation.y = t * 0.7; }
  }
  // La playa: montes de otoño hacia tierra (norte, este y oeste) y, sobre el mar, el cabo con el faro (el de la
  // pantalla de inicio: torre blanca, linterna roja y la luz que gira)
  function beachSky(scene, m) {
    const rng = U.mulberry32((m.seed || 7) + 99);
    const M = new G.Mesher();
    const R = 48, base = -5;
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    const col = (c, k) => U.shade(c, k);
    // montes: dos capas, la de lejos más clara y rosada (como en el inicio); solo hacia tierra
    for (const [r, c, hh, n] of [[R + 8, 0xb8a49a, [10, 22], 60], [R, 0x8e8270, [6, 13], 70]]) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 0.42 + (i + rng()) / n * Math.PI * 1.16;
        const [x, z] = at(a, r), h = hh[0] + rng() * (hh[1] - hh[0]);
        M.cone(x, base + h / 2, z, 6 + rng() * 6, h, col(c, 0.9 + rng() * 0.15), 6);
      }
    }
    // copas de árboles de otoño delante de los montes
    for (let i = 0; i < 60; i++) {
      const a = Math.PI * 0.45 + rng() * Math.PI * 1.1, [x, z] = at(a, R - 5);
      M.sphere(x, base + 7 + rng() * 2, z, 2 + rng() * 2, 2 + rng() * 1.5, 2 + rng() * 2, U.pick(rng, [0xa87a52, 0xb89262, 0x9a6a4a, 0x8a8058]), 0);
    }
    // el cabo del faro, sobre el mar al suroeste
    const fa = -0.62, [fx, fz] = at(fa, R + 14);
    for (let k = 0; k < 9; k++) M.sphere(fx + (rng() - 0.5) * 16, base + 2 + rng() * 3, fz + (rng() - 0.5) * 6, 5 + rng() * 5, 3 + rng() * 3, 3 + rng() * 3, col(0x6a5e56, 0.85 + rng() * 0.2), 0);
    // el faro: torre troncocónica blanca con dos franjas rojas, el balcón con barandilla, la linterna de
    // cristal (encendida), la cúpula roja con su remate y, al pie, la casa del farero con tejado a dos aguas
    const ty = base + 6.5, TH = 12;
    M.cyl(fx, ty + TH / 2, fz, 1.35, 0.92, TH, 0xe4dcd0, 14);
    for (const y of [ty + 3.2, ty + 7.6]) M.cyl(fx, y, fz, 1.27 - (y - ty) * 0.036, 1.2 - (y - ty) * 0.036, 1.1, 0xa83a2e, 14);
    for (let k = 0; k < 3; k++) { const r = 1.3 - k * 0.12; M.box(fx - Math.sin(fa) * r, ty + 1.8 + k * 3.6, fz - Math.cos(fa) * r, 0.3, 0.5, 0.1, 0x3a3634, fa); }   // ventanucos
    M.cyl(fx, ty + TH + 0.1, fz, 1.45, 1.45, 0.22, 0x3a3634, 16);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; M.box(fx + Math.sin(a) * 1.38, ty + TH + 0.55, fz + Math.cos(a) * 1.38, 0.05, 0.7, 0.05, 0x3a3634); }
    M.cyl(fx, ty + TH + 0.88, fz, 1.42, 1.42, 0.05, 0x3a3634, 16);
    M.cyl(fx, ty + TH + 0.35, fz, 0.8, 0.8, 0.3, 0xe4dcd0, 12);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; M.box(fx + Math.sin(a) * 0.74, ty + TH + 1.2, fz + Math.cos(a) * 0.74, 0.06, 1.4, 0.06, 0x2a2624); }
    M.cone(fx, ty + TH + 2.25, fz, 0.92, 0.75, 0xa83a2e, 12);
    M.cyl(fx, ty + TH + 2.75, fz, 0.06, 0.06, 0.5, 0x2a2624, 6);
    M.sphere(fx, ty + TH + 3.05, fz, 0.13, 0.13, 0.13, 0x2a2624, 0);
    // casa del farero
    const hx = fx + Math.cos(fa) * 3.4, hz = fz - Math.sin(fa) * 3.4;
    M.box(hx, ty + 1.2, hz, 4.2, 2.4, 3.0, 0xe8e0d4, -fa);
    for (const s2 of [-1, 1]) M.box(hx, ty + 2.85, hz + s2 * 0.0, 4.5, 0.12, 1.9, 0xa83a2e, -fa, undefined, s2 * 0.62, 0);
    M.box(hx, ty + 3.05, hz, 4.5, 0.6, 0.2, 0x8a2e24, -fa);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(M.build(), mat);
    mesh.renderOrder = -10; mesh.frustumCulled = false;
    sky = new THREE.Group(); sky.add(mesh);
    // la linterna encendida y dos haces que giran (se desvanecen hacia fuera)
    const lm = new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false, depthWrite: false }); lm.toneMapped = false;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 1.3, 12), lm); lamp.position.set(fx, ty + TH + 1.2, fz); lamp.renderOrder = -9; sky.add(lamp);
    const gcv = document.createElement('canvas'); gcv.width = 4; gcv.height = 128;
    const gx = gcv.getContext('2d'), gg = gx.createLinearGradient(0, 0, 0, 128);
    gg.addColorStop(0, 'rgba(255,242,205,0.95)'); gg.addColorStop(0.35, 'rgba(255,242,205,0.35)'); gg.addColorStop(1, 'rgba(255,242,205,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 4, 128);
    const gt = new THREE.CanvasTexture(gcv);
    skyBeam = new THREE.Group(); skyBeam.position.set(fx, ty + TH + 1.2, fz);
    for (const s2 of [0, Math.PI]) {
      const bg = new THREE.ConeGeometry(1.9, 26, 12, 1, true); bg.translate(0, -13, 0); bg.rotateZ(Math.PI / 2);
      const bm = new THREE.MeshBasicMaterial({ map: gt, color: 0xffffff, transparent: true, opacity: 0.32, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); bm.toneMapped = false;
      const beam = new THREE.Mesh(bg, bm); beam.renderOrder = -9; beam.rotation.y = s2; skyBeam.add(beam);
    }
    sky.add(skyBeam);
    sky.frustumCulled = false;
    scene.add(sky);
    return sky;
  }
  // ---------- Vista previa (modo libre: el panel de los mapas) ----------
  // Un plano visto desde arriba, dibujado con lo que tiene el mapa (suelo, edificios, contenedores, muebles y
  // árboles). 'libre': el campo de pruebas. Se guarda como imagen (data URL)
  const PREV = {};
  function preview(id) {
    if (PREV[id]) return PREV[id];
    if (typeof document === 'undefined') return '';
    const S = 220, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    const F = G.World.F;
    const GC = { [F.GRASS]: '#56693e', [F.ROAD]: '#4a4b4d', [F.SIDEWALK]: '#8e8a80', [F.DIRT]: '#6b5a44' };
    if (id === 'libre' || !MAPS[id]) {
      x.fillStyle = '#5d7d43'; x.fillRect(0, 0, S, S);
      x.strokeStyle = '#d8cfb8'; x.lineWidth = 3; x.strokeRect(14, 14, S - 28, S - 28);
      x.fillStyle = '#c9b48a'; x.fillRect(40, 150, 30, 12); x.fillRect(150, 150, 30, 12); x.fillRect(96, 152, 28, 8);
      x.fillStyle = '#3f5a2f'; for (const [a, b] of [[50, 60], [160, 70], [110, 40], [70, 110]]) { x.beginPath(); x.arc(a, b, 9, 0, 6.3); x.fill(); }
      x.fillStyle = '#bdb6a8'; x.fillRect(60, 80, 46, 30); x.fillRect(130, 100, 40, 26);
    } else {
      const m = MAPS[id], P = prims(id), A = m.min - 1, B = m.max + 1, k = S / (B - A);
      const R = (x0, z0, w, d) => x.fillRect((x0 - A) * k, (z0 - A) * k, w * k, d * k);
      x.fillStyle = '#121014'; x.fillRect(0, 0, S, S);
      for (const [x0, z0, x1, z1, g] of P.ground) { x.fillStyle = GC[g] || '#4a4b4d'; R(x0, z0, x1 - x0, z1 - z0); }
      for (const bd of P.blds) {
        const def = G.Buildings.DEFS.find((d) => d.id === bd.id); if (!def) continue;
        const rot = bd.front === 'E' || bd.front === 'W';
        const w = rot ? def.h : def.w, d = rot ? def.w : def.h;
        x.fillStyle = id === 'arcade' ? '#3a2f55' : '#8c8f8a'; R(bd.ox, bd.oz, w, d);
        if (def.rooms) {
          x.strokeStyle = 'rgba(20,16,24,0.8)'; x.lineWidth = 1.5;
          for (const r of def.rooms) x.strokeRect((bd.ox + r[0] - A) * k, (bd.oz + r[1] - A) * k, r[2] * k, r[3] * k);
        }
      }
      for (const c of P.conts) {
        if (c.lod) continue;
        x.fillStyle = ['#9a4a32', '#3f6a8a', '#5f7a3a', '#a07a2a'][(c.x * 7 + c.z * 3) % 4];
        R(c.x + 0.1, c.z + 0.1, c.w - 0.2, c.d - 0.2);
      }
      for (const f of P.furn) {
        const t = G.Furniture.T[f.type];
        if (!t || f.type === 'charco') continue;
        x.fillStyle = t.vehicle ? '#c9c2b0' : (f.type === 'hongos' ? '#b8865a' : (f.type === 'maquina' || f.type === 'pinball' ? '#d84fa0' : '#9a8a6a'));
        R(f.x0, f.z0, f.x1 - f.x0, f.z1 - f.z0);
      }
      x.fillStyle = '#2f4a26';
      for (const [ox, oz] of P.obj) { x.beginPath(); x.arc((ox + 0.5 - A) * k, (oz + 0.5 - A) * k, 1.6 * k, 0, 6.3); x.fill(); }
      // el punto de inicio
      x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc((m.spawn.x - A) * k, (m.spawn.z - A) * k, 4, 0, 6.3); x.fill();
    }
    PREV[id] = cv.toDataURL('image/png');
    return PREV[id];
  }

  G.Maps = {
    preview,
    skyline, followSky, skyTint,
    LEVEL_H,
    get(id) { return MAPS[id] || null; },
    // los mapas de los enfrentamientos normales (sin los exclusivos del jefe) y todos (modo libre)
    list() { return Object.keys(MAPS).filter((k) => !MAPS[k].boss && !MAPS[k].hidden); },
    listAll() { return Object.keys(MAPS).filter((k) => !MAPS[k].hidden); },
    decor, updateDecor, killDecor,
    apply,
    prims
  };
})(window.Game = window.Game || {});
