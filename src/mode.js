(function (G) {
  'use strict';

  // Enfrentamientos (modo Retorno; inspirados en los modos por oleadas de referencia, con reglas propias):
  //
  //   ASALTO  preparación (20 s, «OLEADA ENTRANTE») → oleada 1/3 → «PRÓXIMA OLEADA EN…» → 2/3 → … → 3/3 →
  //           «ENFRENTAMIENTO COMPLETADO» → «REGRESANDO AL REFUGIO» → estadísticas.
  //           Los infectados nunca aparecen juntos: cada uno sale lejos de los demás, repartidos por el mapa.
  //             oleada 1: 3 (a veces 4): corredores y algún acechador
  //             oleada 2: 5 (a veces 6): corredores, acechadores y chasqueadores (como mucho 3)
  //             oleada 3: 6 (a veces 7): de todo, con un temblante (muy de vez en cuando, 2)
  //           Al despejar cada oleada aparece un cofre con suministros (se cogen a mano, sin menús).
  //
  //   CAZA    aguanta hasta que se acabe el tiempo. Los infectados llegan sin parar (como mucho 12 a la vez) y
  //           cada vez más seguido cuanto menos falta. Sin temblantes; algunos chasqueadores, muchos corredores
  //           y pocos acechadores.
  //
  //   ESCUADRÓN un grupo de humanos armados llega para limpiar la zona (ver humans.js). Se gana cuando no queda
  //           ninguno: muertos, huidos o perdonados. Nunca hay infectados a la vez.
  //
  //   JEFE    (salón recreativo) un tiempo de saqueo para fabricar curas, molotovs y minas; al acabar, el
  //           hongomorfo derriba la pared de la trastienda (siempre la misma) y entra. Cuando le queda la mitad
  //           de la vida, sale de la misma pared un blindado que se esconde en los huecos que va abriendo.
  //           Se gana al acabar con los dos.
  //
  // Los infectados a veces sueltan algo al morir (munición, materiales o una chocolatina que cura un poco).
  // Desafío de cada enfrentamiento: agarrar y matar a uno por sorpresa (recompensa: 2 vendas).
  // En este modo los mordiscos hacen daño pero no infectan.

  const U = G.Util;
  const TAU = Math.PI * 2;
  const SPEAKER = 'Vera';
  const SAQUEO_T = 210, RESIST_T = 210, CRACK_T = 6;      // saqueo: 3 min 30 s; resistencia: 3 min 30 s; abrir la caja: 6 s
  const PREP = 20, BETWEEN = 20, RETURN = 12, BANNER = 4, BOSS_PREP = 45;
  const CAZA_MAX = 12;
  const MAX_CORPSES = 8;
  // probabilidad de soltar algo al morir
  const DROP = { runner: 0.22, stalker: 0.3, blind: 0.35, temb: 0.8 };   // probabilidad de soltar algo al morir (poco: el botín escasea)
  // estados en los que un infectado de la oleada ya te ha descubierto
  const HUNT_ON = { hburst: 1, hgrab: 1, hrip: 1, hkill: 1, chase: 1, alert: 1, attack: 1, stalk: 1, hide: 1, combo: 1, runatk: 1, grapple: 1, recover: 1, ambush: 1, tcharge: 1, tdash: 1, troar: 1, tthrow: 1 };
  const BARKS = {
    start: ['Vamos allá.', 'Que vengan.', 'Respira... tú puedes.'],
    wave: ['Ahí vienen.', 'Los oigo.', 'Prepárate.'],
    blind: ['Chasqueadores. Sin hacer ruido.', 'Ese no ve... pero oye.'],
    temb: ['Eso es enorme...', 'Un temblante. Mantén la distancia.'],
    kill: ['Uno menos.', 'Quieto.', 'Ya está.', 'Fuera.', 'No te levantes.'],
    free: ['¡Suéltame!', '¡Aparta!', '¡Quita de encima!'],
    stealth: ['Shh...', 'Tranquilo... duérmete.'],
    last: ['Queda uno.', 'El último.'],
    clear: ['Bien.', 'Despejado.', 'Por ahora...'],
    chest: ['Suministros. Bien.', 'Hay un cofre por ahí.'],
    done: ['Lo logramos.', 'Hora de volver.'],
    hurry: ['Ya casi...', 'Aguanta un poco más.'],
    hurt: ['¡Ah!', '¡Agh!'],
    bossPrep: ['Hay algo detrás de esa pared.', 'Rápido: coge todo lo que puedas.', 'Molotovs, minas, vendas... lo que sea.'],
    bossThump: ['¿Qué ha sido eso?', 'Eso es grande... muy grande.'],
    boss: ['¿Qué demonios es eso?', 'No dejes que te agarre...', 'Es enorme...'],
    outside: ['Ha tirado la pared... estamos fuera.', 'Acechadores. Los atrajo el ruido.', 'Ahora tiene con qué alimentarse.'],
    bossAte: ['Se los está comiendo...', 'Se cura comiéndoselos. No le dejes.', 'Cada uno que se come, más fuerte.'],
    nemi: ['Hay algo más ahí dentro...', '¿Oyes eso? Chasquidos...', 'Algo se mueve entre los escombros.'],
    bossDead: ['Cae... por fin.', 'Se acabó, grandullón.'],
    reload: ['Recargando.', 'Cubridme... ah, no hay nadie.'],
    squad: ['Escorpiones. Cuidado.', 'Los Escorpiones... peores que los infectados.', 'Es el grupo de los Escorpiones. Vienen a por todo.'],
    revenge: ['Ahí vienen. Muchos más.', 'Cumplió su palabra... trajo a todo su grupo.', 'Ese es el grupo. Prepárate.'],
    resist: ['Aguanta. Yo te cubro.', 'No dejaremos que te toquen.'],
    partial: ['No hubo tiempo... algo es algo.', 'Nos vamos con las manos casi vacías.'],
    warned: ['Va a volver con más. Aprovecha para prepararte.', 'Se escapó uno. Esto no ha terminado.'],
    squadDone: ['Se acabó. Ya no queda nadie.', 'Zona limpia... para mí.']
  };
  // humanos: en la barra del escuadrón, un muñeco por cada uno que queda (con el color de su papel)
  const H_ICON = { lider: 'hl', tirador: 'ht', pistolero: 'hp', arquero: 'ha', escopetero: 'he', bruto: 'hb', sigilo: 'hs', saqueador: 'hq', explorador: 'hx', carronero: 'hc' };

  let scene = null, player = null;
  let st = null;            // estado del enfrentamiento
  const el = (id) => document.getElementById(id);
  const $ = {};

  function newStats() {
    return { kills: 0, melee: 0, exec: 0, gunKills: 0, head: 0, shots: 0, hits: 0, stun: 0, escapes: 0, hurt: 0, stealth: 0, thrown: 0, picked: 0, time: 0 };
  }
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  // más enemigos en los mapas grandes (la playa): el mapa lo dice con enemyMul
  // cuántos enemigos más: el mapa (los grandes, más) y la hora (G.Sky: de noche, más infectados y más
  // acechadores; de día, contra los Escorpiones, más de ellos)
  function emul() {
    const m = G.Maps && G.Maps.get(G.World.layout);
    return ((m && m.enemyMul) || 1) * (G.Sky ? G.Sky.enemyMul(!!(st && st.humans)) : 1);
  }
  const mul = (n, cap) => Math.min(cap || 99, Math.round(n * emul()));
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // Composición de cada oleada del asalto
  function waveQueue(n) {
    const q = [];
    const add = (kind, k) => { for (let i = 0; i < k; i++) q.push({ kind }); };
    if (n === 1) {
      const total = Math.random() < 0.25 ? 4 : 3;
      const stalk = Math.random() < 0.45 ? 1 : 0;
      add('stalker', stalk); add('runner', total - stalk);
      return shuffle(q);
    }
    if (n === 2) {
      // como mucho 4; rara vez se cuela un chaskeado, y más rara vez aún un temblante
      const total = Math.random() < 0.3 ? 3 : 4;
      const blind = Math.random() < 0.15 ? 1 : 0;
      const temb = Math.random() < 0.08 ? 1 : 0;
      const stalk = Math.random() < 0.6 ? 1 : 0;
      add('blind', blind); add('temb', temb); add('stalker', stalk); add('runner', Math.max(1, total - blind - temb - stalk));
      return shuffle(q);
    }
    // oleada 3: a veces (3 de cada 10) dos temblantes; entonces son 5: 2 temblantes, 1 chaskeado, 1 acechador y 1 corredor
    if (Math.random() < 0.3) {
      add('blind', 1); add('stalker', 1); add('runner', 1);
      shuffle(q);
      q.splice(1, 0, { kind: 'temb' }); q.splice(3, 0, { kind: 'temb' });
      return q;
    }
    const total = Math.random() < 0.25 ? 7 : 6;
    const temb = 1;
    const blind = rint(1, 2), stalk = rint(1, 2);
    add('blind', blind); add('stalker', stalk); add('runner', Math.max(1, total - temb - blind - stalk));
    shuffle(q);
    // el temblante llega a mitad de la oleada (no el primero)
    for (let i = 0; i < temb; i++) q.splice(Math.min(q.length, 2 + i * 2), 0, { kind: 'temb' });
    return q;
  }
  function cazaKind() {
    const r = Math.random(), nk = G.Sky && G.Sky.night ? 0.12 : 0;      // (de noche, más acechadores)
    return r < 0.64 - nk ? 'runner' : (r < 0.86 - nk ? 'blind' : 'stalker');
  }

  const Mode = {
    active: false, fighting: false, stats: null, onMessage: null, onFinish: null, onFade: null,
    retorno: false,

    init(sc, pl) {
      scene = sc; player = pl;
      for (const k of ['mode-hud', 'm-title', 'm-timer', 'm-tlabel', 'm-tval', 'm-wave', 'm-wlabel', 'm-bar', 'm-icons', 'm-chal', 'm-cn', 'm-banner', 'm-btext', 'm-sub', 'm-stats', 'm-rows', 'm-total']) $[k] = el(k);
    },

    // Empieza un enfrentamiento. opts: { type: 'asalto' | 'caza', time (caza, segundos), retorno }
    start(opts) {
      opts = opts || {};
      this.active = true; this.fighting = false;
      this.retorno = !!opts.retorno;
      this.stats = newStats();
      G.Combat.stats = this.stats;
      // las cuatro modalidades: asalto, caza, saqueo (solo escorpiones) y resistencia (solo infectados); y el jefe.
      // (el «escuadrón» de antes es ahora el saqueo)
      const type = { caza: 1, jefe: 1, saqueo: 1, resistencia: 1 }[opts.type] ? opts.type : (opts.type === 'escuadron' ? 'saqueo' : 'asalto');
      st = { type, phase: 'prep', t: type === 'caza' ? 8 : (type === 'jefe' ? BOSS_PREP : (type === 'saqueo' ? 8 : (type === 'resistencia' ? 15 : PREP))), thumpT: 6, wave: 0, queue: [], spawnT: 0, list: [], corpses: [], seen: new Set(), barkT: 0, chal: false, titleT: 7,
        hurtHp: player.health, blindT: 0, total: type === 'caza' ? (opts.time || 150) : 0, left: 0, cazaN: 0, cases: [],
        humans: !!G.Humans && (type === 'saqueo' || ((type === 'asalto' || type === 'caza') && !!opts.humans)) };
      if (type === 'saqueo') st.total = opts.time || SAQUEO_T;
      if (type === 'resistencia') st.total = opts.time || RESIST_T;
      if (G.Run && G.Run.setEncMul) G.Run.setEncMul(1);
      // equipo de salida fuera de una carrera (prueba suelta): pistola con el cargador lleno, algo de munición y una venda
      if (!this.retorno && !G.DEV && opts.kit !== false) {   // (kit: false = con lo que llevas)
        player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        player.ammo['9mm'] = 6;
        player.items.venda = Math.max(player.items.venda, 1);
        player.equip(-1);
      }
      player.noInfect = true;
      if (type === 'jefe') this.startBoss();
      else if (type === 'saqueo') { this.startSaqueo(opts); G.Pickups.spawn(10, { weights: { ladrillo: 2, botella: 2, alcohol: 1.4, trapo: 1, _ammo: 5.2, clavos: 0.6, polvo: 0.25 } }); G.Pickups.spawnMelee(2 + (Math.random() < 0.5 ? 1 : 0)); G.Pickups.spawn(3, { weights: { _ammo: 1 }, gap: 3.5 }); }
      else { if (type === 'resistencia') this.startResist(opts); G.Pickups.spawn(9, { weights: { ladrillo: 2, botella: 2, alcohol: 1.4, trapo: 1, _ammo: 5, clavos: 0.6, polvo: 0.25 } }); G.Pickups.spawnMelee(2 + (Math.random() < 0.5 ? 1 : 0)); G.Pickups.spawn(3, { weights: { _ammo: 1 }, gap: 3.5 }); }
      $['mode-hud'].classList.remove('hidden');
      $['m-chal'].classList.toggle('hidden', type === 'jefe');
      $['m-title'].innerHTML = type === 'caza' ? (st.humans ? '<b>'+'<i class="m-logo">' + G.Refugio.PING_LOGO + '</i>'+'CAZA</b><span>LOS ESCORPIONES TE BUSCAN</span>' : '<b>CAZA</b><span>AGUANTA HASTA EL REGRESO</span>') : (type === 'jefe' ? '<b>JEFE FINAL</b><span>SOBREVIVE AL HONGOMORFO</span>' : (type === 'saqueo' ? '<b>'+'<i class="m-logo">' + G.Refugio.PING_LOGO + '</i>'+'SAQUEO</b><span>ROBA LA CAJA FUERTE DE LOS ESCORPIONES</span>' : (type === 'resistencia' ? '<b>RESISTENCIA</b><span>PROTEGE A ' + (st.ally ? st.ally.name.toUpperCase() : 'TU COMPAÑERO') + '</span>' : (st.humans ? '<b>'+'<i class="m-logo">' + G.Refugio.PING_LOGO + '</i>'+'ASALTO</b><span>LOS ESCORPIONES RONDAN LA ZONA</span>' : '<b>ASALTO</b><span>DESPEJA CADA OLEADA</span>'))));
      $['m-title'].classList.remove('hidden', 'out');
      $['m-wave'].classList.add('hidden');
      $['m-banner'].classList.add('hidden');
      $['m-stats'].classList.add('hidden');
      this.setTimer(this.prepLabel(), st.t);
      this.renderChal();
      setTimeout(() => this.bark(type === 'jefe' ? 'bossPrep' : (st.humans ? 'squad' : (type === 'resistencia' ? 'resist' : 'start'))), 1200);
    },
    prepLabel() { if (st.type === 'saqueo') return 'EL RELOJ EMPIEZA EN'; if (st.type === 'resistencia') return 'PREPARA LA DEFENSA'; if (st.humans) return 'SE OYEN VOCES CERCA'; return st.type === 'caza' ? 'LOS INFECTADOS SE ACERCAN' : (st.type === 'jefe' ? 'ALGO SE MUEVE TRAS LA PARED' : (st.type === 'escuadron' ? 'UN GRUPO ARMADO SE ACERCA' : 'OLEADA ENTRANTE')); },

    // ---------- Escuadrón (humanos) ----------
    // llega por el lado del mapa más lejos de ti; quietos (charlando) hasta que acaba la preparación
    startSquad(opts) {
      if (!G.Humans) return;
      const z0 = this.farZone() || { x: G.World.ARENA_MIN + 4, z: G.World.ARENA_MIN + 4 };
      const pool = ['tirador', 'pistolero', 'arquero', 'escopetero', 'bruto', 'sigilo', 'saqueador'];
      shuffle(pool);
      // tamaño: de 5 a 8 (más cuanto más avanzada la carrera)
      const step = this.retorno && G.Run ? G.Run.step || 0 : 2;
      const n = opts.size || Math.min(8, 5 + Math.floor(step * 0.75) + (Math.random() < 0.35 ? 1 : 0));
      const roles = ['lider'].concat(pool.slice(0, n - 1));
      if (roles.indexOf('saqueador') < 0 && roles.length > 4 && Math.random() < 0.6) roles[roles.length - 1] = 'saqueador';
      const face = Math.atan2(player.pos.x - z0.x, player.pos.z - z0.z);
      st.squad = G.Humans.spawnSquad({ roles, at: z0, active: false, face, diff: 0.82 + step * 0.05 });
      st.squadN = st.squad.members.length;
      for (const h of st.squad.members) st.list.push(h);
      if (G.Refugio && G.Refugio.ping) G.Refugio.ping(z0.x, z0.z, 'escorpion', 5);
    },

    // ---------- Jefe final ----------
    // la sala del jefe: mucho material para fabricar (curas, molotovs y minas) y algo de munición de tus armas;
    // el hongomorfo espera dormido en la trastienda
    startBoss() {
      const mp = G.Maps && G.Maps.get(G.World.layout), A = mp && mp.arena;
      st.arena = A;
      const w = { alcohol: 3, trapo: 3, polvo: 1.7, clavos: 1.7, botella: 1, ladrillo: 0.7, venda: 0.35 };
      for (const s of player.weapons) {
        const wd = G.Weapons.get(s.id), am = G.Weapons.isGun(wd) && G.Weapons.AMMO[wd.ammo];
        if (am && am.item && player.hands.indexOf(s) >= 0) w[am.item] = (w[am.item] || 0) + 2.2;
      }
      const area = A ? { x0: A.hall.x0 + 0.4, z0: A.hall.z0 + 0.4, x1: A.hall.x1 - 0.4, z1: A.hall.z1 - 0.4 } : null;
      G.Pickups.spawn(16, { weights: w, area, gap: 2.1, near: 2 });
      // lo justo para una mina y una molotov seguro
      G.Pickups.spawn(4, { weights: { polvo: 1, clavos: 1, alcohol: 1, trapo: 1 }, area, gap: 1.6, near: 1.5 });
      if (!A) return;
      const zb = new G.Zombie(scene, A.lair.x, A.lair.z, null, 0, { hongo: true, hunter: true, lv: 0 });
      zb.kind = 'hongo'; zb.sleep();
      G.Population.list.push(zb); st.list.push(zb);
      st.boss = zb;
      // el blindado se prepara ya (oculto, fuera de la lista) para que salir no cueste un tirón
      const n = A.nemi;
      const zn = new G.Zombie(scene, n.x, n.z, null, Math.PI, { nemi: true, hunter: true, lv: 0 });
      zn.kind = 'nemi'; zn.model.root.visible = false;
      st.nemiWait = zn;
      // los acechadores de fuera (por si se abre el exterior), también ya preparados y ocultos
      st.outWait = [];
      for (let i = 0; i < 5; i++) {
        const zs = new G.Zombie(scene, G.World.ARENA_MAX - 2 - i, G.World.ARENA_MIN + 1, null, 0, { stalker: true, hunter: true, lv: 0 });
        zs.kind = 'stalker'; zs.model.root.visible = false;
        st.outWait.push(zs);
      }
      G.Camera.yaw = Math.PI; player.facing = Math.PI;
    },
    // ---------- Caza contra los escorpiones ----------
    spawnHuman() {
      const p = this.spawnPoint();
      if (!p) return false;
      const role = ['explorador', 'carronero', 'pistolero'][Math.floor(Math.random() * 3)];
      const face = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
      let h;
      if (!st.squad || st.squad.done) {
        const step = this.retorno && G.Run ? G.Run.step || 0 : 2;
        st.squad = G.Humans.spawnSquad({ roles: [role], at: p, active: true, face, diff: 0.8 + step * 0.04, noRetreat: true });
        h = st.squad.members[0];
      } else h = G.Humans.reinforce(st.squad, role, p, face);
      st.squadN = st.squad.members.length;
      st.list.push(h);
      // te buscan: saben más o menos por dónde andas
      const sq = st.squad;
      if (sq.mode !== 'combat') { sq.known = { x: player.pos.x + (Math.random() - 0.5) * 10, z: player.pos.z + (Math.random() - 0.5) * 10, lv: 0, t: 1, seen: false }; sq.mode = 'search'; sq.searchT = 0; sq.brainT = 0.5; }
      if (G.Refugio && G.Refugio.ping) G.Refugio.ping(p.x, p.z, 'escorpion', 4);
      return true;
    },

    // ---------- Saqueo (solo escorpiones) ----------
    // Un escuadrón protege una caja fuerte con botín. Tienes 3 min 30 s para abrirla (6 s junto a ella, sin
    // moverte; si te pegan o te alejas, se corta), a escondidas o tras acabar con ellos. Si se acaba el tiempo,
    // vuelves con un cuarto de la recompensa
    startSaqueo(opts) {
      const W = G.World, A0 = W.ARENA_MIN + 3, A1 = W.ARENA_MAX - 3;
      let best = null, bs = -1e9;
      for (let i = 0; i < 200; i++) {
        const x = U.lerp(A0, A1, Math.random()), z = U.lerp(A0, A1, Math.random());
        if (W.circleBlocked(x, z, 0.7, 0) || W.furnTop(x, z, 0, 0.6) > 0.1) continue;
        let room = 0;
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8; if (!W.circleBlocked(x + Math.sin(a) * 2.2, z + Math.cos(a) * 2.2, 0.4, 0)) room++; }
        if (room < 4) continue;
        const d = Math.hypot(x - player.pos.x, z - player.pos.z);
        let sc = Math.min(d, 30) + room * 0.5 + (W.isIndoor(Math.floor(x), Math.floor(z), 0) ? 6 : 0);
        if (d < 18) sc -= 30;
        if (sc > bs) { bs = sc; best = { x, z }; }
      }
      best = best || { x: (A0 + A1) / 2, z: (A0 + A1) / 2 };
      // de cara al lado más libre
      let face = 0, fr = -1;
      for (let k = 0; k < 8; k++) { const a = k * TAU / 8; let r = 0; for (let t = 0.6; t < 4; t += 0.5) { if (W.circleBlocked(best.x + Math.sin(a) * t, best.z + Math.cos(a) * t, 0.3, 0)) break; r = t; } if (r > fr) { fr = r; face = a; } }
      st.safe = { x: best.x, z: best.z, face, open: false, mesh: this.makeSafe(best.x, best.z, face) };
      const step = this.retorno && G.Run ? G.Run.step || 0 : 2;
      const n = mul(Math.min(8, 5 + Math.floor(step * 0.6) + (Math.random() < 0.4 ? 1 : 0)), 9);
      const pool = shuffle(['tirador', 'pistolero', 'escopetero', 'bruto', 'sigilo', 'saqueador', 'arquero', 'explorador']);
      const roles = ['lider'].concat(pool.slice(0, n - 1));
      const R = 15;
      const zone = { x0: Math.max(W.ARENA_MIN, best.x - R), z0: Math.max(W.ARENA_MIN, best.z - R), x1: Math.min(W.ARENA_MAX, best.x + R), z1: Math.min(W.ARENA_MAX, best.z + R) };
      st.squad = G.Humans.spawnSquad({ roles, at: { x: best.x + Math.sin(face) * 2, z: best.z + Math.cos(face) * 2 }, active: true, face, zone, diff: 0.82 + step * 0.05, noRetreat: true, guard: { x: best.x, z: best.z } });
      st.squad.brainT = 0.2;
      st.squadN = st.squad.members.length;
      for (const h of st.squad.members) st.list.push(h);
      if (G.Refugio && G.Refugio.ping) G.Refugio.ping(best.x, best.z, 'escorpion', 6);
    },
    // la caja fuerte: acero gris oscuro, puerta con rueda y bisagras (se abre girando al saquearla)
    makeSafe(x, z, face) {
      const g = new THREE.Group();
      const steel = new THREE.MeshLambertMaterial({ color: 0x3a3e44 }), dark = new THREE.MeshLambertMaterial({ color: 0x1c1e22 }), brass = new THREE.MeshLambertMaterial({ color: 0xb8923a });
      const box = (w, h, d, m, px, py, pz, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; (parent || g).add(o); return o; };
      box(0.86, 1.05, 0.72, steel, 0, 0.6, 0);
      box(0.9, 0.08, 0.76, dark, 0, 0.04, 0);
      box(0.7, 0.85, 0.02, dark, 0, 0.62, 0.362);                    // el hueco de dentro (se ve al abrir)
      const door = new THREE.Group(); door.position.set(-0.36, 0, 0.372); g.add(door);
      box(0.72, 0.88, 0.05, steel, 0.36, 0.62, 0.0, door);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 14), brass); wheel.position.set(0.42, 0.66, 0.04); door.add(wheel);
      box(0.06, 0.06, 0.04, brass, 0.2, 0.8, 0.04, door);
      for (const y of [0.32, 0.92]) box(0.04, 0.1, 0.05, dark, 0.0, y, 0.0, door);
      // dentro: fajos y cajas de munición
      box(0.2, 0.1, 0.15, new THREE.MeshLambertMaterial({ color: 0x6a8a4a }), -0.14, 0.4, 0.15);
      box(0.24, 0.14, 0.18, new THREE.MeshLambertMaterial({ color: 0x5a5a32 }), 0.14, 0.42, 0.12);
      g.position.set(x, G.World.groundY(x, z, 0), z);
      g.rotation.y = face;
      scene.add(g);
      g.userData.door = door;
      return g;
    },
    interactFind(player, mode) {
      const S = st && st.type === 'saqueo' && st.phase === 'raid' ? st.safe : null;
      if (!S || S.open || st.crack) return null;
      if (Math.hypot(S.x - player.pos.x, S.z - player.pos.z) > 1.7 || (player.lv || 0)) return null;
      return { kind: 'safe', label: 'Abrir la caja fuerte', x: S.x, z: S.z };
    },
    interactUse(t, player) {
      if (!st || !st.safe || st.safe.open) return null;
      st.crack = { t: 0, clickT: 0 };
      player.facing = Math.atan2(st.safe.x - player.pos.x, st.safe.z - player.pos.z);
      if (player.stance === 'stand' && player.setStance) player.setStance('crouch');
      return 'Abriendo la caja fuerte... no te muevas';
    },
    updateRaid(dt) {
      st.left -= dt;
      this.renderWave();
      const S = st.safe, C = st.crack;
      if (C) {
        const d = Math.hypot(S.x - player.pos.x, S.z - player.pos.z);
        if (d > 1.9 || (player.speedNow || 0) > 0.9 || (player.blow && player.blow.t < 0.3) || player.struggle || player.hostage) {
          st.crack = null;
          if (this.onMessage) this.onMessage('Se cortó: tienes que volver a empezar', 'warn');
        } else {
          C.t += dt; C.clickT -= dt;
          if (C.clickT <= 0) { C.clickT = 0.7; if (G.Audio) G.Audio.play('slide', { x: S.x, z: S.z, lv: 0, vol: 0.35 }); G.World.emit(S.x, S.z, 5, 0); }
          this.setTimer('ABRIENDO LA CAJA FUERTE', Math.max(0, CRACK_T - C.t));
          if (C.t >= CRACK_T) this.openSafe();
        }
      }
      if (!st.crack && st.phase === 'raid') this.setTimer('TIEMPO PARA SAQUEAR', Math.max(0, st.left));
      const sq = st.squad;
      if (sq && sq.mode === 'combat') st.spotted = true;
      if (sq && sq.done && !st.allDownSaid) { st.allDownSaid = true; if (this.onMessage) this.onMessage('No queda ninguno en pie: saquea la caja', 'good'); }
      if (st.left < 30 && !st.hurrySaid) { st.hurrySaid = true; this.bark('hurry'); }
      if (st.left <= 0 && st.phase === 'raid') {
        st.partial = true;
        if (G.Run && G.Run.setEncMul) G.Run.setEncMul(0.25);
        this.endFade('SE ACABÓ EL TIEMPO');
        if (this.onMessage) this.onMessage('No pudiste abrir la caja: vuelves con un cuarto de la recompensa', 'bad');
      }
    },
    openSafe() {
      const S = st.safe;
      S.open = true; st.crack = null;
      if (S.mesh) S.mesh.userData.door.rotation.y = -1.9;
      if (G.Audio) { G.Audio.play('doorOpen', { x: S.x, z: S.z, lv: 0 }); G.Audio.play('pickup'); }
      // el botín: munición de las armas que llevas, vendas, materiales y alguna molotov
      const W = G.World, out = [];
      const am = G.Pickups.ammoWeights ? G.Pickups.ammoWeights(player, 1) : {};
      for (const id in am) out.push([id, 6 + Math.floor(Math.random() * 6)]);
      out.push(['venda', 2], ['molotov', 1], ['alcohol', 1], ['polvo', 1], ['clavos', 2]);
      out.forEach(([id, n], i) => {
        const a = S.face + (i - out.length / 2) * 0.45, r = 0.95;
        const x = S.x + Math.sin(a) * r, z = S.z + Math.cos(a) * r;
        G.Pickups.add(id, n, { x, y: W.groundY(x, z, 0), z, lv: 0 });
      });
      this.achieve('saqueo'); this.modeDone('saqueo');
      if (!st.spotted) { this.chal('esc_sigilo'); this.achieve('fantasma'); }
      if (st.left > 120) this.chal('saqueo_rapido');
      if (this.onMessage) this.onMessage('¡Caja fuerte saqueada!', 'good');
      this.endFade('CAJA FUERTE SAQUEADA', 2.2);
    },
    // termina con fundido (se quitan los que quedan) y el cartel
    endFade(text, delay) {
      st.endText = text;
      st.phase = 'fade'; st.t = 0.55 + (delay || 0);
      this.fighting = false;
      this.setTimer(null);
      if (delay) setTimeout(() => { if (this.onFade) this.onFade(1, 0.5); }, delay * 1000);
      else if (this.onFade) this.onFade(1, 0.5);
    },

    // ---------- Resistencia (solo infectados) ----------
    // Llegan oleadas de infectados durante 3 min 30 s y tienes que proteger a tu compañero (el personaje que no
    // llevas: con Vera, Tomás, con revólver y hacha; con Tomás, Vera, con rifle y pistola). Tiene muchísima vida
    // (casi como el hongomorfo), pero si cae, pierdes. Los infectados van a por él o a por ti (al más cercano)
    startResist(opts) {
      const W = G.World;
      const cid = player.charId === 'tomas' ? 'vera' : 'tomas';
      let p = null;
      for (let k = 0; k < 30 && !p; k++) {
        const a = Math.random() * TAU, r = 1.6 + k * 0.1;
        const x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
        if (!W.circleBlocked(x, z, 0.45, 0)) p = { x, z };
      }
      p = p || { x: player.pos.x + 1.5, z: player.pos.z };
      const step = this.retorno && G.Run ? G.Run.step || 0 : 2;
      st.ally = new G.Humans.Ally(scene, p.x, p.z, cid, 1100 - step * 40);
      st.ally.facing = player.facing;
      setTimeout(() => { if (st && st.ally && st.ally.alive) st.ally.line('start', 3); }, 2500);
    },
    updateHold(dt) {
      st.left -= dt;
      this.setTimer('RESISTE', Math.max(0, st.left));
      const prog = 1 - Math.max(0, st.left) / st.total;
      // en oleadas: cada 30 s llega un grupo (cada vez más grande); entre medias, alguno suelto
      st.pulseT -= dt;
      if (st.pulseT <= 0 && st.left > 12) {
        st.pulse++;
        st.pulseT = 30;
        const n = mul(Math.min(9, 3 + st.pulse), 14);
        for (let i = 0; i < n; i++) st.queue.push({ kind: Math.random() < 0.12 && st.pulse > 2 ? 'blind' : (Math.random() < 0.06 && st.pulse > 3 ? 'temb' : 'runner') });
        if (this.onMessage) this.onMessage('Oleada ' + st.pulse, 'bad');
        if (st.pulse > 1) this.bark('wave');
      }
      st.spawnT -= dt;
      const alive = st.list.filter((z) => z.alive).length;
      if (st.queue.length && st.spawnT <= 0 && alive < mul(12)) { if (this.spawnOne(st.queue[0])) st.queue.shift(); st.spawnT = 0.5; }
      else if (!st.queue.length && st.spawnT <= 0 && alive < 3 + prog * 4) { this.spawnOne({ kind: 'runner' }); st.spawnT = U.lerp(9, 4, prog); }
      this.renderWave();
      const A = st.ally;
      if (A && (!A.alive || A.life <= 0) && !st.allyDead) {
        st.allyDead = true;
        this.fighting = false;
        if (this.onMessage) this.onMessage(A.name + ' cayó', 'bad');
        setTimeout(() => { if (!player.dead) player.die(A.name + ' murió. No pudiste protegerlo.'); }, 1500);
        return;
      }
      if (st.left <= 0 && !st.allyDead) {
        this.achieve('guardaespaldas'); this.modeDone('resistencia');
        if (A && A.life / A.lifeMax > 0.75) this.chal('resist_entero');
        this.endFade('RESISTIERON');
      }
    },
    // a quién va un infectado en la resistencia: al compañero o a ti (al más cercano; si te tiene agarrada, a ti)
    targetFor(z) {
      if (!st || st.type !== 'resistencia' || !st.ally || !st.ally.alive || z.human || z.ally) return null;
      if ((player.struggle && player.struggle.z === z) || (player.beaten && player.beaten.z === z) || (player.lifted && player.lifted.z === z)) { z.onAlly = false; return null; }
      z.tgtT = (z.tgtT || 0) - 1;
      if (z.tgtT <= 0) {
        z.tgtT = 45;
        const BUSYZ = { attack: 1, combo: 1, grapple: 1, runatk: 1, tdash: 1, tcharge: 1 };
        if (!BUSYZ[z.state]) {
          const A = st.ally;
          const dA = Math.hypot(A.pos.x - z.pos.x, A.pos.z - z.pos.z), dP = Math.hypot(player.pos.x - z.pos.x, player.pos.z - z.pos.z);
          z.onAlly = dA < dP * 1.25 || (player.dead);
        }
      }
      return z.onAlly ? { p: st.ally.proxy, c: G.Humans.AllyCombat } : null;
    },

    // el hongomorfo tiró una pared de fuera: se abre el exterior (la primera vez llegan acechadores, atraídos por
    // el ruido, y al hongomorfo le entra hambre: grita y va a comérselos para curarse)
    onExteriorOpen(x, z) {
      if (!st || st.type !== 'jefe' || st.outOpen) return;
      st.outOpen = true;
      const W = G.World, A0 = W.ARENA_MIN + 1.5, A1 = W.ARENA_MAX - 1.5;
      const spots = [];
      for (let k = 0; k < 400 && spots.length < 5; k++) {
        const sx = A0 + Math.random() * (A1 - A0), sz = A0 + Math.random() * (A1 - A0);
        if (W.bldAt(Math.floor(sx), Math.floor(sz), 0)) continue;
        if (Math.hypot(sx - x, sz - z) < 11 || Math.hypot(sx - player.pos.x, sz - player.pos.z) < 12) continue;
        if (W.circleBlocked(sx, sz, 0.45, 0)) continue;
        if (spots.some((p) => Math.hypot(p.x - sx, p.z - sz) < 5)) continue;
        spots.push({ x: sx, z: sz });
      }
      const n = Math.min(spots.length, 4 + (Math.random() < 0.5 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const p = spots[i];
        let zz = st.outWait && st.outWait.pop();
        if (zz) { zz.pos.x = p.x; zz.pos.z = p.z; zz.facing = Math.atan2(x - p.x, z - p.z); zz.model.root.visible = true; }
        else zz = new G.Zombie(scene, p.x, p.z, null, Math.atan2(x - p.x, z - p.z), { stalker: true, hunter: true, lv: 0 });
        zz.kind = 'stalker'; zz.enter('hide', 4); zz.spot = null;
        G.Population.list.push(zz); st.list.push(zz);
      }
      const b = st.boss;
      if (b && b.alive) {
        b.hunger = true; b.eatCD = 2.5;
        if (b.state === 'chase' || b.state === 'recover' || b.state === 'hrip') { b.burstDone = true; b.enter('troar', 1.6); }
        if (G.Audio) G.Audio.play('hRoar', { x: b.pos.x, z: b.pos.z, lv: 0, z0: b });
      }
      if (G.Audio) setTimeout(() => G.Audio.play('nShriek', { x: spots[0] ? spots[0].x : x, z: spots[0] ? spots[0].z : z, lv: 0 }), 1400);
      setTimeout(() => this.bark('outside'), 1800);
      if (this.onMessage) this.onMessage('La pared de fuera cayó... y hay acechadores ahí fuera', 'bad');
    },
    // se comió a uno (recupera vida)
    onBossAte(b, gain) {
      if (this.onMessage) this.onMessage('El hongomorfo devoró a un acechador (+' + Math.round(gain / b.hpMax * 100) + ' % de vida)', 'bad');
      if (Math.random() < 0.6) setTimeout(() => this.bark('bossAte'), 700);
    },
    bossUpdate(dt) {
      const b = st.boss;
      if (st.phase === 'prep') {
        // golpes detrás de la pared, cada vez más seguidos
        st.thumpT -= dt;
        if (st.thumpT <= 0 && st.arena) {
          st.thumpT = st.t > 20 ? 6 + Math.random() * 4 : 2.5 + Math.random() * 2;
          const a = st.arena;
          if (G.Audio) G.Audio.play('bang', { x: (a.breach.x0 + a.breach.x1) / 2, z: a.breach.z - 0.4, lv: 0 });
          if (G.Camera.shake) G.Camera.shake(0.08 + (st.t < 15 ? 0.1 : 0));
          if (!st.thumpSaid && st.t < 30) { st.thumpSaid = true; this.bark('bossThump'); }
        }
        return;
      }
      if (st.phase !== 'boss' || !b) return;
      // a la mitad de la vida sale el blindado (por el mismo hueco)
      if (!st.nemi && b.alive && b.hp <= b.hpMax * 0.5 && st.arena) {
        const n = st.arena.nemi;
        const zn = st.nemiWait || new G.Zombie(scene, n.x, n.z, null, Math.PI, { nemi: true, hunter: true, lv: 0 });
        st.nemiWait = null;
        zn.kind = 'nemi'; zn.model.root.visible = true; zn.unseenT = 0; zn.enter('hide', 6); zn.spot = null;
        G.Population.list.push(zn); st.list.push(zn);
        st.nemi = zn;
        if (G.Audio) G.Audio.play('nShriek', { x: n.x, z: n.z, lv: 0, z0: zn });
        setTimeout(() => this.bark('nemi'), 1600);
        if (this.onMessage) this.onMessage('Algo más salió de la guarida...', 'bad');
      }
      // desafíos y logros del jefe
      if (st.nemi && !st.nemi.alive && !st.nemiDead) {
        st.nemiDead = true; this.achieve('blindado');
        if (b.alive) this.chal('jefe_blindado');
      }
      if (!b.alive && !st.bossJudged) {
        st.bossJudged = true;
        this.achieve('hongo');
        if (b.killedBy === 'fire') this.chal('jefe_fuego');
        if (this.stats.time - (st.bossT0 || 0) < 240) this.chal('jefe_rapido');
        if ((st.mach || 0) <= 5) this.chal('jefe_salon');
        if (this.stats.hurt <= (st.hurt0 || 0) + 1e-6) { this.chal('jefe_vida'); this.achieve('intocable'); }
        if (G.Run && G.Run.CHALLENGES.filter((c) => c.boss).every((c) => G.Run.chalTimes(c.id) > 0)) this.achieve('maestro');
      }
      if (!b.alive && !st.bossSaid) { st.bossSaid = true; this.bark('bossDead'); if (st.nemi && st.nemi.alive && this.onMessage) this.onMessage('Queda el blindado', 'bad'); }
      const done = !b.alive && (b.popped || b.popT == null) && (!st.nemi || !st.nemi.alive);
      if (done) {
        this.fighting = false;
        st.phase = 'complete'; st.t = BANNER + 1;
        this.banner('JEFE DERROTADO', BANNER);
        setTimeout(() => this.bark('done'), 900);
      }
    },

    stop() {
      if (G.BossFx) G.BossFx.clear();
      if (G.Humans) G.Humans.reset();
      if (st && st.nemiWait) { st.nemiWait.dispose(); st.nemiWait = null; }
      if (st && st.outWait) { for (const zs of st.outWait) zs.dispose(); st.outWait = null; }
      if (st && st.ally) { st.ally.dispose(); st.ally = null; }
      if (st && st.safe && st.safe.mesh) { scene.remove(st.safe.mesh); st.safe.mesh = null; }
      this.active = false; this.fighting = false;
      G.Combat.stats = null; this.stats = null; st = null;
      if (player) player.noInfect = false;
      if ($['mode-hud']) $['mode-hud'].classList.add('hidden');
      if ($['m-stats']) $['m-stats'].classList.add('hidden');
      if ($['m-sub']) $['m-sub'].classList.add('hidden');
    },

    // ---------- Frases (subtítulos abajo al centro) ----------
    bark(kind) {
      if (!this.active || !st) return;
      const L = BARKS[kind];
      if (!L) return;
      const now = performance.now() / 1000;
      if (kind === 'kill' && (now - (st.lastBark || 0) < 6 || Math.random() < 0.45)) return;
      if (now - (st.lastBark || 0) < 1.2) return;
      st.lastBark = now;
      const line = L[Math.floor(Math.random() * L.length)];
      const s = $['m-sub'];
      s.innerHTML = '<b>' + ((player && player.charName) || SPEAKER) + ':</b> ' + line;
      s.classList.remove('hidden');
      clearTimeout(s._t);
      s._t = setTimeout(() => s.classList.add('hidden'), 2600);
    },

    // ---------- HUD ----------
    setTimer(label, t) {
      const tm = $['m-timer'];
      if (!label) { tm.classList.add('hidden'); return; }
      tm.classList.remove('hidden');
      if ($['m-tlabel'].textContent !== label) $['m-tlabel'].textContent = label;
      const v = t >= 60 ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : Math.max(0, t).toFixed(1);
      if ($['m-tval'].textContent !== v) $['m-tval'].textContent = v;
    },
    renderWave() {
      if (st.type === 'resistencia') {
        const a = st.ally, k = a ? Math.max(0, a.life / a.lifeMax) : 0;
        $['m-wlabel'].textContent = (a ? a.name : 'Compañero') + ' · ' + Math.ceil(k * 100) + ' %';
        $['m-bar'].firstElementChild.style.width = (k * 100).toFixed(1) + '%';
        const n = st.list.filter((z) => z.alive).length, key = 'r' + n;
        if ($['m-icons']._k !== key) { $['m-icons']._k = key; let h = ''; for (let i = 0; i < Math.min(n, 14); i++) h += '<i></i>'; $['m-icons'].innerHTML = h; }
        return;
      }
      if (st.type === 'saqueo' || (st.type === 'caza' && st.humans)) {
        const sq = st.squad, left = sq ? sq.members.filter((h) => h.alive && !h.gone && !h.spared) : [];
        $['m-wlabel'].textContent = 'Escorpiones · ' + left.length + ' en pie';
        $['m-bar'].firstElementChild.style.width = (st.type === 'caza' ? 100 : left.length / Math.max(1, st.squadN || 1) * 100).toFixed(1) + '%';
        const key = left.map((h) => h.role).join(',');
        if ($['m-icons']._k !== key) {
          $['m-icons']._k = key;
          $['m-icons'].innerHTML = left.map((h) => '<i class="h ' + (H_ICON[h.role] || '') + '"></i>').join('');
        }
        return;
      }
      const alive = st.list.filter((z) => z.alive && !z.gone && !z.spared);
      const left = st.queue.length + alive.length;
      const total = Math.max(1, st.waveTotal || left);
      $['m-wlabel'].textContent = 'Oleada ' + st.wave + '/3';
      if (st.humans) {
        $['m-bar'].firstElementChild.style.width = (left / total * 100).toFixed(1) + '%';
        const key = 'h' + alive.map((h) => h.role).join(',');
        if ($['m-icons']._k !== key) { $['m-icons']._k = key; $['m-icons'].innerHTML = alive.map((h) => '<i class="h ' + (H_ICON[h.role] || '') + '"></i>').join(''); }
        return;
      }
      $['m-bar'].firstElementChild.style.width = (left / total * 100).toFixed(1) + '%';
      // un muñeco por enemigo que queda (los chasqueadores con la cabeza marcada; el temblante, grande)
      // (solo los que ya han salido: van apareciendo a la vez que los infectados)
      const kinds = alive.map((z) => (z.temb ? 'temb' : z.blind ? 'blind' : 'x'));
      const nb = kinds.filter((k) => k === 'blind').length, nt = kinds.filter((k) => k === 'temb').length;
      const key = kinds.length + '|' + nb + '|' + nt;
      if ($['m-icons']._k !== key) {
        $['m-icons']._k = key;
        let h = '';
        for (let i = 0; i < kinds.length; i++) h += '<i class="' + (i < nt ? 't' : (i < nt + nb ? 'b' : '')) + '"></i>';
        $['m-icons'].innerHTML = h;
      }
    },
    renderChal() {
      const c = $['m-chal'];
      c.classList.toggle('done', !!st.chal);
      $['m-cn'].textContent = (st.chal ? 1 : 0) + '/1';
    },
    banner(text, sec) {
      $['m-btext'].textContent = text;
      $['m-banner'].classList.remove('hidden');
      clearTimeout($['m-banner']._t);
      $['m-banner']._t = setTimeout(() => $['m-banner'].classList.add('hidden'), sec * 1000);
    },

    // ---------- Oleadas ----------
    beginWave(n) {
      st.wave = n; st.phase = 'wave';
      st.queue = st.humans ? [] : waveQueue(n);
      // (mapa grande: unos cuantos más, corredores y algún acechador)
      if (!st.humans) for (let k = st.queue.length, goal = mul(st.queue.length); k < goal; k++) st.queue.splice(Math.floor(Math.random() * (st.queue.length + 1)), 0, { kind: Math.random() < (G.Sky && G.Sky.night ? 0.5 : 0.25) ? 'stalker' : 'runner' });
      st.waveTotal = st.queue.length;
      if (st.humans) this.humanWave(n);
      st.waveHurt = this.stats.hurt; st.waveHp = player.health;
      // salen todos juntos del otro lado del mapa (uno tras otro muy seguido, para no atascar el fotograma)
      st.alive = 99;
      st.spawnT = 0.4;
      st.zone = this.farZone();
      st.zoneN = 0;
      st.calmT = 0;
      if (st.zone && !st.humans && G.Refugio && G.Refugio.ping) G.Refugio.ping(st.zone.x, st.zone.z, 'zombi', 5);
      this.fighting = true;
      this.setTimer(null);
      $['m-title'].classList.add('hidden');
      $['m-wave'].classList.remove('hidden');
      this.renderWave();
      this.bark(st.humans ? (n === 3 ? 'revenge' : 'squad') : 'wave');
      if (this.onMessage) this.onMessage(st.humans && n === 3 ? 'Oleada 3 de 3: llegan los Escorpiones' : 'Oleada ' + n + ' de 3', 'bad');
    },
    // Asalto humano: las dos primeras oleadas, exploradores con pistola y carroñeros con palos (tantos como
    // infectados en esas oleadas); la tercera, el grupo del que huyó (un escuadrón con su líder)
    humanWave(n) {
      const z0 = this.farZone() || { x: G.World.ARENA_MIN + 4, z: G.World.ARENA_MIN + 4 };
      const face = Math.atan2(player.pos.x - z0.x, player.pos.z - z0.z);
      const step = this.retorno && G.Run ? G.Run.step || 0 : 2;
      let roles;
      if (n < 3) {
        const total = mul(Math.random() < (n === 1 ? 0.25 : 0.7) ? 4 : 3);
        const guns = n === 1 ? (Math.random() < 0.5 ? 1 : 2) : 2;
        roles = [];
        for (let i = 0; i < total; i++) roles.push(i < guns ? 'explorador' : 'carronero');
        shuffle(roles);
      } else {
        const total = mul(Math.random() < 0.25 ? 7 : 6, 8);
        const pool = shuffle(['tirador', 'pistolero', 'arquero', 'escopetero', 'bruto', 'sigilo', 'saqueador']);
        roles = ['lider'].concat(pool.slice(0, total - 1));
      }
      // la tercera oleada viene a vengarse: no se retira ni se rinde
      const sq = G.Humans.spawnSquad({ roles, at: z0, active: true, face, diff: 0.8 + step * 0.04, noRetreat: true, noBeg: n === 3 });
      // saben más o menos por dónde andas (como los infectados de las oleadas, que te cazan)
      sq.known = { x: player.pos.x + (Math.random() - 0.5) * 16, z: player.pos.z + (Math.random() - 0.5) * 16, lv: 0, t: 1, seen: false };
      sq.mode = 'search'; sq.searchT = 0; sq.brainT = 1.2;
      st.squad = sq; st.squadN = sq.members.length; st.waveTotal = sq.members.length;
      st.escaper = null;
      for (const h of sq.members) st.list.push(h);
      const L0 = sq.leader || sq.members[0];
      if (L0) L0.say(n === 3 ? 'revenge' : 'waveIn', null, { prio: 3, after: 1.5 });
      if (G.Refugio && G.Refugio.ping) G.Refugio.ping(z0.x, z0.z, 'escorpion', 5);
    },

    // Sitio para que aparezca uno: lejos de ti, donde no lo veas, en el suelo libre y, sobre todo, lejos de los
    // otros infectados (nunca salen juntos: quedan repartidos por el mapa)
    spawnPoint() {
      const W = G.World, A0 = W.ARENA_MIN + 2, A1 = W.ARENA_MAX - 2;
      const size = A1 - A0, dMin = Math.min(14, size * 0.3), dBest = Math.min(26, size * 0.55);
      const cf = G.Camera.forward();
      const others = G.Population.list.filter((z) => z.alive);
      let best = null, bs = -Infinity;
      for (let i = 0; i < 80; i++) {
        const x = U.lerp(A0, A1, Math.random()), z = U.lerp(A0, A1, Math.random());
        const d = Math.hypot(x - player.pos.x, z - player.pos.z);
        if (d < dMin || W.circleBlocked(x, z, 0.4, 0)) continue;
        let s = -Math.abs(d - dBest) * 0.12;
        const ang = Math.atan2(x - player.pos.x, z - player.pos.z);
        if (Math.abs(U.angleDiff(ang, Math.atan2(cf.x, cf.z))) > 1.2) s += 2;     // fuera de cámara
        if (!W.hasLOS(player.pos.x, player.pos.z, x, z, 0)) s += 1.5;                // detrás de algo
        if (W.isIndoor(Math.floor(x), Math.floor(z), 0)) s -= 0.5;
        // repartidos: cuanto más lejos del infectado más cercano, mejor (y de los que acaban de salir)
        let near = 40;
        for (const o of others) near = Math.min(near, Math.hypot(o.pos.x - x, o.pos.z - z));
        for (const p of st.recent || []) near = Math.min(near, Math.hypot(p.x - x, p.z - z) + 2);
        s += Math.min(near, 16) * 0.35;
        if (near < 6) s -= 4;
        if (s > bs) { bs = s; best = { x, z }; }
      }
      if (best) { (st.recent || (st.recent = [])).push(best); if (st.recent.length > 4) st.recent.shift(); }
      return best;
    },

    // Zona de salida de una oleada del asalto: lo más lejos posible de ti (del otro lado del mapa), en suelo libre
    // y con sitio alrededor para que quepan todos
    farZone() {
      const W = G.World, A0 = W.ARENA_MIN + 3, A1 = W.ARENA_MAX - 3;
      let best = null, bs = -Infinity;
      for (let i = 0; i < 120; i++) {
        const x = U.lerp(A0, A1, Math.random()), z = U.lerp(A0, A1, Math.random());
        if (W.circleBlocked(x, z, 0.6, 0)) continue;
        let room = 0;
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8; if (!W.circleBlocked(x + Math.sin(a) * 1.6, z + Math.cos(a) * 1.6, 0.4, 0)) room++; }
        let s = Math.hypot(x - player.pos.x, z - player.pos.z) + room * 0.6;
        if (W.isIndoor(Math.floor(x), Math.floor(z), 0)) s -= 4;
        if (W.hasLOS(player.pos.x, player.pos.z, x, z, 0)) s -= 2;
        if (s > bs) { bs = s; best = { x, z }; }
      }
      return best;
    },
    // sitio junto a la zona (en corro) para el siguiente que sale
    zoneSpot() {
      const W = G.World, c = st.zone, n = st.zoneN++;
      for (let k = 0; k < 10; k++) {
        const a = (n * 2.39996 + k * 0.7), r = n === 0 && k === 0 ? 0 : 0.9 + (k * 0.25) + Math.random() * 0.6;
        const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        if (!W.circleBlocked(x, z, 0.4, 0)) return { x, z };
      }
      return { x: c.x, z: c.z };
    },
    // a dónde se va cada uno al salir: se reparten en abanico por el mapa (sin ir a por ti)
    disperseGoal(p, i, n) {
      const W = G.World, A0 = W.ARENA_MIN + 2, A1 = W.ARENA_MAX - 2;
      const base = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
      for (let k = 0; k < 12; k++) {
        const a = base + (n > 1 ? (i / (n - 1) - 0.5) * 3.6 : 0) + (Math.random() - 0.5) * (0.5 + k * 0.15);
        const d = 7 + Math.random() * 11;
        const x = U.clamp(p.x + Math.sin(a) * d, A0, A1), z = U.clamp(p.z + Math.cos(a) * d, A0, A1);
        if (Math.hypot(x - player.pos.x, z - player.pos.z) < 9) continue;
        if (!W.circleBlocked(x, z, 0.4, 0)) return { x, z, lv: 0 };
      }
      return null;
    },

    spawnOne(q) {
      const wave = st.type === 'asalto' && st.zone;
      const p = wave ? this.zoneSpot() : this.spawnPoint();
      if (!p) return false;
      const kind = q.kind || 'runner';
      // asalto: no saben dónde estás; te buscan solo cuando ya te vieron una vez (y te perdieron)
      const zb = new G.Zombie(scene, p.x, p.z, null, wave ? Math.random() * TAU : Math.atan2(player.pos.x - p.x, player.pos.z - p.z),
        { hunter: !wave, blind: kind === 'blind', temb: kind === 'temb', stalker: kind === 'stalker', lv: 0 });
      zb.wave = st.wave; zb.kind = kind;
      if (wave) {
        const g = this.disperseGoal(p, st.zoneN - 1, st.waveTotal);
        if (g) { zb.target = g; zb.enter('wander', 16); }
        else zb.enter('idle', 1 + Math.random() * 2);
      } else if (kind === 'runner' || kind === 'temb') { zb.state = 'chase'; zb.target = { x: player.pos.x, z: player.pos.z, lv: 0 }; zb.lastSeen = 0; zb.screamed = true; }
      else { zb.target = { x: player.pos.x + (Math.random() - 0.5) * 8, z: player.pos.z + (Math.random() - 0.5) * 8, lv: 0 }; zb.enter('investigate', 10); }
      G.Population.list.push(zb);
      st.list.push(zb);
      if (kind === 'blind' && !st.blindSaid) { st.blindSaid = true; setTimeout(() => this.bark('blind'), 1500); }
      if (kind === 'temb' && !st.tembSaid) { st.tembSaid = true; setTimeout(() => this.bark('temb'), 1800); }
      return true;
    },

    // Cofre de suministros tras cada oleada: siempre trae munición y algo más, lo justo para
    // aguantar el principio de la siguiente
    spawnCase() {
      const items = [];
      const guns = player.weapons.map((s) => G.Weapons.get(s.id)).filter((w) => G.Weapons.isGun(w));
      const ammoOf = (w) => G.Weapons.AMMO[w.ammo].item;
      // lo justo: algo de munición y uno o dos materiales (la chocolatina, de vez en cuando)
      // munición de dos de tus armas (de las que llevas en las manos), algo más generosa que antes
      const inHand = guns.filter((w) => player.hands.some((h) => h && h.id === w.id) && G.Weapons.AMMO[w.ammo] && w.ammo !== 'gas');
      const kinds = [];
      for (const w of inHand) if (kinds.indexOf(w.ammo) < 0) kinds.push(w.ammo);
      shuffle(kinds);
      for (const a of kinds.slice(0, 2)) { const bx = G.Weapons.AMMO[a].box; items.push({ id: G.Weapons.AMMO[a].item, cond: rint(bx[0] + 1, bx[1] + 1) }); }
      const extra = [['alcohol', 0.4, 1], ['trapo', 0.35, 1], ['clavos', 0.3, 1], ['polvo', 0.2, 1], ['venda', 0.15, 1], ['chocolatina', 0.1, 1]];
      for (const [id, p, n] of extra) if (items.length < 4 && Math.random() < p) items.push({ id, cond: n });
      if (items.length < 2) items.push({ id: Math.random() < 0.5 ? 'alcohol' : 'trapo', cond: 1 });
      // dónde: a la vista, a unos metros, en el suelo libre
      const W = G.World, A0 = W.ARENA_MIN + 3, A1 = W.ARENA_MAX - 3;
      let best = null, bs = -Infinity;
      for (let i = 0; i < 60; i++) {
        const x = U.lerp(A0, A1, Math.random()), z = U.lerp(A0, A1, Math.random());
        if (W.circleBlocked(x, z, 0.5, 0) || W.furnTop(x, z, 0, 0.4) > 0) continue;
        const d = Math.hypot(x - player.pos.x, z - player.pos.z);
        const s = -Math.abs(d - 11) - (W.hasLOS(player.pos.x, player.pos.z, x, z, 0) ? 0 : 3);
        if (s > bs) { bs = s; best = { x, z }; }
      }
      if (!best || !G.Refugio) return;
      st.cases.push(G.Refugio.spawnCase(best.x, best.z, items));
      setTimeout(() => this.bark('chest'), 1300);
      if (this.onMessage) this.onMessage('Apareció un cofre con suministros', 'good');
    },

    // Desafío de la carrera completado (una vez por carrera): multiplica las recompensas de este enfrentamiento
    chal(id) {
      if (!this.retorno || !G.Run || !G.Run.active) return;
      const r = G.Run.challenge(id, player);
      if (!r) return;
      if (this.onMessage) this.onMessage('Desafío completado: ' + r.c.name + ' · recompensas ×' + String(r.total).replace('.', ','), 'good');
      if (G.Audio) G.Audio.play('pickup');
    },

    // cosas que pasan en la batalla del jefe: 'dodge' (esquivas un agarre), 'machine' (destroza una máquina)
    bossEvent(kind) {
      if (!this.active || !st || st.type !== 'jefe') return;
      if (kind === 'dodge') {
        st.dodges = (st.dodges || 0) + 1;
        this.achieve('esquiva');
        if (st.dodges >= 3) this.chal('jefe_esquiva');
      } else if (kind === 'machine') {
        st.mach = (st.mach || 0) + 1;
        if (st.mach >= 10) this.achieve('demolicion');
      }
    },
    // logro (para siempre; también fuera de una carrera)
    // ---------- Desafíos y logros contra los escorpiones ----------
    humanDown(z) {
      if (z.ally) return;
      st.hk = (st.hk || 0) + 1;
      if (st.hk === 1 && z.role === 'lider') this.chal('esc_lider');
      const kb = z.killedBy;
      if (kb !== 'gun' && kb !== 'fire' && kb !== 'explosion' && kb !== 'friendly' && kb !== 'ally' && kb !== 'hongo' && kb !== 'arrow') { st.hMelee = (st.hMelee || 0) + 1; if (st.hMelee >= 3) this.chal('esc_golpes'); }
      if (player.hostage && player.hostage.h && player.hostage.h !== z && player.hostage.h.alive) this.chal('esc_rehen');
      if (st.escaper === z && !z.gone) this.chal('esc_fuga');
      this.achieve('picadura');
      let n = 0;
      try { n = (+localStorage.getItem('ceniza.escorpiones') || 0) + 1; localStorage.setItem('ceniza.escorpiones', String(n)); } catch (e) { /* nada */ }
      if (n >= 50) this.achieve('exterminio');
    },
    // lo avisa humans.js: 'hostage' (tomas un rehén), 'spare' (dejas ir a uno), 'exec' (ejecutas al rehén)
    humanEvent(kind) {
      if (!this.active || !st) return;
      if (kind === 'hostage') this.achieve('rehen');
      if (kind === 'exec') this.achieve('sin_trato');
      if (kind === 'spare') { this.achieve('clemencia'); st.spared = (st.spared || 0) + 1; if (st.spared >= 2) this.chal('esc_perdon'); }
    },
    // modalidad completada (para el logro de las cuatro)
    modeDone(kind) {
      try {
        const k = 'ceniza.modos', r = JSON.parse(localStorage.getItem(k) || '{}') || {};
        r[kind] = 1; localStorage.setItem(k, JSON.stringify(r));
        if (r.asalto && r.caza && r.saqueo && r.resistencia) this.achieve('cuatro');
      } catch (e) { /* nada */ }
    },

    achieve(id) {
      const a = G.Run && G.Run.achieve(id);
      if (!a) return;
      if (this.onMessage) this.onMessage('Logro desbloqueado: ' + a.name, 'good');
      if (G.Audio) G.Audio.play('pickup');
    },

    // fin de la caza: los que quedan se van (un fundido a negro y ya no están)
    clearRest() {
      for (const z of st.list) {
        if (!z.alive) continue;
        if (player.struggle && player.struggle.z === z) player.struggle = null;
        if (player.beaten && player.beaten.z === z) player.beaten = null;
        const i = G.Population.list.indexOf(z);
        if (i >= 0) G.Population.list.splice(i, 1);
        z.dispose();
      }
      st.list = st.list.filter((z) => !z.alive || false);
      if (st.humans && G.Humans) G.Humans.reset();
    },

    // ---------- Cada fotograma ----------
    update(dt) {
      if (!this.active || !st || player.dead) return;
      const s = this.stats;
      if (st.phase !== 'stats') s.time += dt;
      if (st.titleT > 0) { st.titleT -= dt; if (st.titleT <= 0) $['m-title'].classList.add('out'); }
      st.hurtHp = player.health;
      // munición de tus armas que va apareciendo mientras peleas (si en el suelo queda poca)
      if (this.fighting && st.type !== 'jefe' && G.Pickups.refillAmmo) G.Pickups.refillAmmo(dt, player);
      // muertes nuevas (y lo que sueltan)
      for (const z of st.list) {
        if (z.alive || st.seen.has(z)) continue;
        st.seen.add(z);
        if (z.killedBy === 'hongo') continue;            // (se lo comió el hongomorfo: no cuenta)
        s.kills++;
        if (z.human) this.humanDown(z);
        if (z.killedBy === 'gun') s.gunKills++;
        else s.melee++;
        if (z.killedBy === 'stealth' && !st.chal) {
          st.chal = true; this.renderChal();
          player.items.venda = Math.min(player.items.venda + 2, G.Weapons.SUPPLY.venda.cap[player.backpack ? 1 : 0]);
          if (this.onMessage) this.onMessage('Desafío completado: +2 vendas', 'good');
        }
        // desafíos de la carrera
        if (z.blind && z.killedBy === 'stealth') this.chal('sigilo_chasq');
        if (z.temb && z.killedBy === 'fire' && z.burnSrc === 'molotov') this.chal('molotov_temb');
        if (z.killedBy === 'exec') st.execN = (st.execN || 0) + 1;
        if (s.head >= 5) this.chal('cabezas');
        if (Math.max(s.exec, st.execN || 0) >= 3) this.chal('remates');
        if (st.type === 'caza' && s.kills >= 15) this.chal('cazador');
        const k = z.temb ? 'temb' : z.blind ? 'blind' : z.stalker ? 'stalker' : 'runner';
        if (G.Pickups.drop && !z.hongo && !z.nemi && !z.human) G.Pickups.drop(z, player, DROP[k], 1);
        st.corpses.push(z);
        if (z.killedBy !== 'exec' && z.killedBy !== 'stealth') this.bark('kill');
      }
      // los cadáveres más viejos se hunden y desaparecen (rendimiento)
      while (st.corpses.length > MAX_CORPSES) {
        const z = st.corpses[0];
        if (z.fall < 1) break;
        z.sink = (z.sink || 0) + dt * 0.35;
        z.lift = -z.sink;
        if (z.sink > 0.45) {
          st.corpses.shift();
          const i = G.Population.list.indexOf(z);
          if (i >= 0) G.Population.list.splice(i, 1);
          const j = st.list.indexOf(z);
          if (j >= 0) st.list.splice(j, 1);
          z.dispose();
        } else break;
      }
      // chasqueadores: se acercan a donde estás aunque no hagas ruido (a tientas)
      st.blindT -= dt;
      if (st.blindT <= 0) {
        st.blindT = 4;
        for (const z of st.list) {
          if (!z.alive || !z.blind || !z.hunter || !(z.state === 'idle' || z.state === 'wander')) continue;
          z.target = { x: player.pos.x + (Math.random() - 0.5) * 7, z: player.pos.z + (Math.random() - 0.5) * 7, lv: player.lv || 0 };
          z.enter('investigate', 9);
        }
      }

      if (st.type === 'jefe') this.bossUpdate(dt);
      if (st.ally) st.ally.update(dt, player, G.Population.list);
      switch (st.phase) {
        case 'prep':
          st.t -= dt;
          if (st.type === 'escuadron' && st.squad && st.squad.active) st.t = Math.min(st.t, 0);
          this.setTimer(this.prepLabel(), st.t);
          if (st.t <= 0) {
            if (st.type === 'jefe') {
              // ¡fuera! derriba la pared y entra
              st.phase = 'boss'; this.fighting = true;
              st.bossT0 = this.stats.time; st.hurt0 = this.stats.hurt; st.mach = 0; st.dodges = 0;
              this.setTimer(null);
              $['m-title'].classList.add('out');
              if (st.boss && st.arena) { st.boss.burstOut(st.arena.breach); }
              setTimeout(() => this.bark('boss'), 2600);
              if (this.onMessage) this.onMessage('¡El hongomorfo! Que no te agarre', 'bad');
            } else if (st.type === 'saqueo') {
              st.phase = 'raid'; st.left = st.total; this.fighting = true;
              $['m-title'].classList.add('out');
              $['m-wave'].classList.remove('hidden');
              if (this.onMessage) this.onMessage('¡Saquea la caja fuerte antes de que se acabe el tiempo!', 'bad');
              if (st.safe && G.Refugio && G.Refugio.ping) G.Refugio.ping(st.safe.x, st.safe.z, 'chest', 6);
            } else if (st.type === 'resistencia') {
              st.phase = 'hold'; st.left = st.total; st.pulse = 0; st.pulseT = 0.5; this.fighting = true;
              $['m-title'].classList.add('out');
              $['m-wave'].classList.remove('hidden');
              if (this.onMessage) this.onMessage('¡Que no lleguen a ' + (st.ally ? st.ally.name : 'tu compañero') + '!', 'bad');
            } else if (st.type === 'caza') { st.phase = 'hunt'; st.left = st.total; st.spawnT = 0.5; this.fighting = true; $['m-title'].classList.add('out'); this.bark('wave'); if (this.onMessage) this.onMessage('¡Aguanta hasta el regreso!', 'bad'); }
            else this.beginWave(1);
          }
          break;
        case 'wave': {
          st.spawnT -= dt;
          const alive = st.list.filter((z) => z.alive && !z.gone && !z.spared).length;
          // asalto humano, segunda oleada: el último tira humo y huye a por su grupo (si se escapa o cae, viene la tercera)
          if (st.humans && st.wave === 2 && alive === 1 && !st.escaper) {
            const h = st.list.find((z) => z.alive && !z.gone && !z.spared);
            if (h && h.state !== 'hostage' && h.state !== 'beg') { st.escaper = h; h.escapeForHelp(player); if (this.onMessage) this.onMessage(h.name + ' huye a buscar a su grupo', 'bad'); }
          }
          if (st.escaper && st.escaper.alive && !st.escaper.gone && st.escaper.state !== 'flee' && (st.escaper.state === 'fight' || st.escaper.state === 'patrol' || st.escaper.state === 'idle' || st.escaper.state === 'check')) st.escaper.enter('flee', 0);
          if (st.queue.length && st.spawnT <= 0 && alive < st.alive) {
            if (this.spawnOne(st.queue[0])) st.queue.shift();
            st.spawnT = st.zone ? 0.12 : 0.9 + Math.random() * 1.2;
          }
          // el que te ve (o te oye y se lanza) ya no te suelta: a partir de ahí te busca aunque lo pierdas de vista
          let contact = false;
          for (const z of st.list) {
            if (!z.alive) continue;
            if (z.human) { contact = true; continue; }
            if (!z.hunter && HUNT_ON[z.state]) z.hunter = true;
            if (z.hunter) contact = true;
          }
          // si nadie te encuentra en mucho rato, deambulan poco a poco hacia tu zona (sin saber dónde estás)
          if (!contact && !st.queue.length) {
            st.calmT += dt;
            if (st.calmT > 75) {
              st.calmT = 55;
              for (const z of st.list) {
                if (!z.alive || !(z.state === 'idle' || z.state === 'wander')) continue;
                z.target = { x: player.pos.x + (Math.random() - 0.5) * 22, z: player.pos.z + (Math.random() - 0.5) * 22, lv: 0 };
                z.enter('wander', 14);
              }
            }
          }
          this.renderWave();
          const left = st.queue.length + alive;
          if (left === 1 && !st.lastSaid) { st.lastSaid = true; this.bark('last'); }
          if (left === 0) {
            st.lastSaid = false;
            this.fighting = false;
            $['m-wave'].classList.add('hidden');
            if (this.stats.hurt <= st.waveHurt && player.health >= st.waveHp - 0.01) this.chal('intacta');
            this.spawnCase();
            if (st.wave < 3) {
              st.phase = 'between'; st.t = BETWEEN;
              setTimeout(() => this.bark(st.humans && st.wave === 2 ? 'warned' : 'clear'), 600);
              if (this.onMessage) this.onMessage(st.humans && st.wave === 2 ? (st.escaper && st.escaper.gone ? 'Se escapó... prepárate: vuelven más' : 'Los disparos los atraerán... prepárate') : 'Oleada superada', 'good');
            } else {
              st.phase = 'complete'; st.t = BANNER;
              this.modeDone('asalto');
              if (st.humans) this.achieve('venganza');
              this.banner('ENFRENTAMIENTO COMPLETADO', BANNER);
              setTimeout(() => this.bark('done'), 900);
            }
          }
          break;
        }
        case 'squad': {
          this.renderWave();
          const sq = st.squad;
          if (!sq || sq.done) {
            this.fighting = false;
            $['m-wave'].classList.add('hidden');
            st.phase = 'complete'; st.t = BANNER;
            this.banner('ESCUADRÓN NEUTRALIZADO', BANNER);
            setTimeout(() => this.bark('squadDone'), 900);
          }
          break;
        }
        case 'between':
          st.t -= dt;
          this.setTimer('PRÓXIMA OLEADA EN…', st.t);
          if (st.t <= 0) this.beginWave(st.wave + 1);
          break;
        case 'hunt': {
          // caza: llegan sin parar, cada vez más seguido (como mucho 12 a la vez)
          st.left -= dt;
          const prog = 1 - Math.max(0, st.left) / st.total;
          this.setTimer('REGRESO AL REFUGIO EN', Math.max(0, st.left));
          st.spawnT -= dt;
          const alive = st.list.filter((z) => z.alive && !z.gone && !z.spared).length;
          if (st.humans) {
            // contra los escorpiones, más justo: 8 en total como mucho (exploradores, carroñeros y pistoleros),
            // no más de 4 a la vez
            if (st.spawnT <= 0 && alive < mul(4) && st.cazaN < mul(8)) {
              if (this.spawnHuman()) st.cazaN++;
              st.spawnT = st.cazaN < 2 ? 3 : U.lerp(14, 6, prog) * (0.8 + Math.random() * 0.4);
            }
            this.renderWave();
          } else if (st.spawnT <= 0 && alive < mul(CAZA_MAX)) {
            if (this.spawnOne({ kind: cazaKind() })) st.cazaN++;
            // los tres primeros llegan seguidos; luego, de 8 s a 2 s entre uno y otro
            st.spawnT = st.cazaN < 3 ? 1.2 + Math.random() : U.lerp(8, 2, Math.pow(prog, 1.2)) * (0.75 + Math.random() * 0.5) / emul();
          }
          if (st.left < 20 && !st.hurrySaid) { st.hurrySaid = true; this.bark('hurry'); }
          if (st.left <= 0) {
            this.modeDone('caza');
            st.phase = 'fade'; st.t = 0.55;
            this.fighting = false;
            this.setTimer(null);
            if (this.onFade) this.onFade(1, 0.5);
          }
          break;
        }
        case 'fade':
          st.t -= dt;
          if (st.t <= 0 && !st.cleared) {
            st.cleared = true;
            this.clearRest();
            if (this.onFade) this.onFade(0, 0.7);
            st.phase = 'complete'; st.t = BANNER;
            this.banner(st.endText || 'ENFRENTAMIENTO COMPLETADO', BANNER);
            setTimeout(() => this.bark(st.partial ? 'partial' : 'done'), 900);
          }
          break;
        case 'raid': this.updateRaid(dt); break;
        case 'hold': this.updateHold(dt); break;
        case 'complete':
          st.t -= dt;
          if (st.t <= 0) { st.phase = 'return'; st.t = RETURN; }
          break;
        case 'return':
          st.t -= dt;
          this.setTimer(st.type === 'jefe' ? 'SALIENDO DEL SALÓN' : 'REGRESANDO AL REFUGIO', st.t);
          if (st.t <= 0) { st.phase = 'stats'; this.setTimer(null); this.showStats(true); }
          break;
      }
    },

    // ---------- Puntuación ----------
    score(win) {
      const s = this.stats;
      const acc = s.shots ? s.hits / s.shots : 0;
      const caza = st && (st.type === 'caza' || st.type === 'resistencia'), jefe = st && st.type === 'jefe', esc = st && st.type === 'saqueo';
      const sqs = esc && st.squad ? st.squad.stats : null;
      const left = esc && st.squad ? st.squad.members.filter((h) => h.alive && !h.gone && !h.spared).length : 0;
      const rows = esc ? [
        ['RENDIMIENTO', '', ''],
        ['Caja fuerte', st.partial ? 'sin abrir' : (win ? 'saqueada' : 'sin abrir'), st.partial || !win ? 0 : 120],
        ['Escorpiones en pie', left + ' de ' + (st.squadN || 0), Math.round((1 - left / Math.max(1, st.squadN || 1)) * 40)],
        ['Finalización por tiempo', fmtTime(s.time), win ? Math.max(0, Math.round(100 - Math.max(0, s.time - 240) / 5)) : 0],
        ['Daño recibido', Math.round(s.hurt), Math.max(0, Math.round(100 - s.hurt * 0.6))],
        ['Precisión', s.shots ? Math.round(acc * 100) + ' %' : '—', Math.round(acc * 100)],
        ['BONIFICACIÓN', '', ''],
        ['Eliminados', s.kills, s.kills * 6],
        ['Perdonados', sqs ? sqs.spared : 0, (sqs ? sqs.spared : 0) * 10],
        ['Huyeron', sqs ? sqs.fled : 0, (sqs ? sqs.fled : 0) * 4],
        ['Rehenes tomados', sqs ? sqs.hostages : 0, (sqs ? sqs.hostages : 0) * 10],
        ['Disparos a la cabeza', s.head, s.head * 5],
        ['Remates', s.exec, s.exec * 5],
        ['Desafío: matar por sorpresa', st && st.chal ? 1 : 0, st && st.chal ? 20 : 0]
      ] : jefe ? [
        ['RENDIMIENTO', '', ''],
        ['Hongomorfo', win ? 'derrotado' : Math.round(Math.max(0, st.boss ? st.boss.hp / st.boss.hpMax : 1) * 100) + ' % de vida', win ? 200 : 0],
        ['Blindado', st.nemi ? (st.nemi.alive ? 'vivo' : 'eliminado') : '—', st.nemi && !st.nemi.alive ? 60 : 0],
        ['Finalización por tiempo', fmtTime(s.time), win ? Math.max(0, Math.round(100 - Math.max(0, s.time - 180) / 4)) : 0],
        ['Daño recibido', Math.round(s.hurt), Math.max(0, Math.round(100 - s.hurt * 0.6))],
        ['Precisión', s.shots ? Math.round(acc * 100) + ' %' : '—', Math.round(acc * 100)],
        ['BONIFICACIÓN', '', ''],
        ['Disparos a la cabeza', s.head, s.head * 5],
        ['Forcejeos ganados', s.escapes, s.escapes * 5]
      ] : [
        ['RENDIMIENTO', '', ''],
        caza ? ['Supervivencia', win ? 'completa' : fmtTime(st.total - Math.max(0, st.left)), win ? 100 : 0]
          : ['Finalización del enfrentamiento', win ? '' : 'oleada ' + (st ? st.wave : 0) + '/3', win ? 100 : 0],
        caza ? ['Infectados eliminados', s.kills, Math.min(100, s.kills * 6)]
          : ['Finalización por tiempo', fmtTime(s.time), win ? Math.max(0, Math.round(100 - Math.max(0, s.time - 240) / 6)) : 0],
        ['Daño recibido', Math.round(s.hurt), Math.max(0, Math.round(100 - s.hurt * 0.6))],
        ['Precisión', s.shots ? Math.round(acc * 100) + ' %' : '—', Math.round(acc * 100)],
        ['BONIFICACIÓN', '', ''],
        ['Aturdir', s.stun, s.stun * 5],
        ['Muertes cuerpo a cuerpo', s.melee, s.melee * 5],
        ['Remates', s.exec, s.exec * 5],
        ['Disparos a la cabeza', s.head, s.head * 5],
        ['Forcejeos ganados', s.escapes, s.escapes * 5],
        ['Desafío: matar por sorpresa', st && st.chal ? 1 : 0, st && st.chal ? 20 : 0]
      ];
      let total = 0;
      for (const r of rows) if (typeof r[2] === 'number') total += r[2];
      return { rows, total };
    },

    showStats(win) {
      const { rows, total } = this.score(win);
      let h = '';
      for (const r of rows) {
        if (r[2] === '') h += '<div class="ms-sec"><span>' + r[0] + '</span><span>ESTADÍSTICAS</span><span>PUNTAJE</span></div>';
        else h += '<div class="ms-row"><span>' + r[0] + '</span><span>' + r[1] + '</span><span>' + r[2] + '</span></div>';
      }
      $['m-rows'].innerHTML = h;
      $['m-total'].textContent = total;
      const jefe = st && st.type === 'jefe';
      el('m-stitle').textContent = st && st.partial ? 'TIEMPO AGOTADO · UN CUARTO DE LA RECOMPENSA' : (win ? (jefe ? 'JEFE DERROTADO' : 'ENFRENTAMIENTO COMPLETADO') : 'ENFRENTAMIENTO FALLIDO');
      const mm = document.querySelector('#m-stats .ms-mode');
      if (mm) mm.textContent = jefe ? 'SALÓN RECREATIVO · JEFE FINAL' : (G.World.mapName || 'CAMPO DE PRUEBAS').toUpperCase() + ' · ' + ({ caza: 'CAZA', saqueo: 'SAQUEO', resistencia: 'RESISTENCIA' }[st && st.type] || 'ASALTO') + (st && st.humans && st.type !== 'saqueo' ? ' · ESCORPIONES' : '');
      $['m-stats'].classList.remove('hidden');
      $['mode-hud'].classList.add('hidden');
      if (this.onFinish) this.onFinish(win, total);
    },

    // para la pantalla de muerte
    summary() {
      if (!this.active || !st) return '';
      if (st.type === 'resistencia') return 'Resistencia · ' + fmtTime(st.total - Math.max(0, st.left)) + ' de ' + fmtTime(st.total) + ' · ' + (st.ally ? st.ally.name + ': ' + Math.ceil(Math.max(0, st.ally.life / st.ally.lifeMax) * 100) + ' %' : '');
      if (st.type === 'saqueo') { const sq = st.squad, n = sq ? sq.members.filter((h) => h.alive && !h.gone && !h.spared).length : 0; return 'Escorpiones · quedaban ' + n + ' de ' + (st.squadN || 0) + ' en pie · Eliminados: ' + this.stats.kills; }
      if (st.type === 'jefe') return 'Jefe final · Hongomorfo: ' + (st.boss && !st.boss.alive ? 'derrotado' : Math.round(Math.max(0, st.boss ? st.boss.hp / st.boss.hpMax : 1) * 100) + ' % de vida');
      return (st.type === 'caza' ? 'Caza · ' + fmtTime(st.total - Math.max(0, st.left)) + ' de ' + fmtTime(st.total) : 'Asalto · oleada ' + st.wave + '/3') +
        ' · Infectados eliminados: ' + this.stats.kills;
    },
    get phase() { return st ? st.phase : null; },
    get type() { return st ? st.type : null; },
    skip() { if (st) { st.t = 0; st.spawnT = 0; if (st.phase === 'hunt') st.left = Math.min(st.left, 0.01); } },   // para pruebas
    get wave() { return st ? st.wave : 0; },
    get list() { return st ? st.list : []; },
    waveQueue
  };

  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ' min ' + (s < 10 ? '0' : '') + s + ' s'; }

  G.Mode = Mode;
})(window.Game = window.Game || {});
