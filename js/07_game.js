/**
 * 07_game.js — игровой цикл, полевое состояние, измерения, оценка.
 * Логика отделена от DOM: UI вызывает методы Game, Game не строит HTML.
 */
(function (root) {
  'use strict';
  var GEO = root.GEO;
  var SM = GEO.SurveyMath;
  var M4 = GEO.GL.M4;
  var ARCSEC = SM.ARCSEC;
  var D2R = Math.PI / 180;
  var BASE_FOV = 48 * D2R;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmtSigned(v) { return (v >= 0 ? '+' : '') + v.toFixed(3); }

  function Game() {
    this.canvas = document.getElementById('gl');
    this.renderer = new GEO.GL.Renderer(this.canvas);
    this.levels = (GEO.LEVELS || []).slice().sort(function (a, b) { return a.order - b.order; });
    this.settings = this.loadSettings();
    this.progress = this.loadProgress();
    this.ui = new GEO.UI(this);
    this.mode = 'title';
    this.level = null;
    this.session = null;
    this.world = null;
    this.lastResults = null;
    this.captured = null;
    this.lastMeasure = null;
    this.keys = {};
    this.levelingActive = false;
    this.titleAngle = 0;
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsT = performance.now();
    this.hudT = 0;
    this.timerT = 0;
    this.minimapT = 0;
    this.finished = false;
    this.audioCtx = null;
    this.player = { x: 0, z: 9.4, yaw: 0, pitch: -0.03 };
    this.loadTitleWorld();
    this.bindEvents();
    this.ui.showTitle();
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  Game.prototype.loadTitleWorld = function () {
    if (this.world) this.world.dispose();
    var titleLevel = deepClone(this.levels[0]);
    this.applyTerrainToLevel(titleLevel);
    this.world = new GEO.World(this.renderer, titleLevel);
    this.world.tripodVisible = true;
    this.world.topVisible = true;
    this.mode = 'title';
  };

  Game.prototype.loadSettings = function () {
    var def = { sensitivity: 1, zoomSensitivity: 1, quality: 1, sound: true, shake: false, showTips: true };
    try {
      var raw = localStorage.getItem('geodezist.settings.v1');
      if (raw) return Object.assign(def, JSON.parse(raw));
    } catch (e) { /* localStorage может быть недоступен */ }
    return def;
  };
  Game.prototype.loadProgress = function () {
    try {
      var raw = localStorage.getItem('geodezist.progress.v1');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {};
  };
  Game.prototype.saveSettings = function (patch) {
    Object.assign(this.settings, patch || {});
    try { localStorage.setItem('geodezist.settings.v1', JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
    if (patch && patch.quality) this.renderer.resize(window.innerWidth, window.innerHeight, this.dpr());
    if (this.ui.modalOpen && this.ui.menuTab === 'settings') { /* остаёмся в меню */ }
  };
  Game.prototype.resetProgress = function () {
    this.progress = {};
    try { localStorage.setItem('geodezist.progress.v1', '{}'); } catch (e) { /* ignore */ }
  };
  Game.prototype.dpr = function () {
    return Math.min(window.devicePixelRatio || 1, 2) * (this.settings.quality || 1);
  };

  Game.prototype.saveProgress = function (total, completed) {
    var id = this.level.id;
    var prev = this.progress[id] || { best: 0, attempts: 0 };
    this.progress[id] = {
      best: Math.max(prev.best || 0, Math.round(total)),
      last: Date.now(),
      completed: prev.completed || completed,
      attempts: (prev.attempts || 0) + 1
    };
    try { localStorage.setItem('geodezist.progress.v1', JSON.stringify(this.progress)); } catch (e) { /* ignore */ }
  };

  /* ------------------------------------------------------------- level flow */
  Game.prototype.startCustomLevel = function (lvl) {
    lvl.id = lvl.id || ('custom_' + Date.now());
    lvl.order = lvl.order || (this.levels.length + 1);
    this.levels.push(lvl);
    this.startLevel(lvl.id);
    var st = this.level.station;
    this.player.x = st.x - 1000;
    this.player.z = -(st.y - 2000) + 2.2;
    this.player.yaw = 0;
    this.aimAtBacksight();
    this.ui.toast('Свободное задание: ' + this.level.title, 'good');
    return true;
  };

  Game.prototype.applyTerrainToLevel = function (lvl) {
    function setZ(o) {
      if (!o || !isFinite(o.x) || !isFinite(o.y)) return;
      o.z = 100 + GEO.terrainHeightSurvey(o.x, o.y);
    }
    setZ(lvl.station);
    setZ(lvl.backsight);
    (lvl.stations || []).forEach(setZ);
    (lvl.controlPoints || []).forEach(setZ);
    (lvl.targets || []).forEach(setZ);
    (lvl.designPoints || []).forEach(setZ);
  };

  Game.prototype.startLevel = function (id) {
    var src = this.levels.filter(function (l) { return l.id === id; })[0];
    if (!src) return;
    this.level = deepClone(src);
    this.applyTerrainToLevel(this.level);
    this.controls = (this.level.controlPoints || (this.level.backsight ? [this.level.backsight] : [])).map(function (c) {
      return {
        id: c.id, x: c.x, y: c.y, z: c.z, prismHeight: c.prismHeight,
        kind: 'control', control: true, required: false,
        note: c.note || 'Пункт привязки'
      };
    });
    this.stations = (this.level.stations || [this.level.station]).map(function (s) {
      return { id: s.id, x: s.x, y: s.y, z: s.z, note: s.note || '' };
    });
    if (this.world) this.world.dispose();
    this.world = new GEO.World(this.renderer, this.level);
    this.world.tripodVisible = false;
    this.world.topVisible = false;
    this.session = this.createSession();
    this.targets = this.buildTargets();
    this.applySavedNames();
    this.mode = 'walk';
    this.finished = false;
    this.captured = null;
    this.lastMeasure = null;
    this.levelingActive = false;
    this.player = { x: 0, z: 9.4, yaw: 0, pitch: -0.03 };
    this.ui.modalOpen = false;
    this.ui.root.innerHTML = '';
    document.body.classList.remove('modal-open');
    this.ui.setScope(false);
    this.ui.showGameHud();
    this.ui.rebuildLabels();
    this.ui.setLockHint(false);
    this.ui.prompt(null);
    this.aimAtBacksight();
    this.ui.toast(this.level.title + ' — ' + this.level.goal, 'good');
    if (this.stations && this.stations.length > 1) {
      this.ui.toast('Смена станции: меню «Станция» → ' + this.stations.map(function (s) { return s.id; }).join(' / ') +
        '. Тахеометр можно перенести на другую точку.', 'info');
    }
    this.requestLock();
  };

  Game.prototype.buildTargets = function () {
    var list = (this.controls || []).slice();
    var ids = {};
    list.forEach(function (c) { ids[c.id] = true; });
    (this.level.targets || []).forEach(function (t) {
      if (!ids[t.id]) { list.push(t); ids[t.id] = true; }
    });
    return list;
  };

  Game.prototype.controlById = function (id) {
    if (!this.controls) return null;
    for (var i = 0; i < this.controls.length; i++) {
      if (this.controls[i].id === id) return this.controls[i];
    }
    return null;
  };

  Game.prototype.stationById = function (id) {
    if (!this.stations) return null;
    for (var i = 0; i < this.stations.length; i++) {
      if (this.stations[i].id === id) return this.stations[i];
    }
    return null;
  };

  Game.prototype.activeStation = function () {
    return (this.session && this.session.setup.trueStation) || this.level.station;
  };

  Game.prototype.distanceToStation = function (st) {
    var a = st || this.activeStation();
    return Math.hypot(this.player.x - (a.x - 1000), this.player.z + (a.y - 2000));
  };

  /** Ближайшие пункты привязки к станциям — схема «линии хода». */
  Game.prototype.traverseLinks = function () {
    var controls = this.controls || [];
    var world = this.world;
    return (this.stations || []).map(function (st) {
      var best = null, bd = Infinity, bestVisible = false;
      controls.forEach(function (c) {
        var d = Math.hypot(c.x - st.x, c.y - st.y);
        var vis = world ? world.isVisible(st.x, st.y, c.x, c.y) : true;
        var score = vis ? d : d + 1000;
        if (score < bd) { bd = score; best = c; bestVisible = vis; }
      });
      if (!best) return null;
      return {
        station: st, control: best, dist: Math.hypot(best.x - st.x, best.y - st.y),
        visible: bestVisible,
        az: SM.normAz(Math.atan2(best.x - st.x, best.y - st.y))
      };
    }).filter(Boolean);
  };

  Game.prototype.nearestOtherStation = function (maxDist) {
    var cur = this.activeStation();
    var activeD = this.distanceToStation ? this.distanceToStation() : 99;
    var best = null, bestD = maxDist;
    (this.stations || []).forEach(function (st) {
      if (st.id === cur.id) return;
      var d = Math.hypot(this.player.x - (st.x - 1000), this.player.z + (st.y - 2000));
      if (d < bestD && d < activeD - 0.25 && Math.hypot(st.x - cur.x, st.y - cur.y) > 0.5) { bestD = d; best = st; }
    }, this);
    return best;
  };

  Game.prototype.createSession = function () {
    var lvl = this.level;
    var errors = new GEO.ErrorModel(lvl.errorModel || {}, (Date.now() % 100000) + 17);
    var setup = {
      installed: false,
      tripodPlaced: false,
      instrumentMounted: false,
      leveled: false,
      dataEntered: false,
      oriented: false,
      stationInput: { x: lvl.station.x, y: lvl.station.y, z: lvl.station.z },
      trueStation: { x: lvl.station.x, y: lvl.station.y, z: lvl.station.z, id: lvl.station.id },
      instrumentHeightInput: lvl.instrumentHeight,
      trueInstrumentHeight: lvl.instrumentHeight,
      centering: { east: 0, north: 0, value: 0 },
      tilt: { xArcsec: 0, yArcsec: 0 },
      tiltBase: { xArcsec: 0, yArcsec: 0 },
      screws: [0, 0, 0],
      orientation: 0,
      orientationErrorArcsec: 0,
      orientedFrom: null,
      checkResiduals: {},
      stationError: 0
    };
    var session = {
      setup: setup,
      errors: errors,
      engine: null,
      prismHeightInput: 1.5,
      aim: { az: 0, za: Math.PI / 2 },
      zoom: 4,
      focus: 26,
      journal: [],
      measureSeq: 0,
      stakeout: { selectedId: null, measurement: null, tracking: false },
      carrying: null,
      carryFaced: false,
      tutorial: (lvl.tutorial || []).map(function (s) { return { id: s.id, text: s.text }; }),
      tutorialDone: {},
      autoLevelUsed: false,
      startTime: performance.now(),
      elapsed: 0,
      checkDone: false
    };
    return session;
  };

  Game.prototype.aimAtBacksight = function () {
    var s = this.session;
    if (!s || !this.controls || !this.controls.length) return;
    var st = s.setup.trueStation || this.level.station;
    var cp = this.controls[0], best = Infinity;
    this.controls.forEach(function (c) {
      var d = Math.hypot(c.x - st.x, c.y - st.y);
      var vis = this.world ? this.world.isVisible(st.x, st.y, c.x, c.y) : true;
      var score = vis ? d : d + 1000;
      if (score < best) { best = score; cp = c; }
    }, this);
    var p = SM.cartesianToPolar({
      x: cp.x, y: cp.y, z: cp.z,
      stationX: st.x, stationY: st.y, stationZ: st.z,
      instrumentHeight: this.level.instrumentHeight, targetHeight: cp.prismHeight
    });
    s.aim.az = p.ha;
    s.aim.za = clamp(p.za, 0.04, Math.PI - 0.04);
  };

  Game.prototype.engineFor = function () {
    if (this.session.engine) return this.session.engine;
    var self = this;
    this.session.engine = new GEO.MeasurementEngine(this.level, this.session.setup, this.session.errors, function (x1, y1, x2, y2) {
      return self.world.isVisible(x1, y1, x2, y2);
    });
    return this.session.engine;
  };

  /* ------------------------------------------------------------- setup flow */
  Game.prototype.nearestPole = function (maxDist) {
    var self = this;
    var best = null;
    var bd = maxDist || 2.2;
    var box = this.world.boxSurvey;
    var bx = box.x - 1000, bz = -(box.y - 2000);
    if (this.world.boxPoles.length && Math.hypot(this.player.x - bx, this.player.z - bz) < bd) {
      return this.world.boxPoles[0];
    }
    this.world.poles.forEach(function (p, id) {
      if (p.control || self.session.carrying === id) return;
      var w = self.world.poleWorld(id);
      if (!w) return;
      var d = Math.hypot(self.player.x - w.x, self.player.z - w.z);
      if (d < bd) { bd = d; best = id; }
    });
    return best;
  };

  Game.prototype.takeNextFromBox = function () {
    if (!this.world.boxPoles.length) { this.ui.toast('Ящик пуст', 'warn'); return; }
    this.takePoleFromBox(this.world.boxPoles[0]);
  };

  Game.prototype.nearestPlacedPole = function (maxDist) {
    var self = this;
    var best = null, bd = maxDist;
    this.world.poles.forEach(function (p, id) {
      if (p.control || p.stored || self.session.carrying === id) return;
      var w = self.world.poleWorld(id);
      if (!w) return;
      var d = Math.hypot(self.player.x - w.x, self.player.z - w.z);
      if (d < bd) { bd = d; best = id; }
    });
    return best;
  };

  Game.prototype.pickUpPole = function (id) {
    var s = this.session;
    var p = this.world.poles.get(id);
    if (!p || p.control) {
      this.ui.toast('Пункт привязки несъёмный', 'warn');
      return;
    }
    var wasStored = !!p.stored;
    s.carrying = id;
    s.carryFaced = false;
    if (p.stored) this.world.takePole(id);
    if (s.stakeout.selectedId === id) {
      s.stakeout.measurement = null;
      s.stakeout.tracking = false;
    }
    this.playSound('click');
    this.ui.toast('Вы взяли вешку ' + id + (wasStored ? ' из ящика' : '') + '. E — поставить, R — развернуть отражатель.', 'good');
    this.ui.updateMission();
  };

  Game.prototype.takePoleFromBox = function (id) {
    var p = this.world && this.world.poles.get(id);
    if (!p || !p.stored) { this.ui.toast('Эта вешка не в ящике', 'warn'); return; }
    if (this.session.carrying) { this.ui.toast('Сначала поставьте текущую вешку', 'warn'); return; }
    if (this.ui.modalOpen) this.ui.closeModal();
    this.pickUpPole(id);
    this.ui.toast('Вешка ' + id + ' взята из ящика — отнесите её к точке задания', 'good');
  };

  Game.prototype.placementPose = function () {
    var fx = Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    var cand = this.world.collidePole({ x: this.player.x + fx * 0.9, z: this.player.z + fz * 0.9 }, 0.04);
    var wx = Math.round(cand.x / 0.05) * 0.05;
    var wz = Math.round(cand.z / 0.05) * 0.05;
    var s = this.session;
    var carried = s && s.carrying ? this.world.poles.get(s.carrying) : null;
    var snap = null;
    if (carried && carried.target) {
      var twx = carried.target.x - 1000, twz = -(carried.target.y - 2000);
      if (Math.hypot(wx - twx, wz - twz) < 0.7) {
        wx = twx; wz = twz;
        snap = carried.target;
      }
    }
    var nearPoint = null;
    (this.level.targets || []).forEach(function (t) {
      if (!t.required) return;
      if (snap && t.id === snap.id) return;
      if (Math.hypot(wx - (t.x - 1000), wz - (-(t.y - 2000))) < 0.7) nearPoint = t;
    });
    return {
      wx: wx, wz: wz,
      x: 1000 + wx,
      y: 2000 - wz,
      z: 100 + GEO.terrainHeightWorld(wx, wz),
      snapId: snap ? snap.id : null,
      snapName: snap ? this.pointName(snap.id) : null,
      nearId: nearPoint ? nearPoint.id : null,
      nearName: nearPoint ? this.pointName(nearPoint.id) : null
    };
  };

  Game.prototype.placePole = function () {
    var s = this.session;
    var id = s.carrying;
    if (!id) return;
    var p = this.world.poles.get(id);
    if (!p) { s.carrying = null; return; }
    var pose = this.placementPose();
    p.x = pose.x;
    p.y = pose.y;
    p.z = pose.z;
    p.stored = false;
    p.boxSlot = -1;
    var act = this.activeStation();
    p.prismAz = s.carryFaced
      ? SM.normAz(Math.atan2(act.x - p.x, act.y - p.y))
      : SM.normAz(this.player.yaw);
    p.moved = true;
    s.carrying = null;
    s.carryFaced = false;
    if (p.stakeout) {
      s.stakeout.selectedId = id;
      s.stakeout.measurement = null;
      s.stakeout.tracking = false;
    }
    var ref = this.level.targets.filter(function (t) { return t.id === id; })[0];
    if (ref && ref.required && ref.kind !== 'stakeout') {
      var off = Math.hypot(p.x - ref.x, p.y - ref.y);
      if (off > 0.45) {
        this.ui.toast('Вешка ' + id + ' стоит в ' + off.toFixed(1) + ' м от точки задания — измерение будет с ошибкой', 'warn');
      }
    }    if (!this.isPrismFacing(id)) {
      this.ui.toast('Отражатель ' + id + ' не развёрнут к тахеометру. Нажмите R рядом с вешкой.', 'warn');
    } else {
      this.ui.toast('Вешка ' + id + ' установлена', 'good');
    }
    this.playSound('click');
    this.ui.updateMission();
  };

  Game.prototype.poleIdForTarget = function (id) {
    var t = (this.level && this.level.targets || []).filter(function (x) { return x.id === id; })[0];
    return t && t.free && t.poleId ? t.poleId : id;
  };

  Game.prototype.facePrism = function (id) {
    var s = this.session;
    var pid = this.poleIdForTarget(id);
    var p = this.world.poles.get(pid);
    if (!p) {
      this.ui.toast('Выберите вешку для разворота отражателя', 'warn');
      return;
    }
    if (p.control) {
      this.ui.toast('Призма пункта привязки ' + pid + ' ориентирована постоянно', 'warn');
      return;
    }
    p.prismAz = SM.normAz(Math.atan2(this.activeStation().x - p.x, this.activeStation().y - p.y));
    if (s.carrying === pid) s.carryFaced = true;
    this.playSound('click');
    this.ui.toast('Отражатель ' + pid + ' развёрнут к тахеометру', 'good');
    if (this.mode === 'scope') {
      this.updateCapture();
      this.ui.updateHud(this.hudSnapshot());
    }
  };

  Game.prototype.isPrismFacing = function (id) {
    var pid = this.poleIdForTarget(id);
    var p = this.world.poles.get(pid);
    if (!p) return false;
    if (p.control) return true;
    var act = this.activeStation();
    var az = SM.normAz(Math.atan2(act.x - p.x, act.y - p.y));
    return Math.abs(SM.angleDiff(p.prismAz, az)) <= (GEO.PRISM_ACCEPTANCE || 0.6109);
  };

  Game.prototype.interact = function () {
    if (this.mode !== 'walk' || this.ui.modalOpen) return;
    var s = this.session;
    if (s.carrying) {
      this.placePole();
      return;
    }
    var pole = this.nearestPole(2.2);
    if (pole) {
      this.pickUpPole(pole);
      return;
    }
    var other = this.nearestOtherStation(3.2);
    if (other) {
      this.moveToStation(other.id);
      return;
    }
    var dist = this.distanceToStation();
    if (dist > 3.6) {
      this.ui.toast('Подойдите к штативу ' + this.activeStation().id + ' или к вешке', 'warn');
      return;
    }
    var setup = s.setup;
    this.markTutorial('walk');
    if (!setup.tripodPlaced || !setup.instrumentMounted) {
      this.ui.openSetup(0);
      return;
    }
    if (!setup.leveled) {
      this.openLeveling();
      return;
    }
    if (!setup.dataEntered) {
      this.ui.openSetup(2);
      return;
    }
    this.enterScope();
  };

  Game.prototype.setupTripod = function () {
    var setup = this.session.setup;
    if (setup.tripodPlaced) return;
    setup.tripodPlaced = true;
    this.world.tripodVisible = true;
    this.playSound('ok');
    this.ui.toast('Штатив установлен на станции. Теперь поставьте на него тахеометр.', 'good');
    this.ui.openSetup(0);
  };

  Game.prototype.moveToStation = function (id) {
    var st = this.stationById(id);
    if (!st || !this.session) return;
    var setup = this.session.setup;
    var cur = setup.trueStation || this.level.station;
    if (cur && cur.id === id) {
      this.ui.toast('Тахеометр уже стоит на станции ' + id, 'warn');
      return;
    }
    if (this.mode === 'scope') this.exitScope();
    setup.tripodPlaced = false;
    setup.instrumentMounted = false;
    setup.installed = false;
    setup.leveled = false;
    setup.dataEntered = false;
    setup.oriented = false;
    setup.orientedFrom = null;
    setup.orientation = 0;
    setup.orientationErrorArcsec = 0;
    setup.checkResiduals = {};
    setup.stationInput = { x: st.x, y: st.y, z: st.z };
    setup.trueStation = { x: st.x, y: st.y, z: st.z, id: st.id };
    setup.instrumentHeightInput = this.level.instrumentHeight;
    setup.tilt = { xArcsec: 0, yArcsec: 0 };
    setup.tiltBase = { xArcsec: 0, yArcsec: 0 };
    setup.screws = [0, 0, 0];
    this.session.engine = null;
    this.session.checkDone = false;
    this.session.stationChanges = (this.session.stationChanges || 0) + 1;
    delete this.session.tutorialDone.check;
    this.session.carrying = null;
    this.session.carryFaced = false;
    this.captured = null;
    this.lastMeasure = null;
    this.world.setInstrumentStation(st);
    this.world.tripodVisible = false;
    this.world.topVisible = false;
    this.world.facePrismsTo(st.x, st.y);
    this.player = {
      x: st.x - 1000,
      z: -(st.y - 2000) + 2.2,
      yaw: 0,
      pitch: -0.03
    };
    this.aimAtBacksight();
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Тахеометр перенесён на станцию ' + st.id + '. Соберите штатив и тахеометр заново.', 'good');
    this.ui.openSetup(0);
  };

  Game.prototype.mountInstrument = function () {
    var setup = this.session.setup;
    if (!setup.tripodPlaced) { this.ui.toast('Сначала установите штатив', 'warn'); return; }
    if (setup.instrumentMounted) return;
    setup.instrumentMounted = true;
    setup.installed = true;
    this.world.topVisible = true;
    setup.centering = this.session.errors.sampleCentering();
    setup.trueInstrumentHeight = this.level.instrumentHeight + this.session.errors.sampleHeight();
    setup.tiltBase = {
      xArcsec: (Math.random() * 2 - 1) * 120,
      yArcsec: (Math.random() * 2 - 1) * 120
    };
    setup.screws = [
      (Math.random() * 2 - 1) * 0.55,
      (Math.random() * 2 - 1) * 0.55,
      (Math.random() * 2 - 1) * 0.55
    ];
    this.recomputeTilt();
    this.playSound('ok');
    this.ui.toast('Тахеометр установлен на трегер. Приведите его в горизонт тремя винтами.', 'good');
    this.openLeveling();
  };

  Game.prototype.recomputeTilt = function () {
    var setup = this.session.setup;
    var dirs = [[0, 1], [-0.866, -0.5], [0.866, -0.5]];
    var x = setup.tiltBase.xArcsec, y = setup.tiltBase.yArcsec;
    for (var i = 0; i < 3; i++) {
      x += setup.screws[i] * dirs[i][0] * 110;
      y += setup.screws[i] * dirs[i][1] * 110;
    }
    setup.tilt = { xArcsec: x, yArcsec: y };
  };

  Game.prototype.setScrew = function (i, value) {
    var setup = this.session && this.session.setup;
    if (!setup || !setup.instrumentMounted) return;
    setup.screws[i] = clamp(value, -1, 1);
    this.recomputeTilt();
    var ok = Math.hypot(setup.tilt.xArcsec, setup.tilt.yArcsec) <= 30;
    this.ui.updateLeveling(setup.tilt, ok, setup.screws);
  };

  Game.prototype.openLeveling = function () {
    var setup = this.session.setup;
    if (!setup.instrumentMounted) { this.ui.openSetup(0); return; }
    this.levelingActive = true;
    this.ui.setLockHint(false);
    this.ui.openSetup(1);
  };

  Game.prototype.acceptLeveling = function (auto) {
    if (!this.levelingActive) return;
    var setup = this.session.setup;
    if (auto) {
      setup.screws = [0, 0, 0];
      setup.tiltBase = { xArcsec: (Math.random() * 2 - 1) * 4, yArcsec: (Math.random() * 2 - 1) * 4 };
      this.recomputeTilt();
      this.session.autoLevelUsed = true;
    } else {
      var mag = Math.hypot(setup.tilt.xArcsec, setup.tilt.yArcsec);
      if (mag > 30) {
        this.ui.toast('Наклон больше 30″ — тахеометр нельзя считать выставленным', 'bad');
        return;
      }
    }
    setup.leveled = true;
    this.levelingActive = false;
    this.markTutorial('level');
    this.playSound('ok');
    this.ui.toast('Тахеометр приведён в горизонт. Остаточный наклон ' +
      Math.hypot(setup.tilt.xArcsec, setup.tilt.yArcsec).toFixed(0) + '″', 'good');
    this.ui.updateMission();
    this.ui.openSetup(2);
  };

  Game.prototype.applyStationData = function (data) {
    var s = this.session, setup = s.setup;
    var wasOriented = setup.oriented;
    setup.stationInput = { x: data.x, y: data.y, z: data.z };
    setup.instrumentHeightInput = data.hi;
    setup.dataEntered = true;
    setup.oriented = false;
    setup.orientedFrom = null;
    setup.orientation = 0;
    setup.orientationErrorArcsec = 0;
    setup.checkResiduals = {};
    delete s.tutorialDone.check;
    s.checkDone = false;
    s.engine = null;
    this.engineFor();
    setup.stationError = Math.hypot(
      setup.stationInput.x - (setup.trueStation ? setup.trueStation.x : this.level.station.x),
      setup.stationInput.y - (setup.trueStation ? setup.trueStation.y : this.level.station.y)
    );
    this.markTutorial('data');
    this.markTutorial('setup');
    this.ui.closeModal();
    this.enterScope();
    this.ui.toast('Данные станции применены. Ориентируйтесь по ближайшему пункту (O), затем проверьте остальные (C).', 'good');
    if (wasOriented) this.ui.toast('Ориентирование сброшено: изменились исходные данные', 'warn');
    this.ui.updateMission();
    this.playSound('ok');
  };

  Game.prototype.enterScope = function () {
    if (!this.session || this.mode === 'title' || this.mode === 'results') return;
    var setup = this.session.setup;
    if (this.session.carrying) {
      this.ui.toast('Сначала поставьте вешку (E), затем входите в окуляр', 'warn');
      return;
    }
    if (!setup.tripodPlaced || !setup.instrumentMounted) {
      this.ui.openSetup(0);
      return;
    }
    if (!setup.leveled) {
      this.openLeveling();
      return;
    }
    if (!setup.dataEntered) {
      this.ui.openSetup(2);
      return;
    }
    if (this.ui.modalOpen) this.ui.closeModal();
    this.mode = 'scope';
    this.world.tripodVisible = false;
    this.world.topVisible = false;
    this.ui.setScope(true);
    this.ui.setLockHint(false);
    this.updateCapture();
    this.ui.updateHud(this.hudSnapshot());
    this.requestLock();
    this.ui.updateMission();
  };

  Game.prototype.exitScope = function () {
    if (this.mode !== 'scope') return;
    this.mode = 'walk';
    this.captured = null;
    this.world.tripodVisible = !!this.session.setup.tripodPlaced;
    this.world.topVisible = !!this.session.setup.instrumentMounted;
    this.ui.setScope(false);
    document.getElementById('gl').style.filter = 'none';
    this.ui.setLockHint(!document.pointerLockElement);
    this.ui.prompt(null);
  };

  /* ------------------------------------------------------------- orientation */
  Game.prototype.orientCurrent = function () {
    var s = this.session;
    if (!s || !s.setup.dataEntered) { this.ui.toast('Сначала введите исходные данные станции', 'warn'); return; }
    var cap = this.captured;
    var cp = cap ? this.controlById(cap.id) : null;
    if (!cap || !cp || !cap.hit) {
      this.ui.toast('Наведите перекрестие на призму пункта привязки BS1, BS2 или BS3', 'bad');
      this.playSound('error');
      return;
    }
    if (!cap.facing) {
      this.ui.toast('Призма пункта привязки не развёрнута к тахеометру', 'bad');
      this.playSound('error');
      return;
    }
    var res = this.engineFor().orient(cp, this.effectiveAim().az);
    s.setup.oriented = true;
    s.setup.orientedFrom = cp.id;
    s.setup.orientationErrorArcsec = res.errorArcsec;
    s.setup.checkResiduals = {};
    delete s.tutorialDone.check;
    s.checkDone = false;
    this.markTutorial('orient');
    this.playSound('ok');
    this.ui.toast('Ориентирование по ' + cp.id + ' выполнено. Ошибка ' + Math.abs(res.errorArcsec).toFixed(1) + '″' +
      (Math.abs(res.errorArcsec) > this.level.tolerance.orientationArcsec ? ' — больше допуска, проверьте наведение' : '') +
      '. Проверьте остальные пункты клавишей C.', 
      Math.abs(res.errorArcsec) > this.level.tolerance.orientationArcsec ? 'warn' : 'good');
    if (this.ui.modalOpen) this.ui.closeModal();
    this.ui.updateMission();
  };

  Game.prototype.checkCurrent = function () {
    var s = this.session;
    if (!s || !s.setup.oriented) { this.ui.toast('Сначала выполните ориентирование', 'warn'); return; }
    var cap = this.captured;
    var cp = cap ? this.controlById(cap.id) : null;
    if (!cap || !cp || !cap.hit) {
      this.ui.toast('Для контроля наведитесь на пункт привязки BS1, BS2 или BS3', 'bad');
      this.playSound('error');
      return;
    }
    if (!cap.facing) {
      this.ui.toast('Призма пункта привязки не развёрнута к тахеометру', 'bad');
      this.playSound('error');
      return;
    }
    var chk = this.engineFor().checkBacksight(cp, this.effectiveAim());
    s.setup.checkResiduals[cp.id] = chk.residualArcsec;
    var checked = Object.keys(s.setup.checkResiduals).length;
    s.checkDone = checked >= 2;
    if (s.checkDone) this.markTutorial('check');
    var tol = this.level.tolerance.orientationArcsec;
    this.ui.toast('Проверка ' + cp.id + ': ' + chk.residualArcsec.toFixed(1) + '″' +
      (Math.abs(chk.residualArcsec) <= tol ? ' — в допуске' : ' — превышает допуск') +
      ' · проверено ' + checked + ' из ' + this.controls.length,
      Math.abs(chk.residualArcsec) <= tol ? 'good' : 'warn');
    this.playSound(Math.abs(chk.residualArcsec) <= tol ? 'ok' : 'error');
    if (this.ui.modalOpen) this.ui.closeModal();
    this.ui.updateMission();
  };

  /* --------------------------------------------------------------- measuring */
  Game.prototype.currentTarget = function (id) {
    var t = (this.level.targets || []).filter(function (x) { return x.id === id; })[0];
    if (t && t.free && t.poleId) {
      var fp = this.world.poles.get(t.poleId);
      if (!fp || fp.freePointId !== id) return null;
      return {
        id: id, name: t.name || id, pointName: t.name || id, poleId: fp.id, poleName: fp.name || fp.id,
        x: fp.x, y: fp.y, z: fp.z, prismHeight: fp.prismHeight,
        truePrismHeight: fp.prismHeight, prismAz: fp.prismAz, control: false, free: true
      };
    }
    var p = this.world.poles.get(id);
    if (!p) return null;
    if (p.freePointId) return null;
    return {
      id: id, name: p.name || id, pointName: this.pointName(id), poleId: id, poleName: p.name || id,
      x: p.x, y: p.y, z: p.z, prismHeight: p.prismHeight,
      truePrismHeight: p.prismHeight, prismAz: p.prismAz, control: !!p.control
    };
  };

  Game.prototype.poleName = function (id) {
    var p = this.world && this.world.poles.get(id);
    return p ? (p.name || p.id) : id;
  };

  Game.prototype.pointName = function (id) {
    var t = (this.level && this.level.targets || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return id;
    return t.name || t.id;
  };

  Game.prototype.loadNames = function () {
    try { return JSON.parse(localStorage.getItem('geodezist.names.v1') || '{}'); } catch (e) { return {}; }
  };

  Game.prototype.saveName = function (kind, id, name) {
    try {
      var all = this.loadNames();
      var lvl = all[this.level.id] || (all[this.level.id] = { points: {}, poles: {} });
      lvl[kind] = lvl[kind] || {};
      lvl[kind][id] = name;
      localStorage.setItem('geodezist.names.v1', JSON.stringify(all));
    } catch (e) { /* localStorage may be unavailable */ }
  };

  Game.prototype.applySavedNames = function () {
    var all = this.loadNames();
    var n = all[this.level.id];
    if (!n) return;
    (this.level.targets || []).forEach(function (t) {
      if (n.points && n.points[t.id]) t.name = n.points[t.id];
    });
    (this.world && this.world.poleList || []).forEach(function (id) {
      var p = this.world.poles.get(id);
      if (p && n.poles && n.poles[id]) p.name = n.poles[id];
    }, this);
  };

  Game.prototype.gameFreeMode = function () {
    return !!(this.level && this.level.freeMode);
  };

  Game.prototype.addFreePoint = function () {
    var s = this.session;
    if (!s) return null;
    if (s.carrying) { this.ui.toast('Сначала поставьте вешку, затем нажмите T', 'warn'); return null; }
    var poleId = null;
    if (this.captured && this.captured.poleId) poleId = this.captured.poleId;
    else poleId = this.nearestPlacedPole(4.0);
    var p = poleId && this.world.poles.get(poleId);
    if (!p || p.control) { this.ui.toast('Подойдите к вешке на местности и нажмите T', 'warn'); return null; }
    if (p.stored) { this.ui.toast('Сначала возьмите вешку из ящика', 'warn'); return null; }
    var n = (s.freeSeq = (s.freeSeq || 0) + 1);
    var id = 'F' + n;
    var t = {
      id: id, name: 'Точка ' + n, x: p.x, y: p.y, z: p.z,
      prismHeight: p.prismHeight, kind: 'survey', required: false,
      free: true, poleId: p.id, note: 'Свободная точка'
    };
    p.freePointId = id;
    this.level.targets.push(t);
    this.targets.push(t);
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.playSound('ok');
    this.ui.toast('Точка ' + id + ' добавлена на месте вешки ' + p.id + '. Наведитесь и измерьте.', 'good');
    if (this.mode === 'scope') this.updateCapture();
    return t;
  };

  Game.prototype.freePointRows = function () {
    var seen = {};
    return (this.session ? this.session.journal : []).filter(function (r) {
      if (seen[r.pointId]) return false;
      seen[r.pointId] = true;
      return !!(r.pointId && r.pointId.charAt(0) === 'F');
    });
  };

  Game.prototype.poleNameForTarget = function (id) {
    var t = (this.level.targets || []).filter(function (x) { return x.id === id; })[0];
    if (t && t.free && t.poleId) return this.poleName(t.poleId);
    return this.poleName(id);
  };

  Game.prototype.renamePoint = function (id, name) {
    var t = (this.level && this.level.targets || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return false;
    var val = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!val) { this.ui.toast('Название точки не может быть пустым', 'bad'); return false; }
    t.name = val;
    this.saveName('points', id, val);
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Точка ' + id + ' подписана как «' + val + '»', 'good');
    return true;
  };

  Game.prototype.poleHeight = function (id) {
    var p = this.world && this.world.poles.get(id);
    return p ? p.prismHeight : 1.5;
  };

  Game.prototype.renamePole = function (id, name) {
    var p = this.world && this.world.poles.get(id);
    if (!p || p.control) { this.ui.toast('Пункт привязки переименовать нельзя', 'warn'); return false; }
    var val = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!val) { this.ui.toast('Имя вешки не может быть пустым', 'bad'); return false; }
    p.name = val;
    this.saveName('poles', id, val);
    if (this.captured && this.captured.id === id) this.captured.poleName = val;
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Вешка ' + id + ' теперь называется «' + val + '»', 'good');
    return true;
  };

  Game.prototype.setPoleHeight = function (id, h) {
    var p = this.world && this.world.poles.get(id);
    if (!p || p.control) { this.ui.toast('Высота пункта привязки фиксирована', 'warn'); return; }
    var val = clamp(Number(h), 0.5, 2.5);
    if (!isFinite(val)) return;
    p.prismHeight = val;
    p.target.prismHeight = val;
    this.session.prismHeightInput = val;
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Фактическая высота вешки ' + id + ': ' + val.toFixed(2) + ' м · в тахеометре ' + val.toFixed(2) + ' м', 'good');
    if (this.session.stakeout.measurement) this.updateTracking();
    this.ui.updateHud(this.hudSnapshot());
  };

  Game.prototype.currentHeightPole = function () {
    var s = this.session;
    if (!s) return null;
    if (s.carrying) return s.carrying;
    if (this.captured && !this.captured.control) return this.captured.poleId || this.captured.id;
    if (this.mode === 'walk') {
      var near = this.nearestPole(2.2);
      if (near) return near;
    }
    return null;
  };

  Game.prototype.openHeightEditor = function () {
    var id = this.currentHeightPole();
    if (!id) {
      this.ui.toast('Возьмите вешку, подойдите к ней или наведитесь на призму — тогда можно изменить высоту', 'warn');
      return;
    }
    this.ui.openHeightEditor(id);
  };

  Game.prototype.adjustPoleHeight = function (delta) {
    var id = this.currentHeightPole();
    if (id) {
      var p = this.world.poles.get(id);
      if (p) {
        this.setPoleHeight(id, p.prismHeight + delta);
        if (this.mode === 'scope') {
          this.updateCapture();
          this.ui.updateHud(this.hudSnapshot());
        }
        return;
      }
    }
    if (!this.session) return;
    this.session.prismHeightInput = clamp(+(this.session.prismHeightInput + delta).toFixed(2), 0.5, 2.5);
    this.ui.updateHud(this.hudSnapshot());
  };

  Game.prototype.addPracticePole = function () {
    var s = this.session;
    if (!s) return null;
    s.practiceSeq = (s.practiceSeq || 0) + 1;
    var seq = s.practiceSeq;
    var candidates = [[8, -4], [10, 7], [-7, 8], [-9, -2], [14, 6], [-12, 10], [6, 14], [-5, 15], [16, -2], [-14, -5], [2, 18], [-18, 4]];
    var chosen = null;
    for (var i = 0; i < candidates.length; i++) {
      var wx = candidates[i][0] + (seq % 3) * 1.5;
      var wz = candidates[i][1] + (seq % 2) * 1.5;
      var x = 1000 + wx, y = 2000 - wz;
      var free = true;
      var self = this;
      this.world.poles.forEach(function (p) {
        if (Math.hypot(p.x - x, p.y - y) < 2.2) free = false;
      });
      if (!free) continue;
      var c = this.world.collide({ x: wx, z: wz }, 0.3);
      if (Math.abs(c.x - wx) > 0.01 || Math.abs(c.z - wz) > 0.01) continue;
      chosen = { x: x, y: y, wx: wx, wz: wz };
      break;
    }
    if (!chosen) {
      chosen = { x: 1000 + 6, y: 2000 - 16, wx: 6, wz: 16 };
    }
    var t = {
      id: 'X' + seq,
      name: 'Вешка ' + seq,
      x: chosen.x,
      y: chosen.y,
      z: 100 + GEO.terrainHeightWorld(chosen.wx, chosen.wz),
      prismHeight: 1.5,
      kind: 'extra',
      required: false,
      practice: true,
      note: 'Практическая вешка'
    };
    this.level.targets.push(t);
    this.targets.push(t);
    this.world.addPole(t);
    this.world.storePole(t.id);
    var wp = this.world.poles.get(t.id);
    if (wp) {
      var act = this.activeStation();
      wp.prismAz = SM.normAz(Math.atan2(act.x - wp.x, act.y - wp.y));
    }
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Добавлена вешка ' + t.id + '. Её можно переименовать и перенести.', 'good');
    return t;
  };

  Game.prototype.removeLastPracticePole = function () {
    var practice = (this.targets || []).filter(function (t) { return t.practice; });
    if (!practice.length) {
      this.ui.toast('Практических вешек нет — сначала добавьте вешку', 'warn');
      return;
    }
    this.removePracticePole(practice[practice.length - 1].id);
  };

  Game.prototype.removePracticePole = function (id) {    var s = this.session;
    var p = this.world && this.world.poles.get(id);
    if (!p || p.control || !p.target.practice) {
      this.ui.toast('Удалять можно только добавленные практические вешки', 'warn');
      return;
    }
    this.world.removePole(id);
    this.level.targets = this.level.targets.filter(function (t) { return t.id !== id; });
    this.targets = this.targets.filter(function (t) { return t.id !== id; });
    s.journal = s.journal.filter(function (r) { return r.pointId !== id; });
    if (s.carrying === id) s.carrying = null;
    if (s.stakeout.selectedId === id) { s.stakeout.selectedId = null; s.stakeout.measurement = null; }
    if (this.captured && this.captured.id === id) this.captured = null;
    this.ui.rebuildLabels();
    this.ui.updateMission();
    this.ui.toast('Вешка ' + id + ' убрана', 'warn');
  };

  Game.prototype.measureCurrent = function () {
    if (this.mode !== 'scope' || this.ui.modalOpen) return;
    var s = this.session;
    if (!s || !s.engine) { this.ui.toast('Тахеометр не установлен', 'warn'); return; }
    if (!s.setup.oriented) {
      this.ui.toast('Сначала ориентируйте тахеометр по задней точке BS1 (O)', 'bad');
      this.playSound('error');
      return;
    }
    var cap = this.captured;
    if (!cap || !cap.hit) {
      if (cap && cap.facing === false) {
        this.ui.toast('Отражатель не развёрнут к тахеометру — нажмите R', 'bad');
      } else {
        this.ui.toast('Цель не захвачена: перекрестие должно быть в пределах призмы', 'bad');
      }
      this.ui.setTargetBadge(null);
      this.playSound('error');
      return;
    }
    var target = this.level.targets.filter(function (t) { return t.id === cap.id; })[0];
    if (!target) {
      target = this.targets.filter(function (t) { return t.id === cap.id; })[0];
    }
    if (!target) return;
    if (target.kind === 'stakeout') {
      this.measureStakeout(target);
      return;
    }
    var pt = this.currentTarget(target.id);
    var result = s.engine.measure(pt, this.effectiveAim(), { prismHeight: s.prismHeightInput });
    if (result.error) {
      this.showMeasureError(result.error);
      return;
    }
    var kind = target.kind === 'control' ? 'control' : (target.kind === 'extra' ? 'extra' : 'survey');
    var row = this.pushRow(result, kind, { x: target.x, y: target.y, z: target.z }, target.note);
    this.lastMeasure = row;
    if (kind !== 'control') this.markTutorial('measure');
    this.playSound('measure');
    var pname = this.pointName(target.id);
    this.ui.toast(pname + ' (' + this.poleNameForTarget(target.id) + '): X ' + row.x.toFixed(3) + ' · Y ' + row.y.toFixed(3) + ' · Z ' + row.z.toFixed(3) +
      ' · ошибка ' + row.errorXY.toFixed(3) + ' м', row.errorXY <= this.level.tolerance.xy ? 'good' : 'warn');
    this.afterMeasurement(kind);
  };

  Game.prototype.showMeasureError = function (code) {
    var text = 'Измерение не выполнено';
    if (code === 'NO_VISIBILITY') text = 'Нет видимости: цель закрыта препятствием';
    else if (code === 'PRISM_NOT_FACING') text = 'Отражатель не развёрнут к тахеометру — нажмите R';
    else if (code === 'NO_TARGET') text = 'Цель не захвачена';
    else if (code === 'NOT_ORIENTED') text = 'Сначала ориентируйте тахеометр';
    this.ui.toast(text, 'bad');
    this.playSound('error');
  };

  Game.prototype.pushRow = function (result, kind, ref, note) {
    var s = this.session;
    var row = {
      id: 'M' + (++s.measureSeq),
      pointId: result.targetId,
      pointName: this.pointName(result.targetId),
      poleName: this.poleNameForTarget(result.targetId),
      stationId: (this.session.setup.trueStation || this.level.station).id,
      kind: kind,
      ha: result.ha, za: result.za, sd: result.sd, hd: result.hd, dh: result.dh,
      x: result.x, y: result.y, z: result.z,
      prismHeight: result.prismHeight,
      time: s.elapsed,
      ref: ref ? { x: ref.x, y: ref.y, z: ref.z } : null,
      true: result.true,
      errorXY: ref ? Math.hypot(result.x - ref.x, result.y - ref.y) : null,
      errorZ: ref ? result.z - ref.z : null,
      note: note || ''
    };
    s.journal.push(row);
    return row;
  };

  Game.prototype.afterMeasurement = function (kind) {
    this.ui.updateMission();
    if (!kind || kind === 'survey' || kind === 'extra') this.markTutorial('survey');
    this.ui.updateHud(this.hudSnapshot());
  };

  Game.prototype.measureStakeout = function (target) {
    var s = this.session;
    var pt = this.currentTarget(target.id);
    var result = s.engine.measure(pt, this.effectiveAim(), { prismHeight: s.prismHeightInput });
    if (result.error) {
      this.showMeasureError(result.error);
      return;
    }
    if (s.stakeout.selectedId && s.stakeout.selectedId !== target.id) {
      this.ui.toast('Выбрана другая проектная точка: ' + target.id, 'warn');
    }
    s.stakeout.selectedId = target.id;
    s.stakeout.measurement = result;
    s.stakeout.tracking = true;
    this.lastMeasure = result;
    this.markTutorial('stake');
    this.playSound('measure');
    var d = this.stakeoutDelta();
    this.ui.toast(this.poleName(target.id) + ': ΔX ' + fmtSigned(d.dx) + ' · ΔY ' + fmtSigned(d.dy) + ' · ΔZ ' + fmtSigned(d.dz) +
      ' м. Команды — в меню «Вынос».', 'good');
    this.ui.updateMission();
    this.ui.updateHud(this.hudSnapshot());
  };

  Game.prototype.stakeoutDelta = function () {
    var s = this.session;
    var sel = s && s.stakeout.selectedId;
    if (!sel) return { dx: 0, dy: 0, dz: 0, xy: 0 };
    var d = this.level.targets.filter(function (t) { return t.id === sel; })[0];
    var m = s.stakeout.measurement;
    if (!d || !m) return { dx: 0, dy: 0, dz: 0, xy: 0 };
    var dx = d.x - m.x, dy = d.y - m.y, dz = d.z - m.z;
    return { dx: dx, dy: dy, dz: dz, xy: Math.hypot(dx, dy) };
  };

  Game.prototype.selectDesign = function (id) {
    var s = this.session;
    if (!s) return;
    s.stakeout.selectedId = id;
    s.stakeout.measurement = null;
    s.stakeout.tracking = false;
    this.ui.toast('Проектная точка ' + id + ' выбрана. Наведитесь на вешку и нажмите ЛКМ.', 'good');
  };

  Game.prototype.nudgePole = function (dir, step) {
    var s = this.session;
    var sel = s && s.stakeout.selectedId;
    if (!sel) return;
    var d = this.level.targets.filter(function (t) { return t.id === sel; })[0];
    var p = this.world.poles.get(sel);
    if (!d || !p) return;
    var dx = dir === 'E' ? step : (dir === 'W' ? -step : 0);
    var dy = dir === 'N' ? step : (dir === 'S' ? -step : 0);
    p.x += dx; p.y += dy;
    var ddx = p.x - d.x, ddy = p.y - d.y;
    var dist = Math.hypot(ddx, ddy);
    if (dist > 7) {
      p.x = d.x + ddx / dist * 7;
      p.y = d.y + ddy / dist * 7;
    }
    p.prismAz = SM.normAz(Math.atan2(this.activeStation().x - p.x, this.activeStation().y - p.y));
    p.z = 100 + GEO.terrainHeightSurvey(p.x, p.y);
    this.updateTracking();
    this.playSound('click');
    this.ui.updateHud(this.hudSnapshot());
  };

  Game.prototype.updateTracking = function () {
    var s = this.session;
    var sel = s && s.stakeout.selectedId;
    if (!sel || !s.stakeout.measurement || !s.engine) return;
    var pt = this.currentTarget(sel);
    var ta = s.engine.trueAngles(pt);
    var res = s.engine.measure(pt, { az: ta.ha, za: ta.za }, {
      prismHeight: s.prismHeightInput, tracking: true, allowOffTarget: true
    });
    if (!res.error) {
      s.stakeout.measurement = res;
      this.lastMeasure = res;
    } else if (res.error === 'PRISM_NOT_FACING') {
      s.stakeout.measurement = null;
    }
  };

  Game.prototype.fixStakeout = function () {
    var s = this.session;
    var sel = s && s.stakeout.selectedId;
    if (!sel || !s.stakeout.measurement) {
      this.ui.toast('Сначала измерьте вешку', 'warn');
      return;
    }
    var d = this.level.targets.filter(function (t) { return t.id === sel; })[0];
    var res = s.stakeout.measurement;
    var row = this.pushRow(res, 'stakeout', { x: d.x, y: d.y, z: d.z }, d.note);
    row.design = { x: d.x, y: d.y, z: d.z };
    s.stakeout.tracking = false;
    this.lastMeasure = row;
    this.markTutorial('fix');
    this.markTutorial('stake');
    this.playSound('success');
    var delta = this.stakeoutDelta();
    this.ui.toast('Точка ' + sel + ' зафиксирована. Плановая ошибка ' + delta.xy.toFixed(3) + ' м' +
      (delta.xy <= this.level.tolerance.xy ? ' — в допуске' : ' — вне допуска'), 
      delta.xy <= this.level.tolerance.xy ? 'good' : 'warn');
    this.ui.updateMission();
    this.afterMeasurement('stakeout');
  };

  /* --------------------------------------------------------------- tutorial */
  Game.prototype.markTutorial = function (id) {
    var s = this.session;
    if (!s) return;
    var exists = s.tutorial.some(function (t) { return t.id === id; });
    if (!exists) return;
    if (s.tutorialDone[id]) return;
    s.tutorialDone[id] = true;
    this.ui.updateMission();
  };

  Game.prototype.updateTutorial = function () {
    var s = this.session;
    if (!s || !s.tutorial.length) return;
    var done = s.tutorialDone;
    var before = Object.keys(done).length;
    if (this.distanceToStation() < 4.2) done.walk = true;
    if (s.setup.leveled) done.level = true;
    if (s.setup.dataEntered) { done.data = true; done.setup = true; }
    if (s.setup.oriented) done.orient = true;
    var journal = s.journal;
    if (journal.some(function (r) { return r.kind === 'survey' || r.kind === 'extra'; })) done.measure = true;
    if (journal.some(function (r) { return r.kind === 'stakeout'; })) { done.stake = true; done.fix = true; }
    if (s.checkDone) done.check = true;
    var self = this;
    var surveyReq = this.level.targets.filter(function (t) { return t.required && t.kind !== 'stakeout'; });
    if (surveyReq.length && surveyReq.every(function (t) { return self.isTargetDone(t.id); })) done.survey = true;
    if (Object.keys(done).length !== before) this.ui.updateMission();
  };

  /* ------------------------------------------------------------------ magic */
  Game.prototype.effectiveAim = function () {
    var aim = this.session.aim;
    var az = aim.az, za = aim.za;
    if (this.settings.shake) {
      var t = performance.now() / 1000;
      var amp = 2.2 * ARCSEC * (0.6 + 0.4 * Math.sin(t * 0.7));
      az += amp * Math.sin(t * 2.3) * 1.4;
      za += amp * Math.cos(t * 1.9) * 0.9;
    }
    return { az: SM.normAz(az), za: clamp(za, 0.04, Math.PI - 0.04) };
  };

  Game.prototype.updateCapture = function () {
    var s = this.session;
    if (!s || !s.engine) { this.captured = null; return; }
    var eff = this.effectiveAim();
    var best = null;
    var nearest = null;
    for (var i = 0; i < this.targets.length; i++) {
      var t = this.targets[i];
      if (s.carrying === t.id) continue;
      var pp = this.world.poles.get(t.id);
      if (pp && pp.stored) continue;
      var pt = this.currentTarget(t.id);
      if (!pt) continue;
      var cap = s.engine.capture(pt, eff);
      cap.id = t.id;
      cap.kind = t.kind;
      cap.note = t.note;
      cap.control = !!t.control;
      cap.poleId = pt.poleId || t.id;
      cap.name = this.pointName(t.id);
      cap.poleName = pt.poleName || this.poleName(t.id);
      if (cap.control) {
        cap.facing = true;
        if (cap.visible && cap.off <= (cap.radius || 0)) cap.hit = true;
      }
      if (!cap.visible) {
        if (cap.off < cap.radius * 7 && (!nearest || cap.off < nearest.off)) nearest = cap;
        continue;
      }
      if (!cap.facing) {
        if (!nearest || cap.off < nearest.off) nearest = cap;
        continue;
      }
      if (cap.hit) {
        if (!best || cap.off < best.off) best = cap;
      } else if (!nearest || cap.off < nearest.off) {
        nearest = cap;
      }
    }
    this.captured = best || nearest;
  };

  Game.prototype.updateFocus = function () {
    if (this.mode !== 'scope') return;
    var dist = this.captured ? this.captured.sd : 30;
    var blur = clamp(Math.abs(this.session.focus - dist) / Math.max(5, dist) * 1.1, 0, 1.8);
    var val = blur < 0.15 ? 'none' : 'blur(' + blur.toFixed(2) + 'px)';
    if (this.lastBlur !== val) {
      this.canvas.style.filter = val;
      this.lastBlur = val;
    }
  };

  /* ------------------------------------------------------------------ input */
  Game.prototype.bindEvents = function () {
    var self = this;
    document.addEventListener('keydown', function (e) { self.onKeyDown(e); });
    document.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    document.addEventListener('mousemove', function (e) { self.onMouseMove(e); });
    this.canvas.addEventListener('mousedown', function (e) { self.onMouseDown(e); });
    this.canvas.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
    this.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('pointerlockchange', function () { self.onLockChange(); });
    window.addEventListener('blur', function () { self.keys = {}; });
    window.addEventListener('beforeunload', function () {
      try { localStorage.setItem('geodezist.settings.v1', JSON.stringify(self.settings)); } catch (err) { /* ignore */ }
    });
  };

  Game.prototype.isTyping = function (e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  };

  Game.prototype.onKeyDown = function (e) {
    if (this.mode === 'title') return;
    var typing = this.isTyping(e);
    if (this.ui.modalOpen) {
      if (e.code === 'Escape' && this.mode !== 'results') { e.preventDefault(); this.ui.closeModal(); }
      return;
    }
    if (typing) return;
    this.keys[e.code] = true;
    var s = this.session;
    if (!s) return;
    var step = e.shiftKey ? 0.5 : (e.altKey ? 10 : 2);
    switch (e.code) {
      case 'Tab': e.preventDefault(); this.ui.openMenu(this.ui.menuTab || 'project'); return;
      case 'KeyJ': e.preventDefault(); this.ui.openJournal(); return;
      case 'KeyM': e.preventDefault(); document.getElementById('minimap-wrap').classList.toggle('hidden'); return;
      case 'Escape':
        if (this.mode === 'scope') { e.preventDefault(); this.exitScope(); }
        else { e.preventDefault(); this.ui.openMenu('project'); }
        return;
      case 'KeyQ':
        if (this.mode === 'scope') { e.preventDefault(); this.exitScope(); }
        return;
      case 'Enter':
        if (this.mode === 'scope') { e.preventDefault(); this.measureCurrent(); }
        return;
      case 'KeyO':
        if (this.mode === 'scope') { e.preventDefault(); this.orientCurrent(); }
        return;
      case 'KeyC':
        if (this.mode === 'scope') { e.preventDefault(); this.checkCurrent(); }
        return;
      case 'KeyF':
        if (this.mode === 'scope') {
          e.preventDefault();
          s.focus = this.captured ? this.captured.sd : 30;
          this.ui.toast('Фокус: ' + s.focus.toFixed(1) + ' м', 'good');
        }
        return;
      case 'KeyR':
        e.preventDefault();
        if (this.mode === 'scope') {
          if (this.captured) this.facePrism(this.captured.id);
          else this.ui.toast('Наведитесь на вешку, чтобы развернуть её отражатель', 'warn');
        } else if (this.mode === 'walk') {
          if (s.carrying) this.facePrism(s.carrying);
          else {
            var nearPole = this.nearestPole(2.2);
            if (nearPole) this.facePrism(nearPole);
            else this.ui.toast('Подойдите к вешке, чтобы развернуть отражатель', 'warn');
          }
        }
        return;
      case 'BracketLeft':
        e.preventDefault();
        this.adjustPoleHeight(-0.05);
        return;
      case 'BracketRight':
        e.preventDefault();
        this.adjustPoleHeight(0.05);
        return;
      case 'KeyH':
        e.preventDefault();
        this.openHeightEditor();
        return;
      case 'KeyT':
        e.preventDefault();
        if (this.gameFreeMode && this.gameFreeMode()) this.addFreePoint();
        else this.ui.toast('Свободная точка доступна в свободном задании', 'warn');
        return;
      case 'KeyE':
        if (this.mode === 'walk') { e.preventDefault(); this.interact(); }
        return;
      default: break;
    }
    if (this.mode === 'scope') {
      var d = step * ARCSEC;
      if (e.code === 'ArrowLeft') { e.preventDefault(); s.aim.az = SM.normAz(s.aim.az - d); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); s.aim.az = SM.normAz(s.aim.az + d); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); s.aim.za = clamp(s.aim.za - d, 0.04, Math.PI - 0.04); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); s.aim.za = clamp(s.aim.za + d, 0.04, Math.PI - 0.04); }
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') { s.zoom = clamp(s.zoom * 1.2, 1, 30); }
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { s.zoom = clamp(s.zoom / 1.2, 1, 30); }
    } else if (this.mode === 'walk') {
      if (e.code === 'ArrowLeft') { e.preventDefault(); this.player.yaw = SM.normAz(this.player.yaw - 0.035); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); this.player.yaw = SM.normAz(this.player.yaw + 0.035); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); this.player.pitch = clamp(this.player.pitch + 0.025, -1.45, 1.45); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); this.player.pitch = clamp(this.player.pitch - 0.025, -1.45, 1.45); }
    }
  };

  Game.prototype.onMouseMove = function (e) {
    if (document.pointerLockElement !== this.canvas) return;
    if (this.ui.modalOpen || this.mode === 'title' || this.mode === 'results') return;
    var sens = this.settings.sensitivity || 1;
    if (this.mode === 'walk') {
      this.player.yaw = SM.normAz(this.player.yaw + e.movementX * 0.0022 * sens);
      this.player.pitch = clamp(this.player.pitch - e.movementY * 0.0019 * sens, -1.45, 1.45);
    } else if (this.mode === 'scope') {
      var fov = this.currentFov();
      var perPx = fov / Math.max(200, window.innerHeight);
      var s = this.session;
      s.aim.az = SM.normAz(s.aim.az + e.movementX * perPx * sens);
      s.aim.za = clamp(s.aim.za + e.movementY * perPx * sens, 0.04, Math.PI - 0.04);
    }
  };

  Game.prototype.onMouseDown = function (e) {
    if (this.ui.modalOpen || this.mode === 'title' || this.mode === 'results') return;
    if (e.button !== 0) return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestLock();
      return;
    }
    if (this.mode === 'scope') this.measureCurrent();
  };

  Game.prototype.onWheel = function (e) {
    if (this.ui.modalOpen || this.mode !== 'scope') return;
    e.preventDefault();
    var s = this.session;
    if (e.shiftKey) {
      s.focus = clamp(s.focus * Math.exp(e.deltaY * 0.0018), 2.5, 300);
      return;
    }
    var k = 0.0011 * (this.settings.zoomSensitivity || 1);
    s.zoom = clamp(s.zoom * Math.exp(-e.deltaY * k), 1, 30);
    this.updateFocus();
  };

  Game.prototype.requestLock = function () {
    if (this.ui.modalOpen || this.mode === 'title' || this.mode === 'results') return;
    var el = this.canvas;
    try {
      var p = el.requestPointerLock();
      if (p && p.catch) p.catch(function () {});
    } catch (err) { /* браузер может отклонить без жеста */ }
  };

  Game.prototype.resumeFromHint = function () {
    this.ui.setLockHint(false);
    this.requestLock();
  };

  Game.prototype.onLockChange = function () {
    var locked = document.pointerLockElement === this.canvas;
    if (locked) {
      this.ui.setLockHint(false);
      return;
    }
    if (this.ui.modalOpen || this.mode === 'title' || this.mode === 'results') {
      this.ui.setLockHint(false);
      return;
    }
    var self = this;
    setTimeout(function () {
      if (!document.pointerLockElement && !self.ui.modalOpen && self.mode !== 'title' && self.mode !== 'results') {
        self.ui.setLockHint(true);
      }
    }, 120);
  };

  /* ------------------------------------------------------------- simulation */
  Game.prototype.currentFov = function () {
    var z = this.session ? this.session.zoom : 4;
    return 2 * Math.atan(Math.tan(BASE_FOV / 2) / z);
  };

  Game.prototype.updateWalk = function (dt) {
    if (this.ui.modalOpen) return;
    var forward = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    var strafe = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    if (!forward && !strafe) return;
    var speed = (this.keys.ShiftLeft || this.keys.ShiftRight) ? 5.0 : 3.0;
    var sin = Math.sin(this.player.yaw), cos = Math.cos(this.player.yaw);
    var dx = sin * forward + cos * strafe;
    var dz = -cos * forward + sin * strafe;
    var len = Math.hypot(dx, dz) || 1;
    dx = dx / len * speed * dt;
    dz = dz / len * speed * dt;
    var p = this.world.collide({ x: this.player.x + dx, z: this.player.z + dz }, 0.32);
    this.player.x = p.x;
    this.player.z = p.z;
  };

  Game.prototype.updateLeveling = function (dt) {
    if (!this.levelingActive) return;
    var setup = this.session.setup;
    if (this.hudT > 0.06) {
      var ok = Math.hypot(setup.tilt.xArcsec, setup.tilt.yArcsec) <= 30;
      this.ui.updateLeveling(setup.tilt, ok, setup.screws);
      this.hudT = 0;
    }
  };

  Game.prototype.loop = function (now) {
    var dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    this.frameCount++;
    if (now - this.lastFpsT > 500) {
      this.fps = this.frameCount / ((now - this.lastFpsT) / 1000);
      this.frameCount = 0;
      this.lastFpsT = now;
    }
    this.hudT += dt;
    this.timerT += dt;
    this.minimapT += dt;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  };

  Game.prototype.update = function (dt) {
    if (this.mode === 'title') {
      this.titleAngle += dt * 0.05;
      return;
    }
    if (!this.session) return;
    if (this.mode === 'walk' || this.mode === 'scope') {
      this.session.elapsed = (performance.now() - this.session.startTime) / 1000;
    }
    this.updateLeveling(dt);
    if (!this.ui.modalOpen) {
      this.updateWalk(dt);
      if (this.mode === 'scope') {
        this.updateCapture();
        this.updateFocus();
      }
    }
    this.updateTutorial();
    if (this.hudT > 0.08 && this.mode === 'scope') {
      this.ui.updateHud(this.hudSnapshot());
      this.hudT = 0;
    }
    if (this.minimapT > 0.18) {
      this.ui.drawMinimap();
      this.minimapT = 0;
    }
    this.updatePrompt();
    var limit = this.level.timeLimitSec;
    if (limit && this.session.elapsed > limit && this.mode !== 'results' && !this.finished) {
      this.ui.toast('Время вышло — задание завершается', 'bad');
      this.finishLevel(true);
    }
  };

  Game.prototype.hudSnapshot = function () {
    var s = this.session;
    if (!s) return null;
    var eff = this.effectiveAim();
    var engine = s.engine;
    var ha = engine && s.setup.oriented ? engine.haReading(eff.az) : eff.az;
    var last = this.lastMeasure;
    var cap = this.captured;
    var targetText = 'нет захвата';
    var badge = '';
    var offset = '';
    var locked = false;
    if (cap) {
      var cname = cap.name || cap.id;
      if (!cap.visible) {
        targetText = cname + ' · нет видимости';
        badge = cname + ' · НЕТ ВИДИМОСТИ';
      } else if (cap.facing === false) {
        targetText = cname + ' · призма не развёрнута';
        badge = cname + ' · РАЗВЕРНИТЕ ОТРАЖАТЕЛЬ К ТАХЕОМЕТРУ';
        offset = 'R — развернуть';
      } else if (cap.hit) {
        targetText = cname + ' · ' + cap.sd.toFixed(3) + ' м';
        badge = 'ЦЕЛЬ ЗАХВАЧЕНА · ' + cname + ' · ' + cap.sd.toFixed(3) + ' м · Δ ' + SM.arcsec(cap.off).toFixed(1) + '″';
        offset = 'ΔHA ' + SM.arcsec(cap.dHa).toFixed(1) + '″ · ΔZA ' + SM.arcsec(cap.dZa).toFixed(1) + '″';
        locked = true;
      } else {
        targetText = cname + ' · вне призмы';
        badge = cname + ' · СМЕЩЕНИЕ ' + SM.arcsec(cap.off).toFixed(0) + '″';
        offset = 'ΔHA ' + SM.arcsec(cap.dHa).toFixed(1) + '″ · ΔZA ' + SM.arcsec(cap.dZa).toFixed(1) + '″';
      }
    }
    var limit = this.level.timeLimitSec;
    var timeLeft = limit ? 'осталось ' + this.fmtTime(Math.max(0, limit - s.elapsed)) : 'без лимита';
    var factPole = null;
    if (s.carrying) factPole = s.carrying;
    else if (cap && !cap.control) factPole = cap.id;
    var factHeight = factPole && this.world.poles.get(factPole)
      ? this.world.poles.get(factPole).prismHeight
      : s.prismHeightInput;
    return {
      ha: SM.formatAngle(ha, { padDeg: true }),
      za: SM.formatAngle(eff.za),
      va: SM.formatSignedAngle(SM.zenithToVertical(eff.za)),
      sd: last ? last.sd.toFixed(3) : '—',
      hd: last ? last.hd.toFixed(3) : '—',
      dh: last ? fmtSigned(last.dh) : '—',
      x: last ? last.x.toFixed(3) : '—',
      y: last ? last.y.toFixed(3) : '—',
      z: last ? last.z.toFixed(3) : '—',
      zoom: '×' + s.zoom.toFixed(1),
      targetText: targetText,
      badgeText: badge,
      offsetText: offset,
      locked: locked,
      timer: this.fmtTime(s.elapsed),
      timeLeft: timeLeft,
      timeWarn: limit ? (limit - s.elapsed) < 60 : false,
      prismFact: factHeight.toFixed(2),
      fps: this.fps,
      mode: 'ОКУЛЯР'
    };
  };

  Game.prototype.fmtTime = function (sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  Game.prototype.updatePrompt = function () {
    if (this.ui.modalOpen || this.mode === 'results') { this.ui.prompt(null); return; }
    var s = this.session;
    if (this.mode === 'walk') {
      if (s.carrying) {
        var pose = this.placementPose();
        var refP = this.level.targets.filter(function (t) { return t.id === s.carrying; })[0];
        var dRef = refP ? Math.hypot(pose.x - refP.x, pose.y - refP.y) : null;
        this.ui.prompt('<kbd>E</kbd> поставить <b>' + s.carrying + '</b> · X ' + pose.x.toFixed(2) + ' · Y ' + pose.y.toFixed(2) +
          (dRef != null ? ' · до точки ' + dRef.toFixed(2) + ' м' : '') +
          (pose.snapId ? ' · <b>точно на ' + pose.snapId + ' ' + pose.snapName + '</b>' : '') +
          (pose.nearId ? ' · рядом ' + pose.nearId + ' ' + pose.nearName + ' (вешка ' + s.carrying + ')' : '') +
          ' · h ' + this.poleHeight(s.carrying).toFixed(2) + ' ([ ] / H)' +
          ' · <kbd>R</kbd> развернуть к тахеометру');
        return;
      }
      var pole = this.nearestPole(2.2);
      if (pole) {
        var facing = this.isPrismFacing(pole);
        var pobj = this.world.poles.get(pole);
        this.ui.prompt('<kbd>E</kbd> взять вешку <b>' + pole + '</b>' + (pobj && pobj.stored ? ' из ящика' : '') +
          ' · h ' + this.poleHeight(pole).toFixed(2) + ' ([ ] / H) · <kbd>R</kbd> ' +
          (facing ? 'развернуть отражатель' : '<b>развернуть отражатель к тахеометру</b>'));
        return;
      }
      var other = this.nearestOtherStation(3.2);
      if (other) {
        this.ui.prompt('<kbd>E</kbd> перенести тахеометр на <b>' + other.id + '</b>');
        return;
      }
      var near = this.distanceToStation() < 3.6;
      if (near) {
        var st = s.setup;
        var txt = !st.tripodPlaced ? 'E — установить штатив и тахеометр'
          : (!st.instrumentMounted ? 'E — установить тахеометр на трегер'
            : (!st.leveled ? 'E — открыть горизонтирование'
              : (!st.dataEntered ? 'E — ввести исходные данные станции' : 'E — войти в окуляр')));
        this.ui.prompt('<kbd>E</kbd> ' + txt);
      } else if (this.level.order === 1) {
        this.ui.prompt('Подойдите к точке <b>' + this.activeStation().id + '</b> или к вешке · <kbd>WASD</kbd> + мышь');
      } else {
        this.ui.prompt(null);
      }
      return;
    }
    if (this.mode === 'scope') {
      if (this.captured && this.captured.facing === false) {
        this.ui.prompt('<b>Отражатель не развёрнут к тахеометру</b> · <kbd>R</kbd> развернуть');
      } else if (!s.setup.oriented) {
        this.ui.prompt('Наведитесь на пункт привязки <b>BS1</b> и нажмите <kbd>O</kbd>');
      } else {
        this.ui.prompt('<kbd>ЛКМ</kbd> измерить · <kbd>R</kbd> развернуть призму · <kbd>Tab</kbd> меню · <kbd>Esc</kbd> выйти');
      }
    }
  };

  /* ----------------------------------------------------------------- camera */
  Game.prototype.buildCamera = function () {
    var W = window.innerWidth, H = window.innerHeight;
    var env = this.world.getEnv();
    var eye, center, fov = 52 * D2R;
    if (this.mode === 'title') {
      var a = this.titleAngle;
      eye = [Math.cos(a) * 27, 10.5 + Math.sin(a * 0.7) * 1.2, Math.sin(a) * 19 - 2];
      center = [0, 0.6, -6];
      fov = 55 * D2R;
    } else if (this.mode === 'scope' || this.mode === 'results') {
      var s = this.session;
      var c = s.setup.centering;
      var st = s.setup.trueStation || this.level.station;
      var baseY = GEO.terrainHeightSurvey(st.x, st.y);
      eye = [st.x - 1000 + c.east, baseY + s.setup.trueInstrumentHeight, -(st.y - 2000) - c.north];
      var eff = this.effectiveAim();
      center = [
        eye[0] + Math.sin(eff.az) * Math.sin(eff.za),
        eye[1] + Math.cos(eff.za),
        eye[2] - Math.cos(eff.az) * Math.sin(eff.za)
      ];
      fov = this.currentFov();
    } else {
      var gy = GEO.terrainHeightWorld(this.player.x, this.player.z);
      eye = [this.player.x, gy + 1.7, this.player.z];
      var yaw = this.player.yaw, pitch = this.player.pitch;
      center = [
        eye[0] + Math.sin(yaw) * Math.cos(pitch),
        eye[1] + Math.sin(pitch),
        eye[2] - Math.cos(yaw) * Math.cos(pitch)
      ];
      fov = 62 * D2R;
    }
    var aspect = W / Math.max(1, H);
    var proj = M4.perspective(M4.create(), fov, aspect, 0.06, 600);
    var view = M4.lookAt(M4.create(), eye, center, [0, 1, 0]);
    return {
      proj: proj, view: view, eye: eye,
      sunDir: env.sunDir, sunColor: env.sunColor, ambient: env.ambient,
      fogColor: env.fogColor, fogDensity: env.fogDensity
    };
  };

  Game.prototype.carryPose = function () {
    var s = this.session;
    if (!s || !s.carrying) return null;
    var p = this.world.poles.get(s.carrying);
    if (!p) return null;
    var fx = Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    var rx = Math.cos(this.player.yaw), rz = Math.sin(this.player.yaw);
    var wx = this.player.x + fx * 0.9 + rx * 0.4;
    var wz = this.player.z + fz * 0.9 + rz * 0.4;
    return {
      id: s.carrying,
      wx: wx,
      wz: wz,
      prismAz: s.carryFaced
        ? SM.normAz(Math.atan2(-wx, wz))
        : p.prismAz,
      prismHeight: p.prismHeight
    };
  };

  Game.prototype.render = function () {
    var W = window.innerWidth, H = window.innerHeight;
    this.renderer.resize(W, H, this.dpr());
    var cam = this.buildCamera();
    this.renderer.beginFrame(cam);
    var highlight = this.captured && this.captured.hit ? this.captured.id : null;
    var placement = this.session && this.session.carrying ? this.placementPose() : null;
    this.world.render(this.renderer, cam, { highlight: highlight, carry: this.carryPose(), placement: placement });
    this.ui.updateLabels(cam, this.mode);
  };

  /* ------------------------------------------------------------------ score */
  Game.prototype.computeResults = function () {
    var lvl = this.level, s = this.session;
    var self = this;
    var freeMode = !!lvl.freeMode;
    var required = freeMode ? [] : lvl.targets.filter(function (t) { return t.required; });
    var targetN = freeMode ? (lvl.freeTargetCount || 5) : required.length;
    var points;
    if (freeMode) {
      points = this.freePointRows().map(function (row) {
        return {
          id: row.pointId, name: row.pointName || row.pointId, kind: row.kind,
          measured: true, x: row.x, y: row.y, z: row.z, errXY: 0, errZ: 0, hit: true
        };
      });
    } else {
      points = required.map(function (t) {
        var row = self.getLatestRow(t.id);
        if (!row) return { id: t.id, name: self.pointName(t.id), kind: t.kind, measured: false, hit: false };
        var ref = row.ref || { x: t.x, y: t.y, z: t.z };
        var ex = row.x - ref.x, ey = row.y - ref.y, ez = row.z - ref.z;
        var exy = Math.hypot(ex, ey);
        return {
          id: t.id, name: self.pointName(t.id), kind: t.kind, measured: true,
          x: row.x, y: row.y, z: row.z,
          errXY: exy, errZ: ez,
          hit: exy <= lvl.tolerance.xy && Math.abs(ez) <= lvl.tolerance.z
        };
      });
    }
    var measuredPts = points.filter(function (p) { return p.measured; });
    var n = measuredPts.length;
    var meanXY = n ? measuredPts.reduce(function (a, p) { return a + p.errXY; }, 0) / n : 0;
    var maxXY = n ? Math.max.apply(null, measuredPts.map(function (p) { return p.errXY; })) : 0;
    var meanZ = n ? measuredPts.reduce(function (a, p) { return a + Math.abs(p.errZ); }, 0) / n : 0;
    var maxZ = n ? Math.max.apply(null, measuredPts.map(function (p) { return Math.abs(p.errZ); })) : 0;
    var timeSec = s.elapsed;
    var oriented = s.setup.oriented;
    var orientationArcsec = oriented ? s.setup.orientationErrorArcsec : 0;
    var controlResults = (this.controls || []).map(function (c) {
      var res = s.setup.checkResiduals[c.id];
      return {
        id: c.id, x: c.x, y: c.y, z: c.z,
        residual: res == null ? null : res,
        checked: res != null
      };
    });
    var checkedCount = controlResults.filter(function (c) { return c.checked; }).length;
    var maxCheck = checkedCount ? Math.max.apply(null, controlResults.filter(function (c) { return c.checked; })
      .map(function (c) { return Math.abs(c.residual); })) : null;
    var stationError = s.setup.stationError;
    var tilt = Math.hypot(s.setup.tilt.xArcsec, s.setup.tilt.yArcsec);

    var accuracy;
    if (freeMode) accuracy = n ? 100 : 0;
    else if (!n) accuracy = 0;
    else {
      var aXY = clamp(1 - meanXY / (lvl.tolerance.xy * 2.5), 0, 1);
      var aZ = clamp(1 - meanZ / (lvl.tolerance.z * 2.5), 0, 1);
      accuracy = 100 * (0.65 * aXY + 0.35 * aZ);
    }
    var completeness = freeMode
      ? clamp(n / Math.max(1, targetN) * 100, 0, 100)
      : (required.length ? n / required.length * 100 : 100);
    var orientQuality = Math.abs(orientationArcsec);
    if (maxCheck != null) orientQuality = Math.max(orientQuality, Math.abs(maxCheck));
    var orientScore = oriented ? 100 * clamp(1 - orientQuality / (lvl.tolerance.orientationArcsec * 3), 0, 1) : 0;
    var timeScore = lvl.timeLimitSec ? 100 * clamp(1 - timeSec / (lvl.timeLimitSec * 1.6), 0, 1) : 100;
    var proc = 100;
    if (stationError > 0.02) proc -= 30;
    if (s.autoLevelUsed) proc -= 5;
    var needsCheck = s.tutorial.some(function (t) { return t.id === 'check'; });
    if (needsCheck && checkedCount < 2) proc -= 15;
    if (maxCheck != null && Math.abs(maxCheck) > lvl.tolerance.orientationArcsec * 1.5) proc -= 10;
    if (tilt > 30) proc -= 10;
    proc = clamp(proc, 0, 100);
    var total = 0.5 * accuracy + 0.28 * completeness + 0.10 * orientScore + 0.07 * timeScore + 0.05 * proc;
    if (s.autoLevelUsed) total = Math.min(total, 95);
    total = clamp(total, 0, 100);
    var completed = freeMode ? n >= targetN : n === required.length;
    var allHit = freeMode ? true : measuredPts.every(function (p) { return p.hit; });

    var recs = [];
    if (!oriented) recs.push({ text: 'Ориентирование не выполнено: измерения не должны были выполняться. Наведитесь на BS1 и нажмите O.', warn: true });
    else if (Math.abs(orientationArcsec) > lvl.tolerance.orientationArcsec) recs.push({ text: 'Ошибка ориентирования по ' + (s.setup.orientedFrom || 'BS1') + ' ' + Math.abs(orientationArcsec).toFixed(1) + '″ превышает допуск. Точнее совместите перекрестие с центром призмы.', warn: true });
    if (stationError > 0.02) recs.push({ text: 'Координаты станции отличаются от задания на ' + (stationError * 100).toFixed(0) + ' см. Весь план смещён — проверьте ввод исходных данных.', warn: true });
    if (needsCheck && checkedCount < 2) {
      recs.push({ text: 'Проверено ' + checkedCount + ' из ' + controlResults.length + ' пунктов привязки. Для контроля ориентирования проверьте минимум два пункта.', warn: true });
    } else if (maxCheck != null && Math.abs(maxCheck) > lvl.tolerance.orientationArcsec) {
      recs.push({ text: 'Максимальная невязка по пунктам привязки ' + Math.abs(maxCheck).toFixed(1) + '″. Проверьте установку, центрирование и координаты станции.', warn: true });
    }
    if (tilt > 30) recs.push({ text: 'Остаточный наклон тахеометра ' + tilt.toFixed(0) + '″. Тахеометр выставлен недостаточно точно.', warn: true });
    var missed = freeMode ? [] : points.filter(function (p) { return !p.measured; });
    if (missed.length) recs.push({ text: 'Не сняты точки: ' + missed.map(function (p) { return p.id; }).join(', ') + '. Для зачёта нужна полная съёмка.', warn: true });
    if (freeMode && n < targetN) recs.push({ text: 'Свободная съёмка: снято ' + n + ' из ' + targetN + ' точек. Возьмите вешку, поставьте в любом месте и нажмите T.', warn: true });
    if (freeMode && n >= targetN) recs.push({ text: 'Свободная съёмка выполнена: снято ' + n + ' произвольных точек. Проверьте журнал и подписи точек.', warn: false });
    if (n) {
      var worst = measuredPts.slice().sort(function (a, b) { return b.errXY - a.errXY; })[0];
      if (worst.errXY > lvl.tolerance.xy) recs.push({ text: 'Максимальная плановая ошибка у ' + worst.id + ': ' + worst.errXY.toFixed(3) + ' м. Увеличьте зум и центрируйте перекрестие.', warn: true });
      if (meanZ > lvl.tolerance.z) recs.push({ text: 'Средняя ошибка по высоте ' + (meanZ * 100).toFixed(1) + ' см. Проверьте высоту вехи на каждой точке и высоту тахеометра.', warn: true });
    }
    if (lvl.timeLimitSec && timeSec > lvl.timeLimitSec) recs.push({ text: 'Лимит времени превышен на ' + Math.round(timeSec - lvl.timeLimitSec) + ' с. В поле время тоже ограничено.', warn: true });
    if (s.autoLevelUsed) recs.push({ text: 'Использован автоуровень: в реальной работе горизонт выставляют вручную.', warn: false });
    if (!recs.length) recs.push({ text: 'Работа выполнена аккуратно: тахеометр выставлен, ориентирование верное, точки сняты в допуске.', warn: false });
    if (allHit && completed && recs.length === 1) recs.push({ text: 'Отличный результат. Попробуйте пройти уровень быстрее или с более сложной моделью погрешностей.', warn: false });

    var grade, gradeText;
    if (total >= 90) { grade = '5 · отлично'; gradeText = 'Зачёт с отличием'; }
    else if (total >= 75) { grade = '4 · хорошо'; gradeText = 'Задание выполнено'; }
    else if (total >= 60) { grade = '3 · удовлетворительно'; gradeText = 'Задание выполнено с замечаниями'; }
    else { grade = '2 · не сдано'; gradeText = 'Задание не сдано'; }

    var idx = this.levels.findIndex(function (l) { return l.id === lvl.id; });
    return {
      total: total, grade: grade, gradeText: gradeText, completed: completed,
      measured: n, required: freeMode ? targetN : required.length, freeMode: freeMode, points: points,
      meanXY: meanXY, maxXY: maxXY, meanZ: meanZ, maxZ: maxZ,
      timeSec: timeSec, limitSec: lvl.timeLimitSec,
      orientationArcsec: orientationArcsec, checkArcsec: maxCheck,
      orientationFrom: s.setup.orientedFrom, controls: controlResults,
      checkedCount: checkedCount, maxCheck: maxCheck,
      stationError: stationError, tilt: tilt,
      oriented: oriented, accuracyScore: accuracy, completeness: completeness,
      orientationScore: orientScore, timeScore: timeScore, procedure: proc,
      recommendations: recs,
      hasNext: idx >= 0 && idx < this.levels.length - 1
    };
  };

  Game.prototype.finishLevel = function (auto) {
    if (this.finished || this.mode === 'results') return;
    if (this.session) { this.session.carrying = null; this.session.carryFaced = false; }
    this.finished = true;
    var r = this.computeResults();
    this.lastResults = r;
    this.markTutorial('finish');
    this.saveProgress(r.total, r.completed);
    this.mode = 'results';
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.prompt(null);
    this.ui.setTargetBadge(null);
    this.ui.showResults(r);
    if (auto) this.ui.toast('Задание завершено по лимиту времени', 'warn');
    this.playSound('success');
  };

  /* ---------------------------------------------------------------- journal */
  Game.prototype.getLatestRow = function (id) {
    if (!this.session) return null;
    var rows = this.session.journal;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i].pointId === id) return rows[i];
    }
    return null;
  };
  Game.prototype.isTargetDone = function (id) {
    return !!this.getLatestRow(id);
  };
  Game.prototype.getCaptured = function () { return this.captured; };
  Game.prototype.deleteJournalRow = function (id) {
    var s = this.session;
    if (!s) return;
    s.journal = s.journal.filter(function (r) { return r.id !== id; });
    if (this.lastMeasure && this.lastMeasure.id === id) this.lastMeasure = null;
    this.ui.updateMission();
    this.ui.toast('Запись удалена из журнала', 'warn');
  };
  Game.prototype.setPrismHeight = function (v) {
    if (!this.session) return;
    this.session.prismHeightInput = v;
    this.ui.updateHud(this.hudSnapshot());
    if (this.session.stakeout.measurement) this.updateTracking();
  };

  Game.prototype.buildCSV = function () {
    var s = this.session;
    if (!s || !this.level) return '';
    function q(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
    var kindName = { survey: 'съёмка', stakeout: 'вынос', extra: 'доп.', control: 'контроль', backsight: 'задняя' };
    var lines = [];
    lines.push(['№', 'Станция', 'Точка', 'Вешка', 'Тип', 'HA', 'ZA', 'SD, м', 'HD, м', 'ΔH, м', 'X, м', 'Y, м', 'Z, м', 'h вехи, м', 'ΔXY, м', 'ΔZ, м', 'Примечание'].join(';'));
    s.journal.forEach(function (r, i) {
      var ref = r.ref || r.true;
      var exy = ref ? Math.hypot(r.x - ref.x, r.y - ref.y) : '';
      var ez = ref ? (r.z - ref.z) : '';
      var note = (r.note || '').replace(/;/g, ',');
      lines.push([
        i + 1, r.stationId || '', r.pointName || r.pointId, r.poleName || '', kindName[r.kind] || r.kind,
        q(SM.formatAngle(r.ha)), q(SM.formatAngle(r.za)),
        r.sd.toFixed(3), r.hd.toFixed(3), r.dh.toFixed(3),
        r.x.toFixed(3), r.y.toFixed(3), r.z.toFixed(3), r.prismHeight.toFixed(2),
        exy === '' ? '' : exy.toFixed(3), ez === '' ? '' : ez.toFixed(3),
        q(note)
      ].join(';'));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  };

  Game.prototype.exportCSV = function () {
    var s = this.session;
    if (!s || !this.level) return;
    var csv = this.buildCSV();
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var d = new Date();
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '_' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2);
    a.download = 'journal_' + this.level.id + '_' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    this.ui.toast('Журнал экспортирован в CSV', 'good');
  };

  /* ------------------------------------------------------------------ sound */
  Game.prototype.playSound = function (kind) {
    if (!this.settings.sound) return;
    try {
      if (!this.audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.audioCtx = new AC();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      var ctx = this.audioCtx;
      var t0 = ctx.currentTime;
      var tones = {
        click: [[660, 0.04, 0.04]],
        ok: [[520, 0.06, 0.05], [780, 0.08, 0.04]],
        measure: [[1100, 0.05, 0.04]],
        success: [[520, 0.09, 0.05], [780, 0.09, 0.05], [1040, 0.12, 0.04]],
        error: [[170, 0.16, 0.06]]
      }[kind] || [[600, 0.05, 0.04]];
      for (var i = 0; i < tones.length; i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = tones[i][0];
        var start = t0 + i * 0.075;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(tones[i][2], start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, start + tones[i][1]);
        o.connect(g); g.connect(ctx.destination);
        o.start(start); o.stop(start + tones[i][1] + 0.02);
      }
    } catch (e) { /* звук необязателен */ }
  };

  /* ------------------------------------------------------------------- nav */
  Game.prototype.quitToTitle = function () {
    if (this.ui.modalOpen) {
      this.ui.modalOpen = false;
      this.ui.root.innerHTML = '';
      document.body.classList.remove('modal-open');
    }
    this.mode = 'title';
    this.lastResults = null;
    this.ui.setScope(false);
    this.ui.setLockHint(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.world) {
      this.world.tripodVisible = true;
      this.world.topVisible = true;
    }
    this.ui.showTitle();
  };
  Game.prototype.restartLevel = function () {
    if (!this.level) { this.quitToTitle(); return; }
    var id = this.level.id;
    this.ui.modalOpen = false;
    this.ui.root.innerHTML = '';
    document.body.classList.remove('modal-open');
    this.startLevel(id);
  };
  Game.prototype.nextLevel = function () {
    var idx = this.levels.findIndex(function (l) { return l.id === (this.level && this.level.id); }.bind(this));
    if (idx < 0) return;
    if (idx + 1 < this.levels.length) {
      this.ui.modalOpen = false;
      this.ui.root.innerHTML = '';
      document.body.classList.remove('modal-open');
      this.startLevel(this.levels[idx + 1].id);
    } else {
      this.quitToTitle();
    }
  };
  Game.prototype.onModalClosed = function () {
    if (this.levelingActive) this.levelingActive = false;
    if (this.mode === 'walk' || this.mode === 'scope') {
      var self = this;
      this.requestLock();
      setTimeout(function () {
        if (!document.pointerLockElement && !self.ui.modalOpen) self.ui.setLockHint(true);
      }, 700);
    }
  };

  GEO.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
