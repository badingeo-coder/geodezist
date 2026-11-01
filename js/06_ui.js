/**
 * 06_ui.js — весь DOM-интерфейс: HUD, меню тахеометра, журнал, оценка, обучение.
 * UI не выполняет геодезических расчётов — только отображает состояние Game.
 */
(function (root) {
  'use strict';
  var GEO = root.GEO;
  var SM = root.SurveyMath;
  var D2R = Math.PI / 180;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }
  function kindRu(kind) {
    return ({ survey: 'съёмка', stakeout: 'вынос', extra: 'доп.', backsight: 'пункт', control: 'пункт' })[kind] || kind;
  }
  function typeBadge(level) {
    return ({ tutorial: 'обучение', setup: 'установка', survey: 'съёмка', stakeout: 'вынос', complex: 'комплекс' })[level.type] || level.type;
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function UI(game) {
    this.game = game;
    this.root = document.getElementById('modal-root');
    this.modalOpen = false;
    this.menuTab = 'project';
    this.setupStep = 1;
    this.compare = true;
    this.labels = new Map();
    this.cache = {};
    this.toastCount = 0;
    this.currentResults = null;
    this.lastLabelUpdate = 0;
    this.bindStatic();
    this.bindDelegation();
    this.bindKnobs();
  }

  /* ------------------------------------------------------------ static */
  UI.prototype.bindStatic = function () {
    var self = this;
    function on(id, ev, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    }
    on('btn-brief', 'click', function () { self.openMenu('project'); });
    on('btn-journal', 'click', function () { self.openJournal(); });
    on('btn-menu', 'click', function () { self.openMenu(self.menuTab || 'project'); });
    on('btn-settings', 'click', function () { self.openSettings(); });
    on('btn-exit', 'click', function () { self.game.quitToTitle(); });
    on('mp-toggle', 'click', function () {
      var panel = document.getElementById('mission-panel');
      panel.classList.toggle('collapsed');
      var body = document.getElementById('mp-body');
      body.style.display = body.style.display === 'none' ? '' : 'none';
      document.getElementById('mp-toggle').textContent = body.style.display === 'none' ? '+' : '−';
    });
    on('prism-height', 'change', function (e) {
      var v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0.3 && v < 3.5) self.game.setPrismHeight(v);
      else e.target.value = self.game.session ? self.game.session.prismHeightInput.toFixed(2) : '1.50';
    });
    on('lock-hint', 'click', function () { self.game.resumeFromHint(); });
    on('btn-height', 'click', function () { self.game.openHeightEditor(); });
  };

  UI.prototype.bindDelegation = function () {
    var self = this;
    this.root.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-menu-tab]');
      if (tab) { self.openMenu(tab.getAttribute('data-menu-tab')); return; }
      var act = e.target.closest('[data-act]');
      if (act) {
        e.preventDefault();
        self.handleAction(act.getAttribute('data-act'), act);
      }
    });
    this.root.addEventListener('change', function (e) {
      if (e.target.id === 'set-quality') {
        self.game.saveSettings({ quality: parseFloat(e.target.value) });
        return;
      }
      if (e.target.id === 'custom-free') {
        self.readCustomEditor();
        self.customDraft.freeMode = e.target.checked;
        self.renderCustomEditor();
        return;
      }
      var ph = e.target.closest('[data-pole-height]');
      if (ph) {
        var v = parseFloat(String(ph.value).replace(',', '.'));
        if (isFinite(v)) self.game.setPoleHeight(ph.getAttribute('data-pole-height'), v);
      }
    });
  };

  UI.prototype.handleAction = function (act, el) {
    var g = this.game;
    var id = el.getAttribute('data-id');
    switch (act) {
      case 'close': this.closeModal(); break;
      case 'resume': this.closeModal(); break;
      case 'help': this.openHelp(); break;
      case 'custom-level': this.openCustomLevel(); break;
      case 'custom-add-point': this.readCustomEditor(); this.customDraft.points.push({ x: 1000, y: 2000, name: 'Точка ' + (this.customDraft.points.length + 1) }); this.renderCustomEditor(); break;
      case 'custom-remove-point': this.readCustomEditor(); this.customDraft.points.splice(parseInt(el.getAttribute('data-index'), 10), 1); if (!this.customDraft.points.length) this.customDraft.points.push({ x: 1000, y: 2000, name: 'Точка 1' }); this.renderCustomEditor(); break;
      case 'custom-start': this.startCustom(); break;
      case 'settings': this.openSettings(); break;
      case 'title': g.quitToTitle(); break;
      case 'start-level': g.startLevel(el.getAttribute('data-level')); break;
      case 'menu-project': this.openMenu('project'); break;
      case 'menu-station': this.openMenu('station'); break;
      case 'menu-survey': this.openMenu('survey'); break;
      case 'menu-stake': this.openMenu('stakeout'); break;
      case 'menu-journal': this.openMenu('journal'); break;
      case 'menu-settings': this.openMenu('settings'); break;
      case 'open-journal': this.openJournal(); break;
      case 'export-csv': g.exportCSV(); break;
      case 'delete-row': g.deleteJournalRow(id); this.openJournal(); break;
      case 'toggle-compare': this.compare = !this.compare; this.openJournal(); break;
      case 'apply-station': this.applyStation(); break;
      case 'orient': g.orientCurrent(); break;
      case 'check': g.checkCurrent(); break;
      case 'finish': this.closeModal(); g.finishLevel(); break;
      case 'level-accept': g.acceptLeveling(false); break;
      case 'level-auto': g.acceptLeveling(true); break;
      case 'setup-tripod': g.setupTripod(); break;
      case 'setup-mount': g.mountInstrument(); break;
      case 'setup-level': g.openLeveling(); break;
      case 'change-station': g.moveToStation(id); break;
      case 'setup-data': this.openSetup(2); break;
      case 'setup-back': this.openSetup(1); break;
      case 'stake-select': g.selectDesign(id); this.openMenu('stakeout'); break;
      case 'nudge': g.nudgePole(el.getAttribute('data-dir'), parseFloat(el.getAttribute('data-step'))); this.refreshStakeout(); break;
      case 'stake-fix': g.fixStakeout(); this.openMenu('stakeout'); break;
      case 'stake-measure': this.closeModal(); g.enterScope(); break;
      case 'face-prism': g.facePrism(id); this.openMenu('survey'); break;
      case 'rename-pole': this.openRename(id); break;
      case 'rename-point': this.openRenamePoint(id); break;
      case 'rename-point-save': {
        var pn = document.getElementById('point-name-input');
        if (g.renamePoint(id, pn ? pn.value : '')) { this.closeModal(); this.openMenu('survey'); }
        break;
      }
      case 'height-step': {
        var hi = document.getElementById('height-input');
        if (hi) {
          var hv = (parseFloat(hi.value) || 1.5) + parseFloat(el.getAttribute('data-delta') || '0.05');
          hi.value = Math.max(0.5, Math.min(2.5, hv)).toFixed(2);
        }
        break;
      }
      case 'height-save': {
        var hh = document.getElementById('height-input');
        var hval = hh ? parseFloat(String(hh.value).replace(',', '.')) : NaN;
        if (!isFinite(hval)) { this.toast('Введите высоту вехи числом', 'bad'); break; }
        g.setPoleHeight(id, hval);
        this.closeModal();
        if (g.mode === 'scope') { g.updateCapture(); g.ui.updateHud(g.hudSnapshot()); }
        break;
      }
      case 'rename-pole-save': {
        var el = document.getElementById('rename-input');
        if (g.renamePole(id, el ? el.value : '')) { this.closeModal(); this.openMenu('survey'); }
        break;
      }
      case 'add-pole': g.addPracticePole(); this.openMenu('survey'); break;
      case 'remove-last-pole': g.removeLastPracticePole(); this.openMenu('survey'); break;
      case 'remove-pole': g.removePracticePole(id); this.openMenu('survey'); break;
      case 'take-pole': g.takePoleFromBox(id); break;
      case 'take-next-pole': g.takeNextFromBox(); break;
      case 'add-free-point': g.addFreePoint(); this.openMenu('survey'); break;
      case 'restart': g.restartLevel(); break;
      case 'next-level': g.nextLevel(); break;
      case 'save-settings': this.saveSettingsFromForm(); break;
      case 'reset-progress': g.resetProgress(); this.toast('Прогресс сброшен', 'warn'); this.openSettings(); break;
      case 'goto-title': g.quitToTitle(); break;
      default: break;
    }
  };

  /* ------------------------------------------------------------- overlays */
  UI.prototype.openSheet = function (o) {
    this.modalOpen = true;
    document.body.classList.add('modal-open');
    if (document.pointerLockElement) document.exitPointerLock();
    var tabs = '';
    if (o.tabs) {
      tabs = '<div class="tabs">' + o.tabs.map(function (t) {
        return '<button class="tab' + (t.active ? ' active' : '') + '" data-menu-tab="' + t.id + '">' + esc(t.label) + '</button>';
      }).join('') + '</div>';
    }
    var foot = o.foot ? '<div class="sheet-foot">' + o.foot + '</div>' : '';
    this.root.innerHTML =
      '<div class="overlay' + (o.className ? ' ' + o.className : '') + '">' +
      '<div class="sheet' + (o.wide ? ' wide' : '') + '">' +
      '<div class="sheet-head"><div><div class="sheet-title">' + o.title + '</div>' +
      (o.sub ? '<div class="sheet-sub">' + o.sub + '</div>' : '') + '</div>' +
      '<button class="icon-btn" data-act="close" title="Закрыть">×</button></div>' +
      tabs +
      '<div class="sheet-body">' + o.body + '</div>' +
      foot +
      '</div></div>';
    if (o.onMount) o.onMount.call(this);
  };

  UI.prototype.closeModal = function () {
    this.modalOpen = false;
    this.setupStep = 0;
    document.body.classList.remove('modal-open');
    this.root.innerHTML = '';
    if (this.game.mode === 'title') { this.showTitle(); return; }
    this.game.onModalClosed();
  };

  /* ---------------------------------------------------------------- title */
  UI.prototype.showTitle = function () {
    document.body.classList.remove('in-game', 'in-scope', 'target-locked');
    document.body.classList.add('title-mode');
    ['topbar', 'lcd', 'mission-panel', 'minimap-wrap', 'labels', 'prompt', 'target-badge'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    this.labels.clear();
    document.getElementById('labels').innerHTML = '';
    var levels = this.game.levels;
    var progress = this.game.progress || {};
    var cards = levels.map(function (l, i) {
      var best = progress[l.id];
      var reqCount = l.targets.filter(function (t) { return t.required; }).length;
      var dur = l.timeLimitSec ? Math.round(l.timeLimitSec / 60) + ' мин' : 'без лимита';
      return '<button class="level-card" data-act="start-level" data-level="' + l.id + '">' +
        '<div class="lc-top"><span class="lc-num">0' + (i + 1) + '</span>' +
        '<span class="lc-badge ' + l.type + '">' + typeBadge(l) + '</span>' +
        (best ? '<span class="lc-score" style="margin-left:auto">' + best.best + ' / 100</span>' : '<span style="margin-left:auto"></span>') +
        '</div>' +
        '<div class="lc-title">' + esc(l.title) + '</div>' +
        '<div class="lc-sub">' + esc(l.subtitle) + ' · ' + dur + '</div>' +
        '<div class="lc-foot"><span>' + reqCount + ' ' + plural(reqCount, 'точка', 'точки', 'точек') + '</span>' +
        '<span>' + (best ? 'лучший результат' : 'не пройден') + '</span></div>' +
        '</button>';
    }).join('');

    this.openSheet({
      title: ' ', wide: true, className: 'title-overlay',
      body:
        '<div class="title-inner">' +
        '<div class="title-hero">' +
        '<div class="eyebrow">Учебный симулятор · тахеометрия</div>' +
        '<h1>ГЕОДЕЗИСТ</h1>' +
        '<h2>ПОЛЕВОЙ ВЫЕЗД</h2>' +
        '<p>Установите тахеометр, приведите его в горизонт, ориентируйтесь по задней точке и выполните съёмку участка или вынос в натуру. Все углы, расстояния и координаты считаются по настоящим формулам, а ошибки — геодезически объяснимы.</p>' +
        '<div class="hero-actions">' +
        '<button class="btn primary" data-act="start-level" data-level="' + levels[0].id + '">Начать обучение</button>' +
        '<button class="btn" data-act="help">Как играть</button>' +
        '<button class="btn" data-act="settings">Настройки</button>' +
        '</div>' +
        '<div class="hero-meta">' +
        '<div>ПОЛИГОН<b>«Заречье», ≈ 240 × 220 м</b></div>' +
        '<div>ИНСТРУМЕНТ<b>Тахеометр TA-5, 30×</b></div>' +
        '<div>ТОЧНОСТЬ<b>углы 1″, расстояния 1 мм</b></div>' +
        '<div>ЭКСПОРТ<b>CSV полевого журнала</b></div>' +
        '</div></div>' +
        '<div class="level-section-head" style="margin-top:34px"><h3>УРОВНИ</h3><span>6 заданий · от обучения до зачётного выезда</span></div>' +
        '<div class="level-grid">' + cards + '</div>' +
        '<div class="form-row" style="margin-top:18px"><button class="btn" data-act="custom-level">Свободная локация — задание преподавателя</button></div>' +
        '<div class="title-foot">Симулятор не заменяет практическое обучение и не эмулирует протоколы конкретных тахеометров. Все координаты и объекты — учебные. Управление: WASD, мышь, E, Tab, J, ЛКМ.</div>' +
        '</div>',
      onMount: function () {
        var sheet = this.root.querySelector('.sheet');
        if (sheet) sheet.style.background = 'transparent';
        var head = this.root.querySelector('.sheet-head');
        if (head) head.style.display = 'none';
        var ov = this.root.querySelector('.overlay');
        if (ov) ov.style.background = 'linear-gradient(90deg, rgba(2,7,9,.97) 0%, rgba(2,7,9,.86) 38%, rgba(2,7,9,.28) 68%, rgba(2,7,9,.72) 100%)';
      }
    });
    this.game.mode = 'title';
  };

  /* --------------------------------------------------------------- game HUD */
  UI.prototype.showGameHud = function () {
    document.body.classList.remove('title-mode');
    document.body.classList.add('in-game');
    ['topbar', 'mission-panel', 'labels'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
    document.getElementById('minimap-wrap').classList.remove('hidden');
    var lvl = this.game.level;
    document.getElementById('top-level').textContent = 'Уровень ' + lvl.order + ' · ' + lvl.title;
    this.updateMission();
  };

  UI.prototype.setScope = function (on) {
    document.body.classList.toggle('in-scope', on);
    var lcd = document.getElementById('lcd');
    if (lcd) lcd.classList.toggle('hidden', !on);
    var labels = document.getElementById('labels');
    if (labels) labels.style.opacity = on ? '0' : '1';
    if (!on) {
      document.body.classList.remove('target-locked');
      this.setTargetBadge(null);
      document.getElementById('gl').style.filter = 'none';
    }
  };

  UI.prototype.updateHud = function (s) {
    if (!s) return;
    var c = this.cache;
    function set(id, val) {
      if (c[id] === val) return;
      c[id] = val;
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    }
    set('v-ha', s.ha);
    set('v-za', s.za);
    set('v-va', s.va);
    set('v-sd', s.sd);
    set('v-hd', s.hd);
    set('v-dh', s.dh);
    set('v-x', s.x);
    set('v-y', s.y);
    set('v-z', s.z);
    set('v-zoom', s.zoom);
    set('v-target', s.targetText || 'нет захвата');
    set('v-offset', s.offsetText || '');
    set('timer', s.timer);
    set('mp-time-left', s.timeLeft || '');
    set('mp-fps', Math.round(s.fps || 0) + ' FPS');
    var mode = document.getElementById('lcd-mode');
    if (mode) mode.textContent = s.mode || 'ОКУЛЯР';
    document.body.classList.toggle('target-locked', !!s.locked);
    var timerEl = document.getElementById('timer');
    if (timerEl) timerEl.style.color = s.timeWarn ? 'var(--red)' : 'var(--amber)';
    var ph = document.getElementById('prism-height');
    if (ph && document.activeElement !== ph) ph.value = (this.game.session ? this.game.session.prismHeightInput : 1.5).toFixed(2);
    var pf = document.getElementById('v-prism-fact');
    if (pf) pf.textContent = s.prismFact || (this.game.session ? this.game.session.prismHeightInput.toFixed(2) : '1.50');
    if (s.locked) {
      this.setTargetBadge(s.badgeText || 'ЦЕЛЬ ЗАХВАЧЕНА', '');
    } else if (s.targetText && s.targetText !== 'нет захвата') {
      this.setTargetBadge(s.badgeText || s.targetText, 'warn');
    } else {
      this.setTargetBadge(null);
    }
  };

  UI.prototype.setTargetBadge = function (text, cls) {
    var el = document.getElementById('target-badge');
    if (!el) return;
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden', 'warn', 'bad');
    if (cls) el.classList.add(cls);
    document.getElementById('tb-text').textContent = text;
  };

  UI.prototype.prompt = function (text) {
    var el = document.getElementById('prompt');
    if (!el) return;
    if (!text) { el.classList.add('hidden'); return; }
    el.innerHTML = text;
    el.classList.remove('hidden');
  };

  UI.prototype.toast = function (text, cls) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3800);
  };

  UI.prototype.updateMission = function () {
    var g = this.game;
    if (!g.level || !g.session) return;
    var lvl = g.level, s = g.session;
    var freeMode = !!lvl.freeMode;
    var freeRows = freeMode && g.freePointRows ? g.freePointRows() : [];
    var targetN = freeMode ? (lvl.freeTargetCount || 5) : 0;
    var required = freeMode ? [] : lvl.targets.filter(function (t) { return t.required; });
    var done = required.filter(function (t) { return g.isTargetDone(t.id); });
    document.getElementById('mp-kicker').textContent = typeBadge(lvl).toUpperCase();
    document.getElementById('mp-title').textContent = lvl.title;
    document.getElementById('mp-goal').textContent = lvl.goal;
    document.getElementById('mp-bar').style.width = freeMode
      ? Math.min(100, freeRows.length / Math.max(1, targetN) * 100) + '%'
      : (required.length ? done.length / required.length * 100 : 0) + '%';
    document.getElementById('mp-count').textContent = freeMode
      ? freeRows.length + ' / ' + targetN
      : done.length + ' / ' + required.length;

    var chips = [];
    var activeSt = s.setup.trueStation || lvl.station;
    chips.push('<span class="chip">станция ' + esc(activeSt.id) + '</span>');
    if (s.setup.dataEntered) chips.push('<span class="chip ok">станция введена</span>');
    else chips.push('<span class="chip">станция не введена</span>');
    if (s.setup.oriented) {
      var oe = Math.abs(s.setup.orientationErrorArcsec || 0);
      chips.push('<span class="chip ' + (oe <= lvl.tolerance.orientationArcsec ? 'ok' : 'warn') + '">' +
        (s.setup.orientedFrom || 'BS1') + ' · ' + oe.toFixed(1) + '″</span>');
    } else chips.push('<span class="chip warn">нет ориентирования</span>');
    var checks = Object.keys(s.setup.checkResiduals || {}).length;
    var cpTotal = (g.controls || []).length;
    chips.push('<span class="chip ' + (checks >= 2 ? 'ok' : 'warn') + '">привязка ' + checks + ' / ' + cpTotal + '</span>');
    if (s.carrying) chips.push('<span class="chip warn">в руках ' + esc(s.carrying) + '</span>');
    if (s.setup.leveled) {
      var tilt = Math.hypot(s.setup.tilt.xArcsec, s.setup.tilt.yArcsec);
      chips.push('<span class="chip ' + (tilt <= 30 ? 'ok' : 'warn') + '">наклон ' + tilt.toFixed(0) + '″</span>');
    }
    document.getElementById('mp-status').innerHTML = chips.join('');

    var list = freeMode
      ? (freeRows.length ? freeRows.map(function (r) {
        return '<div class="mp-item done"><span class="st"></span><span class="pid">' + esc(r.pointId) + '</span>' +
          '<span>' + esc(r.pointName || r.pointId) + '</span><span class="ph">' + (r.poleName || '') + '</span></div>';
      }).join('') : '<div class="empty-state">Свободная съёмка: поставьте вешку и нажмите T</div>')
      : required.map(function (t) {
        var row = g.getLatestRow(t.id);
        var ph = g.poleHeight(t.id).toFixed(2);
        return '<div class="mp-item' + (row ? ' done' : '') + '"><span class="st"></span>' +
          '<span class="pid">' + esc(t.id) + '</span>' +
          '<span>' + esc(g.pointName(t.id)) + '</span>' +
          '<span class="ph">h ' + ph + '</span></div>';
      }).join('');
    document.getElementById('mp-list').innerHTML = list;

    var tutorial = s.tutorial || [];
    if (tutorial.length) {
      var activeSet = false;
      var html = tutorial.map(function (step, i) {
        var isDone = s.tutorialDone && s.tutorialDone[step.id];
        var cls = isDone ? 'done' : (!activeSet ? 'active' : '');
        if (!isDone) activeSet = true;
        return '<div class="tut-step ' + cls + '"><span class="num">' + (isDone ? '✓' : (i + 1)) + '</span><span>' + esc(step.text) + '</span></div>';
      }).join('');
      document.getElementById('mp-tutorial').innerHTML = html;
    } else {
      document.getElementById('mp-tutorial').innerHTML = '';
    }
  };

  UI.prototype.setLockHint = function (on) {
    document.getElementById('lock-hint').classList.toggle('hidden', !on);
  };

  /* ---------------------------------------------------------------- labels */
  UI.prototype.rebuildLabels = function () {
    var g = this.game;
    var rootEl = document.getElementById('labels');
    rootEl.innerHTML = '';
    this.labels.clear();
    if (!g.level || !g.world) return;
    var self = this;
    var all = g.targets || g.level.targets || [];
    all.forEach(function (t) {
      var el = document.createElement('div');
      var cls = 'pole-label';
      var isControl = t.kind === 'control' || t.control;
      if (isControl) cls += ' control';
      else if (t.kind === 'stakeout') cls += ' stake';
      el.className = cls;
      var name = isControl ? t.id : g.poleName(t.id);
      el.textContent = isControl ? name + ' · пункт' : name + (t.prismHeight ? ' · ' + g.poleHeight(t.id).toFixed(2) : '');
      rootEl.appendChild(el);
      self.labels.set(t.id, { el: el, kind: 'pole' });
    });
    (g.stations || []).forEach(function (st) {
      var el = document.createElement('div');
      el.className = 'pole-label station';
      el.textContent = st.id;
      rootEl.appendChild(el);
      self.labels.set('station:' + st.id, { el: el, kind: 'station', stationId: st.id });
    });
    (g.level.targets || []).filter(function (t) { return t.required || t.free; }).forEach(function (t) {
      var el = document.createElement('div');
      el.className = 'point-label';
      var pn = g.pointName(t.id);
      el.textContent = pn === t.id ? t.id : (t.id + ' · ' + pn);
      rootEl.appendChild(el);
      self.labels.set('point:' + t.id, { el: el, kind: 'point', pointId: t.id });
    });
    var boxEl = document.createElement('div');
    boxEl.className = 'pole-label box-label';
    boxEl.textContent = 'ЯЩИК ДЛЯ ВЕШЕК';
    rootEl.appendChild(boxEl);
    this.labels.set('__box', { el: boxEl, kind: 'box' });
  };

  UI.prototype.updateLabels = function (cam, viewMode) {
    var g = this.game;
    if (!g.world || !g.level) return;
    var W = window.innerWidth, H = window.innerHeight;
    var show = viewMode === 'walk' && !this.modalOpen;
    var self = this;
    this.labels.forEach(function (item, id) {
      var el = item.el;
      if (!show || (g.session && g.session.carrying === id)) { el.style.display = 'none'; return; }
      var wp;
      if (item.kind === 'box') {
        var bx = g.world.boxSurvey.x - 1000, bz = -(g.world.boxSurvey.y - 2000);
        wp = [bx, (GEO.terrainHeightWorld ? GEO.terrainHeightWorld(bx, bz) : 0) + 0.95, bz];
      } else if (item.kind === 'point') {
        var pt = g.level.targets.filter(function (t) { return t.id === item.pointId; })[0];
        if (!pt) { el.style.display = 'none'; return; }
        wp = [pt.x - 1000, (GEO.terrainHeightSurvey ? GEO.terrainHeightSurvey(pt.x, pt.y) : 0) + 0.45, -(pt.y - 2000)];
      } else if (item.kind === 'station') {
        var st = g.stationById(item.stationId);
        if (!st) { el.style.display = 'none'; return; }
        wp = [st.x - 1000, (GEO.terrainHeightSurvey ? GEO.terrainHeightSurvey(st.x, st.y) : 0) + 1.85, -(st.y - 2000)];
      } else {
        var pp = g.world.poles.get(id);
        if (pp && pp.stored) { el.style.display = 'none'; return; }
        var p = g.world.poleWorld(id);
        if (!p) { el.style.display = 'none'; return; }
        wp = [p.x, p.y + (g.world.poles.get(id).prismHeight || 1.5) + 0.35, p.z];
      }
      var pr = GEO.GL.projectPoint(cam.proj, cam.view, wp, W, H);
      if (!pr || pr.z > 70) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.left = pr.x + 'px';
      el.style.top = pr.y + 'px';
      if (item.kind === 'station' || item.kind === 'box') { el.classList.remove('done', 'off'); return; }
      if (item.kind === 'point') {
        el.classList.toggle('done', g.isTargetDone(item.pointId));
        return;
      }
      var control = !!g.controlById(id);
      var measured = !control && g.isTargetDone(id);
      el.classList.toggle('done', !!measured);
      var off = !control && !g.isPrismFacing(id);
      el.classList.toggle('off', off);
      el.title = off ? 'Отражатель не развёрнут к тахеометру (R)' : '';
    });
  };

  /* --------------------------------------------------------------- minimap */
  UI.prototype.drawMinimap = function () {
    var g = this.game;
    if (!g.world || !g.level || g.mode === 'title') return;
    var cv = document.getElementById('minimap');
    if (!cv || cv.offsetParent === null) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var cx = W / 2, cy = H / 2;
    var scale = 0.9;
    function mx(x) { return cx + (x - 1000) * scale; }
    function my(y) { return cy - (y - 2000) * scale; }
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1b1c';
    ctx.fillRect(0, 0, W, H);
    // зоны: парк, луг, лес, овраг
    (g.world.zones || []).forEach(function (z) {
      ctx.fillStyle = 'rgba(' + z.color.map(function (c) { return Math.round(c * 255); }).join(',') + ',.14)';
      ctx.fillRect(mx(z.x0), my(z.y1), (z.x1 - z.x0) * scale, (z.y1 - z.y0) * scale);
    });
    // сетка
    ctx.strokeStyle = 'rgba(120,220,200,.07)';
    ctx.lineWidth = 1;
    for (var gx = 940; gx <= 1100; gx += 10) {
      ctx.beginPath(); ctx.moveTo(mx(gx), 0); ctx.lineTo(mx(gx), H); ctx.stroke();
    }
    for (var gy = 1920; gy <= 2100; gy += 10) {
      ctx.beginPath(); ctx.moveTo(0, my(gy)); ctx.lineTo(W, my(gy)); ctx.stroke();
    }
    // дорожки
    (g.world.paths || []).forEach(function (p) {
      ctx.strokeStyle = 'rgba(205,190,150,.45)';
      ctx.lineWidth = Math.max(1.2, p.width * scale);
      ctx.beginPath();
      p.points.forEach(function (q, i) {
        if (i === 0) ctx.moveTo(mx(q[0]), my(q[1]));
        else ctx.lineTo(mx(q[0]), my(q[1]));
      });
      ctx.stroke();
    });
    // линия хода от пунктов привязки к станциям
    var links = g.traverseLinks ? g.traverseLinks() : [];
    var activeSt = g.session && g.session.setup.trueStation ? g.session.setup.trueStation.id : 'ST1';
    links.forEach(function (ln) {
      var active = ln.station.id === activeSt;
      ctx.strokeStyle = active ? 'rgba(63,224,197,.7)' : 'rgba(255,191,90,.22)';
      ctx.lineWidth = active ? 1.5 : 0.8;
      ctx.setLineDash(active ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(mx(ln.control.x), my(ln.control.y));
      ctx.lineTo(mx(ln.station.x), my(ln.station.y));
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // здания и изгороди
    (g.world.blockers || []).forEach(function (b) {
      var x0 = mx(b.x0), x1 = mx(b.x1), y0 = my(b.y1), y1 = my(b.y0);
      ctx.fillStyle = b.custom ? 'rgba(70,120,70,.38)' : 'rgba(170,180,175,.32)';
      ctx.strokeStyle = b.custom ? 'rgba(100,180,100,.45)' : 'rgba(200,210,205,.4)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    });
    // проектные точки
    if (g.level.designPoints) {
      g.level.designPoints.forEach(function (d) {
        ctx.strokeStyle = 'rgba(160,170,255,.8)';
        ctx.beginPath(); ctx.arc(mx(d.x), my(d.y), 4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(160,170,255,.8)';
        ctx.font = '8px monospace';
        ctx.fillText(d.id, mx(d.x) + 6, my(d.y) - 4);
      });
    }
    // вешки и пункты привязки
    g.world.poles.forEach(function (p, id) {
      if (g.session && g.session.carrying === id) return;
      if (p.stored) return;
      var kind = p.target.kind;
      if (p.control || kind === 'control') {
        ctx.save();
        ctx.translate(mx(p.x), my(p.y));
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffbf5a';
        ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
        ctx.strokeStyle = 'rgba(20,20,20,.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
        ctx.restore();
        return;
      }
      var measured = g.isTargetDone(id);
      ctx.beginPath();
      ctx.arc(mx(p.x), my(p.y), measured ? 3.2 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = kind === 'stakeout' ? '#aab4ff' : (measured ? '#3fe0c5' : '#d8e6e4');
      ctx.fill();
      if (kind === 'stakeout') {
        var d = g.level.targets.filter(function (t) { return t.id === id; })[0];
        if (d) {
          ctx.strokeStyle = 'rgba(170,180,255,.35)';
          ctx.beginPath(); ctx.moveTo(mx(p.x), my(p.y)); ctx.lineTo(mx(d.x), my(d.y)); ctx.stroke();
        }
      }
    });
    // точки задания и их подписи
    (g.level.targets || []).forEach(function (t) {
      if (!t.required && !t.free) return;
      var measured = g.isTargetDone(t.id);
      ctx.strokeStyle = measured ? 'rgba(63,224,197,.6)' : 'rgba(255,205,120,.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(mx(t.x), my(t.y), 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(230,200,140,.8)';
      ctx.font = '7px monospace';
      var lbl = g.pointName(t.id);
      ctx.fillText(lbl === t.id ? t.id : (t.id + ' ' + lbl).slice(0, 16), mx(t.x) + 5, my(t.y) - 4);
    });
    // станции
    var activeSt = g.session && g.session.setup.trueStation ? g.session.setup.trueStation.id : 'ST1';
    (g.stations || []).forEach(function (st) {
      var sx = mx(st.x), sy = my(st.y);
      var active = st.id === activeSt;
      ctx.strokeStyle = active ? '#3fe0c5' : 'rgba(150,190,190,.55)';
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy); ctx.lineTo(sx + 5, sy);
      ctx.moveTo(sx, sy - 5); ctx.lineTo(sx, sy + 5);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = active ? '#3fe0c5' : 'rgba(180,210,210,.55)';
      ctx.font = '8px monospace';
      ctx.fillText(st.id, sx + 8, sy - 6);
    });
    // ящик с запасными вешками
    var bxm = g.world.boxSurvey ? mx(g.world.boxSurvey.x) : null;
    var bzm = g.world.boxSurvey ? my(g.world.boxSurvey.y) : null;
    if (bxm != null) {
      ctx.fillStyle = 'rgba(150,105,55,.85)';
      ctx.fillRect(bxm - 5, bzm - 3, 10, 6);
      ctx.fillStyle = 'rgba(230,200,150,.75)';
      ctx.font = '7px monospace';
      ctx.fillText('ЯЩИК', bxm + 7, bzm + 3);
    }
    // игрок
    if (g.player && g.mode !== 'scope') {
      var px = mx(1000 + g.player.x), py = my(2000 - g.player.z);
      var yaw = g.player.yaw || 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px + Math.sin(yaw) * 7, py - Math.cos(yaw) * 7);
      ctx.lineTo(px + Math.sin(yaw + 2.5) * 5, py - Math.cos(yaw + 2.5) * 5);
      ctx.lineTo(px + Math.sin(yaw - 2.5) * 5, py - Math.cos(yaw - 2.5) * 5);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(180,210,210,.5)';
    ctx.font = '9px monospace';
    ctx.fillText('С', 7, 14);
    ctx.fillText('В', W - 15, 14);
  };

  /* --------------------------------------------------------------- bubble */
  UI.prototype.updateLeveling = function (tilt, ok, screws) {
    this.drawBubble(tilt, ok);
    var read = document.getElementById('tilt-read');
    if (read) {
      read.innerHTML = 'наклон X: <b>' + tilt.xArcsec.toFixed(1) + '″</b> · Y: <b>' + tilt.yArcsec.toFixed(1) + '″</b><br>' +
        '<span class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'допуск выполнен' : 'допуск 30″') + '</span>';
    }
    var btn = document.getElementById('btn-level-accept');
    if (btn) btn.disabled = !ok;
    if (screws) {
      for (var i = 0; i < 3; i++) {
        var knob = document.querySelector('.screw-knob[data-screw="' + i + '"]');
        if (knob) {
          var mark = knob.querySelector('.screw-mark');
          if (mark) mark.style.transform = 'rotate(' + (screws[i] * 135).toFixed(1) + 'deg)';
        }
        var val = document.querySelector('[data-screw-val="' + i + '"]');
        if (val) val.textContent = (screws[i] * 100).toFixed(0);
      }
    }
  };

  UI.prototype.bindKnobs = function () {
    var self = this;
    document.addEventListener('pointerdown', function (e) {
      var knob = e.target.closest && e.target.closest('.screw-knob');
      if (!knob || !self.modalOpen || !self.game.session) return;
      e.preventDefault();
      var i = parseInt(knob.getAttribute('data-screw'), 10);
      self.knobDrag = {
        index: i,
        startY: e.clientY,
        startVal: self.game.session.setup.screws[i]
      };
      knob.classList.add('active');
    });
    document.addEventListener('pointermove', function (e) {
      if (!self.knobDrag) return;
      var d = self.knobDrag;
      self.game.setScrew(d.index, d.startVal + (d.startY - e.clientY) * 0.006);
    });
    document.addEventListener('pointerup', function () {
      if (self.knobDrag) {
        var knob = document.querySelector('.screw-knob[data-screw="' + self.knobDrag.index + '"]');
        if (knob) knob.classList.remove('active');
        self.knobDrag = null;
      }
    });
    this.root.addEventListener('wheel', function (e) {
      var knob = e.target.closest && e.target.closest('.screw-knob');
      if (!knob || !self.modalOpen || !self.game.session) return;
      e.preventDefault();
      var i = parseInt(knob.getAttribute('data-screw'), 10);
      var step = e.deltaY > 0 ? -0.04 : 0.04;
      self.game.setScrew(i, self.game.session.setup.screws[i] + step);
    }, { passive: false });
  };

  UI.prototype.drawBubble = function (tilt, ok) {
    var cv = document.getElementById('bubble');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, R = W / 2 - 18;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#071312';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R + 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,230,200,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(80,230,200,.18)';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(80,230,200,.25)';
    ctx.beginPath();
    ctx.moveTo(W / 2 - R, H / 2); ctx.lineTo(W / 2 + R, H / 2);
    ctx.moveTo(W / 2, H / 2 - R); ctx.lineTo(W / 2, H / 2 + R);
    ctx.stroke();
    var maxTilt = 240;
    var bx = W / 2 + (tilt.xArcsec / maxTilt) * R;
    var by = H / 2 - (tilt.yArcsec / maxTilt) * R;
    var d = Math.hypot(bx - W / 2, by - H / 2);
    if (d > R - 10) {
      bx = W / 2 + (bx - W / 2) / d * (R - 10);
      by = H / 2 + (by - H / 2) / d * (R - 10);
    }
    ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fillStyle = ok ? 'rgba(63,224,197,.85)' : 'rgba(255,191,90,.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fill();
  };

  /* ----------------------------------------------------------------- menu */
  UI.prototype.openMenu = function (tab) {
    if (!this.game.level || !this.game.session) return;
    this.menuTab = tab || 'project';
    var tabs = [
      { id: 'project', label: 'Проект' }, { id: 'station', label: 'Станция' },
      { id: 'survey', label: 'Съёмка' }, { id: 'stakeout', label: 'Вынос' },
      { id: 'journal', label: 'Журнал' }, { id: 'settings', label: 'Настройки' }
    ].map(function (t) { return { id: t.id, label: t.label, active: t.id === tab }; });
    var self = this;
    var body, foot;
    switch (tab) {
      case 'station': body = this.menuStation(); foot = '<span class="mini-note">Изменение исходных данных сбрасывает ориентирование.</span><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'; break;
      case 'survey': body = this.menuSurvey(); foot = '<button class="btn" data-act="stake-measure">В окуляр</button><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'; break;
      case 'stakeout': body = this.menuStakeout(); foot = '<span class="mini-note">Команды помощнику передаются кнопками смещения; слежение включено после первого измерения.</span><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'; break;
      case 'journal': body = this.menuJournal(); foot = '<button class="btn" data-act="open-journal">Открыть журнал</button><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'; break;
      case 'settings': body = this.settingsBody(); foot = '<button class="btn primary" data-act="save-settings">Сохранить</button><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'; break;
      default: body = this.menuProject(); foot = '<span class="mini-note">Tab — меню · J — журнал · Esc — закрыть</span><span class="spacer"></span><button class="btn ghost" data-act="close">Продолжить</button><button class="btn danger" data-act="finish">Завершить задание</button>';
    }
    this.openSheet({
      title: this.game.level.title,
      sub: 'Уровень ' + this.game.level.order + ' · ' + typeBadge(this.game.level) + ' · тахеометр на станции ' +
        (this.game.session && this.game.session.setup.trueStation ? this.game.session.setup.trueStation.id : 'ST1'),
      tabs: tabs, body: body, foot: foot, wide: tab === 'journal' || tab === 'project',
      onMount: function () { if (tab === 'settings') self.syncSettingsForm(); }
    });
  };

  UI.prototype.menuProject = function () {
    var g = this.game, lvl = g.level, s = g.session;
    var freeMode = !!lvl.freeMode;
    var freeRows = freeMode && g.freePointRows ? g.freePointRows() : [];
    var targetN = freeMode ? (lvl.freeTargetCount || 5) : 0;
    var required = freeMode ? [] : lvl.targets.filter(function (t) { return t.required; });
    var done = required.filter(function (t) { return g.isTargetDone(t.id); });
    var list = freeMode
      ? freeRows.map(function (r) {
        return '<div class="mp-item done"><span class="st"></span><span class="pid">' + esc(r.pointId) + '</span><span>' + esc(r.pointName || r.pointId) + '</span><span class="ph">' + esc(r.poleName || '') + '</span></div>';
      }).join('')
      : required.map(function (t) {
        var row = g.getLatestRow(t.id);
        return '<div class="mp-item' + (row ? ' done' : '') + '"><span class="st"></span><span class="pid">' + esc(t.id) + '</span><span>' + esc(g.pointName(t.id)) + '</span><span class="ph">h ' + g.poleHeight(t.id).toFixed(2) + '</span></div>';
      }).join('');
    var cpRows = (g.controls || []).map(function (c) {
      return '<span>' + esc(c.id) + '</span><span>X ' + c.x.toFixed(3) + ' · Y ' + c.y.toFixed(3) + ' · Z ' + c.z.toFixed(3) + '</span>';
    }).join('');
    var checks = Object.keys(s.setup.checkResiduals || {}).length;
    var activeSt = s.setup.trueStation || lvl.station;
    return '<div class="two-col"><div>' +
      '<div class="callout"><b>Задание.</b> ' + esc(lvl.briefing) + '</div>' +
      '<div class="result-section"><h4>ИСХОДНЫЕ ДАННЫЕ</h4><div class="kv">' +
      '<span>Станция</span><span>' + esc(activeSt.id) + ' · X ' + activeSt.x.toFixed(3) + ' · Y ' + activeSt.y.toFixed(3) + ' · Z ' + activeSt.z.toFixed(3) + '</span>' +
      '<span>Смена станции</span><span>' + (g.stations || []).length + ' точки: ' + (g.stations || []).map(function (x) { return x.id; }).join(', ') + '</span>' +
      '<span>Высота тахеометра</span><span>' + lvl.instrumentHeight.toFixed(2) + ' м</span>' +
      '<span>Пункты привязки</span><span>' + (g.controls || []).length + ' шт. · ' + (g.controls || []).map(function (c) { return c.id; }).join(', ') + '</span>' +
      '<span>Допуск по плану</span><span>± ' + (lvl.tolerance.xy * 100).toFixed(0) + ' см</span>' +
      '<span>Допуск по высоте</span><span>± ' + (lvl.tolerance.z * 100).toFixed(0) + ' см</span>' +
      '<span>Ориентирование</span><span>≤ ' + lvl.tolerance.orientationArcsec + '″</span>' +
      '<span>Лимит времени</span><span>' + (lvl.timeLimitSec ? fmtTime(lvl.timeLimitSec) : 'без лимита') + '</span>' +
      '</div></div>' +
      '<div class="result-section"><h4>ПУНКТЫ ПРИВЯЗКИ</h4><div class="kv">' + cpRows + '</div>' +
      '<div class="mini-note" style="margin-top:6px">Ориентирование — по любому пункту, контроль — по двум остальным.</div></div>' +
      '<div class="result-section"><h4>ФОРМУЛЫ</h4><div class="mini-note mono">HD = SD · sin(ZA)<br>ΔH = SD · cos(ZA)<br>X = X₀ + HD · sin(HA)<br>Y = Y₀ + HD · cos(HA)<br>Z = Z₀ + hi + ΔH − hвехи</div></div>' +
      '</div><div>' +
      '<div class="result-section"><h4>ТОЧКИ · ' + (freeMode ? freeRows.length : done.length) + ' / ' + (freeMode ? targetN : required.length) + '</h4><div class="mp-list">' + (list || '<div class="empty-state">' + (freeMode ? 'Свободная съёмка: поставьте вешку и нажмите T' : 'В задании нет обязательных точек') + '</div>') + '</div></div>' +
      '<div class="result-section"><h4>СОСТОЯНИЕ</h4><div class="mp-status">' +
      '<span class="chip ' + (s.setup.leveled ? 'ok' : 'warn') + '">' + (s.setup.leveled ? 'тахеометр в горизонте' : 'не выставлен') + '</span>' +
      '<span class="chip ' + (s.setup.dataEntered ? 'ok' : 'warn') + '">' + (s.setup.dataEntered ? 'данные введены' : 'данные не введены') + '</span>' +
      '<span class="chip ' + (s.setup.oriented ? 'ok' : 'warn') + '">' + (s.setup.oriented ? 'ориентирован по ' + esc(s.setup.orientedFrom || 'BS1') : 'не ориентирован') + '</span>' +
      '<span class="chip ' + (checks >= 2 ? 'ok' : 'warn') + '">привязка ' + checks + ' / ' + (g.controls || []).length + '</span>' +
      '</div></div>' +
      '<div class="callout" style="margin-top:14px"><b>Подсказка.</b> Ориентируйтесь по ближайшему пункту привязки, затем проверьте остальные клавишей C. Вешки можно переносить: E рядом с вешкой, R — развернуть отражатель к тахеометру.</div>' +
      '</div></div>';
  };

  UI.prototype.menuStation = function () {
    var g = this.game, lvl = g.level, s = g.session;
    var st = s.setup;
    var activeSt = st.trueStation || lvl.station;
    var tilt = Math.hypot(st.tilt.xArcsec, st.tilt.yArcsec);
    var cap = g.getCaptured();
    var cp = cap ? g.controlById(cap.id) : null;
    var cpAimed = !!(cp && cap && cap.hit && cap.facing !== false);
    var checks = Object.keys(st.checkResiduals || {}).length;
    var tol = lvl.tolerance.orientationArcsec;
    var controls = g.controls || [];
    var stationRows = (g.stations || []).map(function (x) {
      var active = x.id === activeSt.id;
      return '<div class="mp-item' + (active ? ' done' : '') + '" style="cursor:default">' +
        '<span class="st"></span><span class="pid">' + esc(x.id) + '</span>' +
        '<span>X ' + x.x.toFixed(1) + ' · Y ' + x.y.toFixed(1) + '</span>' +
        (active ? '<span class="req">текущая</span>' :
          '<button class="btn small ghost" data-act="change-station" data-id="' + esc(x.id) + '">Перенести</button>') +
        '</div>';
    }).join('');
    var links = g.traverseLinks ? g.traverseLinks() : [];
    var lineRows = links.map(function (ln) {
      var active = ln.station.id === activeSt.id;
      return '<div class="mp-item' + (active ? ' done' : '') + '">' +
        '<span class="st"></span><span class="pid">' + esc(ln.station.id) + ' → ' + esc(ln.control.id) + '</span>' +
        '<span>' + ln.dist.toFixed(1) + ' м' + (ln.visible ? '' : ' · закрыта') + '</span>' +
        '<span class="ph">' + SM.formatAngle(ln.az) + '</span></div>';
    }).join('');
    var cpRows = controls.map(function (c) {
      var res = st.checkResiduals[c.id];
      var base = !res && st.orientedFrom === c.id;
      var cls = res == null ? '' : (Math.abs(res) <= tol ? 'ok' : 'bad');
      var label = res != null ? Math.abs(res).toFixed(1) + '″' : (base ? 'база' : 'не проверен');
      var color = res == null ? (base ? 'var(--amber)' : 'var(--muted-2)') : (Math.abs(res) <= tol ? 'var(--teal)' : 'var(--red)');
      return '<div class="mp-item' + (res != null ? ' done' : '') + '" style="cursor:default">' +
        '<span class="st"></span><span class="pid">' + esc(c.id) + '</span>' +
        '<span>X ' + c.x.toFixed(3) + ' · Y ' + c.y.toFixed(3) + '</span>' +
        '<span class="ph ' + cls + '" style="color:' + color + '">' + label + '</span></div>';
    }).join('');
    var disabled = !st.dataEntered ? ' disabled' : '';
    var orientDisabled = (!st.dataEntered || !cpAimed) ? ' disabled' : '';
    var checkDisabled = (!st.oriented || !cpAimed) ? ' disabled' : '';
    return '<div class="two-col"><div>' +
      '<div class="result-section"><h4>СОСТОЯНИЕ УСТАНОВКИ · ' + esc(activeSt.id) + '</h4><div class="mp-status">' +
      '<span class="chip ' + (st.leveled ? 'ok' : 'warn') + '">горизонт: ' + (st.leveled ? 'да, ' + tilt.toFixed(0) + '″' : 'нет') + '</span>' +
      '<span class="chip ' + (st.dataEntered ? 'ok' : 'warn') + '">данные: ' + (st.dataEntered ? 'введены' : 'нет') + '</span>' +
      '<span class="chip ' + (st.oriented ? 'ok' : 'warn') + '">ориентирование: ' + (st.oriented ? (st.orientedFrom || 'BS1') + ' · ' + Math.abs(st.orientationErrorArcsec).toFixed(1) + '″' : 'нет') + '</span>' +
      '<span class="chip ' + (checks >= 2 ? 'ok' : 'warn') + '">привязка: ' + checks + ' / ' + controls.length + '</span>' +
      '</div></div>' +
      '<div class="result-section"><h4>ИСХОДНЫЕ ДАННЫЕ СТАНЦИИ</h4>' +
      '<div class="field-grid">' +
      field('st-x', 'X станции, м', st.stationInput.x.toFixed(3)) +
      field('st-y', 'Y станции, м', st.stationInput.y.toFixed(3)) +
      field('st-z', 'Z станции, м', st.stationInput.z.toFixed(3)) +
      field('st-hi', 'Высота тахеометра, м', (st.instrumentHeightInput != null ? st.instrumentHeightInput : lvl.instrumentHeight).toFixed(2)) +
      '</div>' +
      '<div class="form-row"><button class="btn primary" data-act="apply-station">Применить данные</button>' +
      '<span class="mini-note">После изменения данных ориентирование выполняется заново.</span></div></div>' +
      '<div class="result-section"><h4>ЛИНИЯ ХОДА</h4><div class="mp-list">' + lineRows + '</div>' +
      '<div class="mini-note" style="margin-top:6px">Пунктир на плане — передача координат от ближайшего геодезического пункта к станции. Активная станция выделена.</div></div>' +
      '<div class="result-section"><h4>СМЕНА СТАНЦИИ</h4><div class="mp-list">' + stationRows + '</div>' +
      '<div class="mini-note" style="margin-top:6px">Тахеометр можно перенести на другую известную станцию. Установка, горизонт и ориентирование сбрасываются — участок снимается заново с новой точки.</div></div>' +
      '<div class="result-section"><h4>ПУНКТЫ ПРИВЯЗКИ</h4><div class="mp-list">' + cpRows + '</div></div>' +
      '<div class="result-section"><h4>ОРИЕНТИРОВАНИЕ И КОНТРОЛЬ</h4>' +
      '<div class="callout' + (cpAimed ? '' : ' warn') + '"><b>' + (cpAimed ? esc(cp.id) + ' в перекрестии.' : 'Наведитесь на пункт привязки.') + '</b> ' +
      'Ориентирование — по любому пункту привязки; затем проверьте остальные клавишей C.</div>' +
      '<div class="form-row">' +
      '<button class="btn" data-act="orient"' + orientDisabled + '>Ориентировать по ' + (cp ? esc(cp.id) : 'пункту') + '</button>' +
      '<button class="btn ghost" data-act="check"' + checkDisabled + '>Проверить ' + (cp ? esc(cp.id) : 'пункт') + '</button>' +
      '</div>' +
      '<div class="mini-note" style="margin-top:8px">Горячие клавиши: O — ориентировать, C — проверить текущий пункт. Для зачёта нужно проверить не менее двух пунктов.</div>' +
      '</div></div>' +
      '<div><div class="result-section"><h4>ЗАДАНИЕ</h4><div class="kv">' +
      '<span>X станции</span><span>' + lvl.station.x.toFixed(3) + '</span>' +
      '<span>Y станции</span><span>' + lvl.station.y.toFixed(3) + '</span>' +
      '<span>Z станции</span><span>' + lvl.station.z.toFixed(3) + '</span>' +
      '<span>Высота тахеометра</span><span>' + lvl.instrumentHeight.toFixed(2) + '</span>' +
      '<span>Высота вехи</span><span>' + (s.prismHeightInput).toFixed(2) + '</span>' +
      '</div></div>' +
      '<div class="result-section"><h4>ПРИВЯЗКА</h4><div class="kv">' +
      controls.map(function (c) {
        return '<span>' + esc(c.id) + '</span><span>X ' + c.x.toFixed(3) + ' · Y ' + c.y.toFixed(3) + ' · Z ' + c.z.toFixed(3) + '</span>';
      }).join('') +
      '</div></div>' +
      '<div class="callout warn" style="margin-top:14px">Ошибка координат станции или ориентирования проявляется как невязка на остальных пунктах привязки. Проверяйте привязку до съёмки.</div>' +
      '<div class="result-section"><h4>ПЕРЕНАСТРОЙКА</h4><div class="form-row">' +
      '<button class="btn ghost" data-act="restart">Начать уровень заново</button></div></div>' +
      '</div></div>';
  };

  UI.prototype.menuSurvey = function () {
    var g = this.game, lvl = g.level, s = g.session;
    var cap = g.getCaptured();
    var poles = (g.targets || []).filter(function (t) { return t.kind !== 'control' && !t.free; });
    var freePoints = (g.level.targets || []).filter(function (t) { return t.free; });
    var list = poles.map(function (t) {
      var row = g.getLatestRow(t.id);
      var h = g.poleHeight(t.id);
      var name = g.poleName(t.id);
      var pobj = g.world.poles.get(t.id);
      var stored = !!(pobj && pobj.stored);
      var pname = g.pointName(t.id);
      return '<div class="pole-row' + (row ? ' done' : '') + (stored ? ' stored' : '') + '">' +
        '<span class="pid">' + esc(t.id) + '</span>' +
        '<span class="pole-name"><b>' + esc(pname) + '</b><small>вешка ' + esc(name) + ' · ' + esc(t.note || kindRu(t.kind)) + '</small></span>' +
        '<label class="pole-h">h <input type="number" min="0.5" max="2.5" step="0.05" data-pole-height="' + esc(t.id) + '" value="' + h.toFixed(2) + '"></label>' +
        '<button class="btn tiny" data-act="rename-point" data-id="' + esc(t.id) + '" title="Подписать точку">Точка</button>' +
        '<button class="btn tiny" data-act="rename-pole" data-id="' + esc(t.id) + '" title="Переименовать вешку">Имя</button>' +
        (t.practice ? '<button class="icon-btn danger-mini" data-act="remove-pole" data-id="' + esc(t.id) + '" title="Убрать вешку">×</button>' : '') +
        '</div>';
    }).join('');
    var practiceCount = poles.filter(function (t) { return t.practice; }).length;
    var storedCount = poles.filter(function (t) { var p = g.world.poles.get(t.id); return p && p.stored; }).length;
    var freeHtml = freePoints.length ? '<div class="result-section" style="margin-top:12px"><h4>СВОБОДНЫЕ ТОЧКИ · ' + freePoints.length + '</h4><div class="pole-list">' +
      freePoints.map(function (t) {
        return '<div class="pole-row' + (g.isTargetDone(t.id) ? ' done' : '') + '"><span class="pid">' + esc(t.id) + '</span>' +
          '<span class="pole-name"><b>' + esc(g.pointName(t.id)) + '</b><small>свободная точка · вешка ' + esc(g.poleNameForTarget(t.id)) + '</small></span>' +
          '<button class="btn tiny" data-act="rename-point" data-id="' + esc(t.id) + '">Точка</button></div>';
      }).join('') + '</div></div>' : '';
    var takeFree = (lvl.freeMode ? '<button class="btn small primary" data-act="add-free-point">+ Свободная точка (T)</button>' : '');
    return '<div class="two-col"><div>' +
      '<div class="result-section"><h4>ВЕШКИ · ' + poles.length + '</h4>' +
      '<div class="pole-toolbar"><span>Всего: <b>' + poles.length + '</b> · в ящике: <b>' + storedCount + '</b> · практических: <b>' + practiceCount + '</b></span>' +
      '<span class="spacer"></span>' + (storedCount ? '<button class="btn tiny primary" data-act="take-next-pole">Взять следующую</button>' : '') +
      '<button class="btn tiny" data-act="remove-last-pole">− убрать</button>' +
      '<button class="btn tiny primary" data-act="add-pole">+ добавить</button>' + takeFree + '</div>' +
      '<div class="pole-list">' + list + '</div>' + freeHtml +
      '<div class="mini-note" style="margin-top:8px">Кнопка «Имя» переименовывает вешку. Поле «h» задаёт фактическую высоту вехи и передаёт её в тахеометр. «+ добавить» создаёт практическую вешку в ящике, «− убрать» удаляет последнюю из них. Запасные вешки стоят в ящике у станции — их берут клавишей E.</div></div>' +
      '</div><div>' +
      '<div class="callout"><b>Порядок.</b> Наведитесь на призму, проверьте угловое смещение (Δ), при необходимости приблизьте зум и уточните стрелками. Вешки можно переносить: подойдите и нажмите <b>E</b>, затем <b>R</b>, чтобы развернуть отражатель к тахеометру. Высота также меняется клавишами <b>[</b> / <b>]</b>.</div>' +
      '<div class="result-section"><h4>ТЕКУЩАЯ ЦЕЛЬ</h4>' +
      '<div class="kv"><span>Цель</span><span>' + (cap ? esc(g.pointName(cap.id)) + (cap.facing === false ? ' · призма не к тахеометру' : (cap.hit ? ' · захвачена' : ' · не в призме')) : '—') + '</span>' +
      '<span>Угловое смещение</span><span>' + (cap ? SM.arcsec(cap.off).toFixed(1) + '″' : '—') + '</span>' +
      '<span>Наклонная дальность</span><span>' + (cap ? cap.sd.toFixed(3) + ' м' : '—') + '</span>' +
      '<span>Высота вехи</span><span>' + s.prismHeightInput.toFixed(2) + ' м</span></div>' +
      '<div class="form-row"><button class="btn primary" data-act="stake-measure">Вернуться в окуляр</button>' +
      (cap && cap.facing === false ? '<button class="btn ghost" data-act="face-prism" data-id="' + esc(cap.id) + '">Развернуть призму</button>' : '') + '</div></div>' +
      '<div class="result-section"><h4>ВЫСОТА ВЕХИ</h4><div class="mini-note">Высота каждой вешки задаётся в списке слева или клавишами <b>[</b> / <b>]</b> в окуляре. При изменении фактическая высота и ввод в тахеометр синхронизируются.</div></div>' +
      '</div></div>';
  };

  UI.prototype.menuStakeout = function () {
    var g = this.game, lvl = g.level, s = g.session;
    var designs = lvl.designPoints || [];
    if (!designs.length) return '<div class="empty-state">В этом задании нет выноса в натуру. Выберите уровень «Вынос в натуру».</div>';
    var sel = s.stakeout.selectedId;
    var rows = designs.map(function (d) {
      var done = g.isTargetDone(d.id);
      return '<div class="mp-item' + (done ? ' done' : '') + '" style="cursor:pointer" data-act="stake-select" data-id="' + d.id + '">' +
        '<span class="st"></span><span class="pid">' + esc(d.id) + '</span><span>' + esc(d.note || '') + '</span>' +
        '<span class="ph">' + (sel === d.id ? 'выбрана' : '') + '</span></div>';
    }).join('');
    var detail = '<div class="empty-state">Выберите точку из списка.</div>';
    if (sel) {
      var d = designs.filter(function (x) { return x.id === sel; })[0];
      var meas = s.stakeout.measurement;
      var delta = g.stakeoutDelta();
      detail = '<div class="kv">' +
        '<span>Проект X</span><span>' + d.x.toFixed(3) + '</span>' +
        '<span>Проект Y</span><span>' + d.y.toFixed(3) + '</span>' +
        '<span>Проект Z</span><span>' + d.z.toFixed(3) + '</span>' +
        '</div>';
      if (meas) {
        detail += '<div class="result-section"><h4>РЕЗУЛЬТАТ ИЗМЕРЕНИЯ</h4><div class="kv">' +
          '<span>Измерено X</span><span>' + meas.x.toFixed(3) + '</span>' +
          '<span>Измерено Y</span><span>' + meas.y.toFixed(3) + '</span>' +
          '<span>Измерено Z</span><span>' + meas.z.toFixed(3) + '</span>' +
          '<span>ΔX (восток)</span><span class="' + deltaClass(delta.dx, lvl.tolerance.xy) + '">' + fmtSigned(delta.dx) + ' м</span>' +
          '<span>ΔY (север)</span><span class="' + deltaClass(delta.dy, lvl.tolerance.xy) + '">' + fmtSigned(delta.dy) + ' м</span>' +
          '<span>ΔZ</span><span class="' + deltaClass(delta.dz, lvl.tolerance.z) + '">' + fmtSigned(delta.dz) + ' м</span>' +
          '<span>Плановая ошибка</span><span>' + delta.xy.toFixed(3) + ' м</span>' +
          '</div></div>' +
          '<div class="result-section"><h4>КОМАНДЫ ПОМОЩНИКУ</h4>' +
          '<div class="form-row">' +
          '<button class="btn small" data-act="nudge" data-dir="N" data-step="0.1">Север +10 см</button>' +
          '<button class="btn small" data-act="nudge" data-dir="S" data-step="0.1">Юг −10 см</button>' +
          '<button class="btn small" data-act="nudge" data-dir="E" data-step="0.1">Восток +10 см</button>' +
          '<button class="btn small" data-act="nudge" data-dir="W" data-step="0.1">Запад −10 см</button>' +
          '</div><div class="form-row">' +
          '<button class="btn small ghost" data-act="nudge" data-dir="N" data-step="0.01">Север +1 см</button>' +
          '<button class="btn small ghost" data-act="nudge" data-dir="S" data-step="0.01">Юг −1 см</button>' +
          '<button class="btn small ghost" data-act="nudge" data-dir="E" data-step="0.01">Восток +1 см</button>' +
          '<button class="btn small ghost" data-act="nudge" data-dir="W" data-step="0.01">Запад −1 см</button>' +
          '</div>' +
          '<div class="form-row"><button class="btn primary" data-act="stake-fix">Зафиксировать точку</button>' +
          '<button class="btn ghost" data-act="stake-measure">Перемерить из окуляра</button></div>' +
          '<div class="mini-note" style="margin-top:8px">Слежение включено: после перемещения вешки координаты пересчитываются автоматически.</div>' +
          '</div>';
      } else {
        detail += '<div class="callout warn" style="margin-top:12px"><b>Вешка не измерена.</b> Наведитесь на ' + d.id + ' в окуляре и нажмите ЛКМ. После первого измерения появятся разности и команды перемещения.</div>' +
          '<div class="form-row"><button class="btn primary" data-act="stake-measure">В окуляр</button></div>';
      }
    }
    return '<div class="two-col"><div><div class="result-section"><h4>ПРОЕКТНЫЕ ТОЧКИ</h4><div class="mp-list">' + rows + '</div></div>' +
      '<div class="callout" style="margin-top:12px"><b>Допуск:</b> ' + (lvl.tolerance.xy * 100).toFixed(0) + ' см по плану, ' + (lvl.tolerance.z * 100).toFixed(0) + ' см по высоте.</div></div>' +
      '<div><div class="result-section"><h4>' + (sel ? 'ТОЧКА ' + sel : 'ТОЧКА') + '</h4>' + detail + '</div></div></div>';
  };

  UI.prototype.menuJournal = function () {
    var g = this.game;
    var rows = g.session.journal;
    if (!rows.length) return '<div class="empty-state">Журнал пуст. Выполните первое измерение.</div>';
    var recent = rows.slice(-6).reverse().map(function (r) {
      return '<div class="mp-item"><span class="pid">' + esc(r.pointName || r.pointId) + '</span><span>' + kindRu(r.kind) + '</span>' +
        '<span class="ph">' + r.sd.toFixed(3) + ' м</span></div>';
    }).join('');
    return '<div class="callout">Записей: <b>' + rows.length + '</b>. Полный журнал доступен по кнопке ниже или клавише J.</div>' +
      '<div class="result-section"><h4>ПОСЛЕДНИЕ ИЗМЕРЕНИЯ</h4><div class="mp-list">' + recent + '</div></div>';
  };

  UI.prototype.openJournal = function () {
    var g = this.game;
    if (!g.session) return;
    var rows = g.session.journal;
    var self = this;
    var head = '<tr><th>№</th><th>Ст.</th><th>Точка</th><th>Вешка</th><th>Тип</th><th>HA</th><th>ZA</th><th>SD, м</th><th>HD, м</th><th>ΔH, м</th><th>X, м</th><th>Y, м</th><th>Z, м</th><th>h вехи</th>' +
      (this.compare ? '<th>ΔXY</th><th>ΔZ</th>' : '') + '<th></th></tr>';
    var body = rows.map(function (r, i) {
      var ref = r.ref || r.true;
      var exy = ref ? Math.hypot(r.x - ref.x, r.y - ref.y) : null;
      var ez = ref ? r.z - ref.z : null;
      var tol = g.level.tolerance;
      return '<tr><td>' + (i + 1) + '</td><td class="pid">' + esc(r.stationId || '—') + '</td><td class="pid">' + esc(r.pointName || r.pointId) + '</td>' +
        '<td class="pid">' + esc(r.poleName || '—') + '</td>' +
        '<td><span class="tag ' + r.kind + '">' + kindRu(r.kind) + '</span></td>' +
        '<td>' + SM.formatAngle(r.ha) + '</td><td>' + SM.formatAngle(r.za) + '</td>' +
        '<td>' + r.sd.toFixed(3) + '</td><td>' + r.hd.toFixed(3) + '</td><td>' + fmtSigned(r.dh) + '</td>' +
        '<td>' + r.x.toFixed(3) + '</td><td>' + r.y.toFixed(3) + '</td><td>' + r.z.toFixed(3) + '</td>' +
        '<td>' + r.prismHeight.toFixed(2) + '</td>' +
        (self.compare ? '<td class="' + deltaClass(exy, tol.xy) + '">' + (exy == null ? '—' : exy.toFixed(3)) + '</td>' +
          '<td class="' + deltaClass(Math.abs(ez), tol.z) + '">' + (ez == null ? '—' : fmtSigned(ez)) + '</td>' : '') +
        '<td><button class="del" data-act="delete-row" data-id="' + r.id + '" title="Удалить запись">×</button></td></tr>';
    }).join('');
    var table = '<div class="table-wrap"><table class="journal"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    var measured = Object.keys(g.session.measured || {}).length;
    var bodyHtml = '<div class="journal-toolbar">' +
      '<span class="pill">' + rows.length + ' записей</span>' +
      '<span class="pill">' + measured + ' точек</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn small ' + (this.compare ? 'primary' : 'ghost') + '" data-act="toggle-compare">Сравнение с эталоном</button>' +
      '<button class="btn small" data-act="export-csv">Экспорт CSV</button>' +
      '</div>' + (rows.length ? table : '<div class="journal-empty">Журнал пуст. Выполните измерения в окуляре.</div>');
    this.openSheet({
      title: 'Полевой журнал', sub: 'Станция ' + (g.session.setup.trueStation ? g.session.setup.trueStation.id : g.level.station.id) + ' · ' + g.level.title + ' · координаты X (восток), Y (север), Z',
      body: bodyHtml, wide: true,
      foot: '<span class="mini-note">ΔXY/ΔZ — расхождение с эталоном задания. Удаление записи не отменяет уже выполненное наведение.</span><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'
    });
  };

  /* ---------------------------------------------------------------- setup */
  UI.prototype.openSetup = function (step) {
    var g = this.game, lvl = g.level, s = g.session;
    var stp = s.setup;
    var activeSt = stp.trueStation || lvl.station;
    this.setupStep = step;
    var steps = '<div class="steps-ind">' +
      [0, 1, 2].map(function (n) { return '<span class="si ' + (n < step ? 'done' : (n === step ? 'on' : '')) + '"></span>'; }).join('') + '</div>';
    var body, foot;
    if (step === 0) {
      g.levelingActive = false;
      var stage1 = stp.tripodPlaced
        ? '<span class="chip ok">штатив установлен</span>'
        : '<button class="btn primary" data-act="setup-tripod">Установить штатив</button>';
      var stage2 = !stp.tripodPlaced
        ? '<span class="chip">сначала штатив</span>'
        : (stp.instrumentMounted
          ? '<span class="chip ok">тахеометр установлен</span>'
          : '<button class="btn primary" data-act="setup-mount">Установить тахеометр на трегер</button>');
      var stage3 = stp.instrumentMounted
        ? '<button class="btn" data-act="setup-level">Перейти к горизонтированию</button>'
        : '<span class="chip">после установки тахеометра</span>';
      body = steps + '<div class="level-layout"><div class="assembly-visual">' +
        '<div class="asm-tripod"><span class="asm-leg l1"></span><span class="asm-leg l2"></span><span class="asm-leg l3"></span><span class="asm-head"></span></div>' +
        '<div class="asm-instrument' + (stp.instrumentMounted ? ' mounted' : '') + '"></div>' +
        '<div class="asm-caption">Штатив → трегер → тахеометр</div></div>' +
        '<div><h4 style="font-size:10px;letter-spacing:.18em;color:var(--muted);margin:0 0 8px">СБОРКА ТАХЕОМЕТРА НА СТАНЦИИ</h4>' +
        '<p class="form-note">Сначала разверните штатив и проверьте, что он стоит устойчиво. Затем поставьте на трегер сам тахеометр и только после этого приступайте к горизонтированию подъёмными винтами.</p>' +
        '<div class="assembly-steps">' +
        '<div class="asm-row"><span class="asm-num">1</span><div><b>Штатив</b><br><span class="mini-note">Ножки раздвинуты, головка примерно в горизонте.</span></div>' + stage1 + '</div>' +
        '<div class="asm-row"><span class="asm-num">2</span><div><b>Тахеометр на трегере</b><br><span class="mini-note">Зафиксируйте тахеометр становым винтом.</span></div>' + stage2 + '</div>' +
        '<div class="asm-row"><span class="asm-num">3</span><div><b>Горизонт</b><br><span class="mini-note">Три подъёмных винта и круглый уровень.</span></div>' + stage3 + '</div>' +
        '</div>' +
        '<div class="callout" style="margin-top:12px"><b>Станция ' + esc(activeSt.id) + '.</b> X ' + activeSt.x.toFixed(3) + ' · Y ' + activeSt.y.toFixed(3) +
        ' · Z ' + activeSt.z.toFixed(3) + '. Высота тахеометра ' + lvl.instrumentHeight.toFixed(2) + ' м.</div>' +
        '</div></div>';
      foot = '<span class="mini-note">Шаг 1 из 3 · штатив и установка тахеометра</span>';
      this.openSheet({ title: 'Установка тахеометра', sub: 'Станция ' + activeSt.id + ' · сборка штатива и трегера', body: body, foot: foot, wide: true });
    } else if (step === 1) {
      g.levelingActive = true;
      var tilt = stp.tilt;
      var mag = Math.hypot(tilt.xArcsec, tilt.yArcsec);
      var screws = stp.screws || [0, 0, 0];
      body = steps + '<div class="level-layout">' +
        '<div class="level-board">' +
        '<div class="knob-slot knob-top"><div class="screw-knob" data-screw="0" title="Подъёмный винт A"><i class="screw-mark"></i></div><span class="screw-label">Винт A</span><span class="screw-val" data-screw-val="0">' + (screws[0] * 100).toFixed(0) + '</span></div>' +
        '<div class="knob-slot knob-bl"><div class="screw-knob" data-screw="1" title="Подъёмный винт B"><i class="screw-mark"></i></div><span class="screw-label">Винт B</span><span class="screw-val" data-screw-val="1">' + (screws[1] * 100).toFixed(0) + '</span></div>' +
        '<div class="bubble-wrap"><canvas id="bubble" class="bubble-canvas" width="480" height="480"></canvas></div>' +
        '<div class="knob-slot knob-br"><div class="screw-knob" data-screw="2" title="Подъёмный винт C"><i class="screw-mark"></i></div><span class="screw-label">Винт C</span><span class="screw-val" data-screw-val="2">' + (screws[2] * 100).toFixed(0) + '</span></div>' +
        '</div>' +
        '<div><h4 style="font-size:10px;letter-spacing:.18em;color:var(--muted);margin:0 0 8px">ПРИВЕДЕНИЕ В ГОРИЗОНТ</h4>' +
        '<p class="form-note">Пузырёк круглого уровня выводится в центр тремя подъёмными винтами. Вращайте колёсики A, B и C мышью (или колесом мыши), пока пузырёк не окажется в нуль-пункте.</p>' +
        '<div class="callout" style="margin-top:12px"><b>Как в поле.</b> Вращая винты, наклоняют подставку в двух плоскостях. Тахеометр считают выставленным при остаточном наклоне не более 30″.</div>' +
        '<div class="tilt-read tilt-read-side" id="tilt-read">наклон X: <b>' + tilt.xArcsec.toFixed(1) + '″</b> · Y: <b>' + tilt.yArcsec.toFixed(1) + '″</b><br>' +
        '<span class="' + (mag <= 30 ? 'ok' : 'bad') + '">' + (mag <= 30 ? 'допуск выполнен' : 'допуск 30″') + '</span></div>' +
        '<div class="form-row" style="margin-top:16px">' +
        '<button class="btn primary" data-act="level-accept" id="btn-level-accept"' + (mag <= 30 ? '' : ' disabled') + '>Принять горизонт</button>' +
        '<button class="btn ghost" data-act="level-auto">Автоуровень (−5 баллов)</button>' +
        '</div>' +
        '<div class="mini-note" style="margin-top:10px">Колёсики можно крутить мышью вверх-вниз или колесом мыши. Автоуровень выставляет горизонт автоматически.</div>' +
        '</div></div>';
      foot = '<span class="mini-note">Шаг 2 из 3 · горизонтирование тремя подъёмными винтами</span>';
      this.openSheet({ title: 'Горизонтирование', sub: 'Станция ' + activeSt.id + ' · круглый уровень и три винта', body: body, foot: foot, wide: true });
      this.updateLeveling(tilt, mag <= 30, screws);
    } else {
      g.levelingActive = false;
      var st = s.setup.stationInput;
      var controls = g.controls || [];
      body = steps + '<div class="two-col"><div>' +
        '<h4 style="font-size:10px;letter-spacing:.18em;color:var(--muted);margin:0 0 10px">ИСХОДНЫЕ ДАННЫЕ</h4>' +
        '<div class="field-grid">' +
        field('st-x', 'X станции, м', st.x.toFixed(3)) +
        field('st-y', 'Y станции, м', st.y.toFixed(3)) +
        field('st-z', 'Z станции, м', st.z.toFixed(3)) +
        field('st-hi', 'Высота тахеометра, м', (s.setup.instrumentHeightInput || lvl.instrumentHeight).toFixed(2)) +
        '</div>' +
        '<div class="form-row"><button class="btn ghost" data-act="setup-back">Назад</button>' +
        '<button class="btn primary" data-act="apply-station">Применить и продолжить</button></div>' +
        '<div class="mini-note" style="margin-top:10px">После применения откроется окуляр. Ориентируйтесь по ближайшему пункту (O), затем проверьте остальные (C).</div>' +
        '</div><div>' +
        '<div class="callout"><b>Данные из задания.</b><br>Станция ' + esc(activeSt.id) + ': X ' + activeSt.x.toFixed(3) + ', Y ' + activeSt.y.toFixed(3) + ', Z ' + activeSt.z.toFixed(3) + '<br>' +
        'Высота тахеометра: ' + lvl.instrumentHeight.toFixed(2) + ' м</div>' +
        '<div class="result-section"><h4>ПУНКТЫ ПРИВЯЗКИ</h4><div class="kv">' +
        controls.map(function (c) {
          return '<span>' + esc(c.id) + '</span><span>X ' + c.x.toFixed(3) + ' · Y ' + c.y.toFixed(3) + ' · Z ' + c.z.toFixed(3) + '</span>';
        }).join('') +
        '</div><div class="mini-note" style="margin-top:6px">Координаты пунктов известны и не вводятся вручную.</div></div>' +
        '<div class="callout warn" style="margin-top:10px">Вводите координаты станции внимательно: ошибка 10 см сместит весь план и проявится на контрольных пунктах.</div>' +
        '</div></div>';
      foot = '<span class="mini-note">Шаг 3 из 3 · ввод исходных данных</span>';
      this.openSheet({ title: 'Исходные данные станции', sub: 'Проверьте координаты и высоты по заданию', body: body, foot: foot });
    }
  };

  UI.prototype.applyStation = function () {
    var g = this.game;
    var get = function (id) { var el = document.getElementById(id); return el ? parseFloat(el.value.replace(',', '.')) : NaN; };
    var data = {
      x: get('st-x'), y: get('st-y'), z: get('st-z'), hi: get('st-hi')
    };
    if (![data.x, data.y, data.z, data.hi].every(isFinite)) {
      this.toast('Проверьте числовые поля: где-то ошибка формата', 'bad');
      return;
    }
    if (data.hi < 0.8 || data.hi > 2.2) {
      this.toast('Высота тахеометра должна быть в пределах 0.8…2.2 м', 'bad');
      return;
    }
    g.applyStationData(data);
  };

  /* --------------------------------------------------------------- journal */
  UI.prototype.saveSettingsFromForm = function () {
    var s = this.game.settings;
    function num(id, def) { var el = document.getElementById(id); return el ? parseFloat(el.value) : def; }
    function chk(id) { var el = document.getElementById(id); return el ? !!el.checked : false; }
    this.game.saveSettings({
      sensitivity: num('set-sens', s.sensitivity),
      zoomSensitivity: num('set-zoomsens', s.zoomSensitivity),
      quality: parseFloat(document.getElementById('set-quality').value),
      sound: chk('set-sound'),
      shake: chk('set-shake'),
      showTips: chk('set-tips')
    });
    this.toast('Настройки сохранены', 'good');
  };

  UI.prototype.settingsBody = function () {
    var s = this.game.settings;
    return '<div class="settings-grid">' +
      '<div class="setting"><label>Чувствительность мыши <span id="lab-sens">' + s.sensitivity.toFixed(1) + '</span></label>' +
      '<input type="range" id="set-sens" min="0.3" max="2.5" step="0.1" value="' + s.sensitivity + '"></div>' +
      '<div class="setting"><label>Чувствительность зума</label>' +
      '<input type="range" id="set-zoomsens" min="0.5" max="2" step="0.1" value="' + s.zoomSensitivity + '"></div>' +
      '<div class="setting"><label>Качество графики</label>' +
      '<select id="set-quality"><option value="1"' + (s.quality === 1 ? ' selected' : '') + '>Высокое (полное разрешение)</option>' +
      '<option value="0.75"' + (s.quality === 0.75 ? ' selected' : '') + '>Среднее (0.75×)</option>' +
      '<option value="0.5"' + (s.quality === 0.5 ? ' selected' : '') + '>Низкое (0.5×)</option></select></div>' +
      '<div class="setting"><label>Звук</label><label class="switch"><input type="checkbox" id="set-sound"' + (s.sound ? ' checked' : '') + '> Щелчки и подтверждения</label></div>' +
      '<div class="setting"><label>Дрожание рук</label><label class="switch"><input type="checkbox" id="set-shake"' + (s.shake ? ' checked' : '') + '> Небольшое дрожание при большом зуме</label></div>' +
      '<div class="setting"><label>Подсказки</label><label class="switch"><input type="checkbox" id="set-tips"' + (s.showTips ? ' checked' : '') + '> Показывать обучающие подсказки</label></div>' +
      '</div>' +
      '<div class="callout warn" style="margin-top:18px"><b>Сброс прогресса.</b> Будут удалены лучшие результаты по уровням, сохранённые в браузере. Журнал текущего уровня останется до выхода.</div>' +
      '<div class="form-row"><button class="btn danger" data-act="reset-progress">Сбросить прогресс</button></div>' +
      '<div class="mini-note" style="margin-top:12px">Язык интерфейса: русский. Архитектура текстов вынесена в UI-слой и готова к локализации.</div>';
  };

  UI.prototype.syncSettingsForm = function () {
    var s = this.game.settings;
    var el = document.getElementById('set-sens');
    if (el) el.addEventListener('input', function () {
      var lab = document.getElementById('lab-sens');
      if (lab) lab.textContent = parseFloat(el.value).toFixed(1);
    });
  };

  UI.prototype.refreshStakeout = function () {
    if (this.modalOpen && this.menuTab === 'stakeout') this.openMenu('stakeout');
  };

  UI.prototype.openCustomLevel = function () {
    if (!this.customDraft) {
      this.customDraft = {
        title: 'Свободное задание',
        time: 20,
        tolXY: 3,
        tolZ: 2,
        stationX: 1008,
        stationY: 2042,
        freeMode: false,
        freeCount: 5,
        points: [
          { x: 1012, y: 2004, name: 'Точка 1' },
          { x: 1020, y: 2012, name: 'Точка 2' },
          { x: 1004, y: 2010, name: 'Точка 3' }
        ]
      };
    }
    this.renderCustomEditor();
  };

  UI.prototype.readCustomEditor = function () {
    var d = this.customDraft;
    if (!d) return;
    function num(id, def) { var el = document.getElementById(id); return el ? parseFloat(String(el.value).replace(',', '.')) : def; }
    function str(id, def) { var el = document.getElementById(id); return el ? el.value : def; }
    d.title = str('custom-title', d.title);
    d.time = num('custom-time', d.time);
    d.tolXY = num('custom-tolxy', d.tolXY);
    d.tolZ = num('custom-tolz', d.tolZ);
    d.stationX = num('custom-st-x', d.stationX);
    d.stationY = num('custom-st-y', d.stationY);
    var cf = document.getElementById('custom-free');
    d.freeMode = cf ? cf.checked : !!d.freeMode;
    d.freeCount = num('custom-free-count', d.freeCount || 5);
    var rows = document.querySelectorAll('[data-crow]');
    if (rows.length) {
      d.points = Array.prototype.map.call(rows, function (row) {
        var cx = row.querySelector('[data-cx]'), cy = row.querySelector('[data-cy]'), cn = row.querySelector('[data-cname]');
        return { x: parseFloat(cx.value), y: parseFloat(cy.value), name: cn.value };
      });
    }
  };

  UI.prototype.renderCustomEditor = function () {
    var d = this.customDraft;
    var rows = d.points.map(function (p, i) {
      return '<tr data-crow="' + i + '"><td>' + (i + 1) + '</td>' +
        '<td><input data-cx type="number" step="0.1" value="' + (isFinite(p.x) ? p.x : '') + '"></td>' +
        '<td><input data-cy type="number" step="0.1" value="' + (isFinite(p.y) ? p.y : '') + '"></td>' +
        '<td><input data-cname type="text" maxlength="40" value="' + esc(p.name || '') + '"></td>' +
        '<td><button class="del" data-act="custom-remove-point" data-index="' + i + '" title="Удалить точку">×</button></td></tr>';
    }).join('');
    var body = '<div class="field-grid">' +
      field('custom-title', 'Название задания', d.title || 'Свободное задание') +
      field('custom-time', 'Лимит, мин', String(d.time || 20)) +
      field('custom-tolxy', 'Допуск по плану, см', String(d.tolXY || 3)) +
      '</div><div class="field-grid" style="margin-top:10px">' +
      field('custom-tolz', 'Допуск по высоте, см', String(d.tolZ || 2)) +
      field('custom-st-x', 'X свободной станции', isFinite(d.stationX) ? d.stationX.toFixed(1) : '1000.0') +
      field('custom-st-y', 'Y свободной станции', isFinite(d.stationY) ? d.stationY.toFixed(1) : '2000.0') +
      '</div>' +
      '<div class="custom-free-row"><label class="switch"><input type="checkbox" id="custom-free"' + (d.freeMode ? ' checked' : '') + '> Свободная съёмка: студент сам выбирает точки</label>' +
      '<label class="custom-free-count">Снять точек: <input id="custom-free-count" type="number" min="1" max="30" step="1" value="' + (d.freeCount || 5) + '"></label></div>' +
      (d.freeMode
        ? '<div class="callout" style="margin-top:12px"><b>Свободный режим.</b> Преподаватель задаёт только станцию, время и количество точек. Студент берёт вешки из ящика, ставит их в любом месте и нажимает <b>T</b> — точка добавляется на месте вешки; имя можно изменить.</div>'
        : '<div class="result-section" style="margin-top:14px"><h4>ТОЧКИ ЗАДАНИЯ · ' + d.points.length + '</h4>' +
          '<div class="table-wrap"><table class="journal custom-table"><thead><tr><th>№</th><th>X, м</th><th>Y, м</th><th>Название точки</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<div class="form-row"><button class="btn small" data-act="custom-add-point">+ Добавить точку</button></div>' +
          '<div class="mini-note" style="margin-top:10px">Точки обязательные. На местности будут стоять три первые вешки, остальные — в ящике; точки подписаны на земле и на плане.</div></div>');
    this.openSheet({
      title: 'Свободная локация',
      sub: d.freeMode ? 'Свободная съёмка: станция, лимит и число точек' : 'Задание преподавателя: координаты, названия точек, станция и лимит времени',
      wide: true, body: body,
      foot: '<button class="btn ghost" data-act="close">Отмена</button><span class="spacer"></span>' +
        '<button class="btn primary" data-act="custom-start">Начать задание</button>',
      onMount: function () { var el = document.getElementById('custom-title'); if (el) el.focus(); }
    });
  };

  UI.prototype.startCustom = function () {
    this.readCustomEditor();
    var d = this.customDraft;
    if (!d || !d.title.trim()) { this.toast('Введите название задания', 'bad'); return; }
    if (!isFinite(d.stationX) || !isFinite(d.stationY)) { this.toast('Проверьте координаты станции', 'bad'); return; }
    if (!d.freeMode && (!d.points.length || d.points.some(function (p) { return !isFinite(p.x) || !isFinite(p.y); }))) {
      this.toast('У каждой точки должны быть числовые X и Y', 'bad'); return;
    }
    var base = this.game.levels.filter(function (l) { return l.id === 'level_06'; })[0] || this.game.levels[0];
    var controls = JSON.parse(JSON.stringify(base.controlPoints || [base.backsight]));
    var baseStations = JSON.parse(JSON.stringify(base.stations || [base.station]));
    var st = { id: 'CST', x: d.stationX, y: d.stationY, z: 100, known: true, note: 'Свободная станция' };
    var stations = [st].concat(baseStations.filter(function (s) { return s.id !== 'CST'; }));
    var points;
    if (d.freeMode) {
      points = [];
      for (var wi = 0; wi < 5; wi++) {
        points.push({
          id: 'W' + (wi + 1), name: 'Запасная вешка ' + (wi + 1),
          x: st.x + 1 + wi * 0.8, y: st.y + 1, z: 100, prismHeight: 1.5,
          kind: 'extra', required: false, freePole: true, note: 'Запасная вешка'
        });
      }
    } else {
      points = d.points.map(function (p, i) {
        return {
          id: 'C' + (i + 1), name: p.name || ('Точка ' + (i + 1)),
          x: p.x, y: p.y, z: 100, prismHeight: 1.5,
          kind: 'survey', required: true, note: p.name || ('Точка ' + (i + 1))
        };
      });
    }
    var lvl = {
      id: 'custom_' + Date.now(), order: 7, title: d.title,
      subtitle: d.freeMode ? 'Свободная съёмка' : 'Свободное задание',
      type: 'survey', difficulty: 'custom', custom: true,
      freeMode: !!d.freeMode, freeTargetCount: d.freeMode ? Math.max(1, Math.min(30, d.freeCount || 5)) : 0,
      briefing: d.freeMode
        ? 'Свободная съёмка: ' + d.title + '. Возьмите вешки из ящика, ставьте их в любом месте, добавляйте точки клавишей T и снимайте не менее ' + Math.max(1, Math.min(30, d.freeCount || 5)) + ' точек.'
        : 'Задание преподавателя: ' + d.title + '. Снимите ' + points.length + ' точек с указанной точностью.',
      goal: d.freeMode ? ('Снять ' + Math.max(1, Math.min(30, d.freeCount || 5)) + ' произвольных точек') : ('Снять ' + points.length + ' точек и уложиться в допуск'),
      station: st, stations: stations, instrumentHeight: 1.55,
      backsight: controls[0], controlPoints: controls, targets: points,
      designPoints: [], tolerance: { xy: (d.tolXY || 3) / 100, z: (d.tolZ || 2) / 100, orientationArcsec: 60 },
      timeLimitSec: Math.max(60, Math.round((d.time || 20) * 60)),
      errorModel: { angularSigmaArcsec: 2, distanceSigmaMm: 2, ppm: 2, centeringMm: 2, heightMm: 1, tiltEnabled: false },
      scene: { weather: 'clear', timeOfDay: 'day', fog: 0.05 },
      blockers: [],
      tutorial: [
        { id: 'walk', text: 'Подойдите к свободной станции CST и установите тахеометр.' },
        { id: 'level', text: 'Приведите тахеометр в горизонт тремя винтами.' },
        { id: 'data', text: 'Введите координаты станции и высоту тахеометра.' },
        { id: 'orient', text: 'Ориентируйтесь по видимому пункту привязки и проверьте остальные.' },
        { id: 'measure', text: d.freeMode ? 'Возьмите вешку из ящика, поставьте в любом месте и нажмите T; затем измерьте точку. Повторите.' : 'Снимите все точки задания. Три вешки на точке, остальные — в ящике.' },
        { id: 'finish', text: 'Проверьте журнал и завершите задание.' }
      ]
    };
    this.closeModal();
    this.game.startCustomLevel(lvl);
  };

  UI.prototype.openRenamePoint = function (id) {
    var g = this.game;
    var t = (g.level.targets || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var current = g.pointName(id);
    this.openSheet({
      title: 'Подписать точку',
      sub: 'Точка ' + id + ' · имя сохраняется в журнале и на плане',
      body: '<div class="field"><label for="point-name-input">Название точки</label>' +
        '<input id="point-name-input" type="text" maxlength="40" value="' + esc(current) + '"></div>' +
        '<div class="mini-note" style="margin-top:10px">Например: «Угол дома», «Ворота», «Опора ЛЭП». Это имя точки, а не вешки: оно останется на месте, даже если вешку унесут.</div>',
      foot: '<button class="btn ghost" data-act="close">Отмена</button><span class="spacer"></span>' +
        '<button class="btn primary" data-act="rename-point-save" data-id="' + esc(id) + '">Сохранить</button>',
      onMount: function () {
        var el = document.getElementById('point-name-input');
        if (el) {
          el.focus(); el.select();
          el.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              var save = document.querySelector('[data-act="rename-point-save"]');
              if (save) save.click();
            }
          });
        }
      }
    });
  };

  UI.prototype.openHeightEditor = function (id) {
    var g = this.game;
    var p = g.world && g.world.poles.get(id);
    if (!p || p.control) return;
    var name = g.poleName(id);
    var h = p.prismHeight;
    this.openSheet({
      title: 'Высота вехи',
      sub: name + ' · внутренний номер ' + id,
      body: '<div class="field"><label for="height-input">Фактическая высота вехи, м</label>' +
        '<input id="height-input" type="number" min="0.5" max="2.5" step="0.01" value="' + h.toFixed(2) + '"></div>' +
        '<div class="form-row" style="margin-top:10px">' +
        '<button class="btn small" data-act="height-step" data-delta="-0.05">−5 см</button>' +
        '<button class="btn small" data-act="height-step" data-delta="-0.01">−1 см</button>' +
        '<button class="btn small" data-act="height-step" data-delta="0.01">+1 см</button>' +
        '<button class="btn small" data-act="height-step" data-delta="0.05">+5 см</button>' +
        '</div>' +
        '<div class="mini-note" style="margin-top:12px">Фактическая высота и ввод в тахеометр синхронизируются: после сохранения веха станет выше/ниже, а прибор будет вычитать эту высоту. Клавиши <b>[</b> / <b>]</b> меняют высоту на 5 см без окна.</div>',
      foot: '<button class="btn ghost" data-act="close">Отмена</button><span class="spacer"></span>' +
        '<button class="btn primary" data-act="height-save" data-id="' + esc(id) + '">Сохранить</button>',
      onMount: function () {
        var el = document.getElementById('height-input');
        if (el) {
          el.focus(); el.select();
          el.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              var save = document.querySelector('[data-act="height-save"]');
              if (save) save.click();
            }
          });
        }
      }
    });
  };

  UI.prototype.openRename = function (id) {
    var g = this.game;
    if (!g.world || !g.world.poles.get(id)) return;
    var current = g.poleName(id);
    this.openSheet({
      title: 'Переименовать вешку',
      sub: 'Внутренний номер ' + id + ' остаётся для журнала и оценки',
      body: '<div class="field"><label for="rename-input">Название вешки</label>' +
        '<input id="rename-input" type="text" maxlength="20" value="' + esc(current) + '"></div>' +
        '<div class="mini-note" style="margin-top:10px">Например: «Угол дома», «Ворота», «Опора ЛЭП». Имя видно на вешке, в тахеометре и журнале.</div>',
      foot: '<button class="btn ghost" data-act="close">Отмена</button><span class="spacer"></span>' +
        '<button class="btn primary" data-act="rename-pole-save" data-id="' + esc(id) + '">Сохранить</button>',
      onMount: function () {
        var el = document.getElementById('rename-input');
        if (el) {
          el.focus(); el.select();
          el.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              var save = document.querySelector('[data-act="rename-pole-save"]');
              if (save) save.click();
            }
          });
        }
      }
    });
  };

  UI.prototype.openSettings = function () {
    var self = this;
    this.openSheet({
      title: 'Настройки', sub: 'Параметры симулятора сохраняются в браузере',
      body: this.settingsBody(),
      foot: '<button class="btn primary" data-act="save-settings">Сохранить</button><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>',
      wide: true,
      onMount: function () { self.syncSettingsForm(); }
    });
  };

  /* ----------------------------------------------------------------- help */
  UI.prototype.openHelp = function () {
    this.openSheet({
      title: 'Как играть', sub: 'Полевой цикл тахеометрической съёмки — от установки тахеометра до журнала',
      wide: true,
      body: '<div class="help-grid">' +
        '<div><h4>УПРАВЛЕНИЕ</h4>' +
        keyRow('Ходьба', 'W A S D') + keyRow('Осмотреться', 'Мышь') +
        keyRow('Взаимодействие', 'E') + keyRow('Меню тахеометра', 'Tab') +
        keyRow('Полевой журнал', 'J') + keyRow('Выход из окуляра', 'Esc / Q') +
        keyRow('Измерение', 'ЛКМ / Enter') + keyRow('Точное наведение', 'Стрелки') +
        keyRow('Зум', 'Колесо мыши') + keyRow('Фокус', 'Shift + колесо') +
        keyRow('Автофокус', 'F') + keyRow('Ориентировать', 'O') +
        keyRow('Высота вехи', '[ ] / H / меню «Съёмка»') + keyRow('Проверить пункт', 'C') + keyRow('Развернуть отражатель', 'R') +
        keyRow('Свободная точка', 'T (в свободной съёмке)') +
        keyRow('Взять / поставить вешку', 'E') + keyRow('Взять следующую из ящика', 'E / меню «Съёмка»') +
        keyRow('Подписать точку', 'Меню «Съёмка» → «Точка»') + keyRow('Переименовать вешку', 'Меню «Съёмка» → «Имя»') +
        keyRow('Сменить станцию', 'Меню «Станция»') + keyRow('План (миникарта)', 'M') +
        '</div><div><h4>ПОЛЕВОЙ ЦИКЛ</h4>' +
        '<ol style="padding-left:18px;margin:0;font-size:12px;line-height:1.7;color:#b9ccd1">' +
        '<li>Подойдите к точке <b>ST1</b> и нажмите <b>E</b>.</li>' +
        '<li>Установите штатив, затем тахеометр на трегер.</li>' +
        '<li>Приведите тахеометр в горизонт тремя подъёмными винтами: вращайте колёсики A, B, C (допуск 30″).</li>' +
        '<li>Введите координаты станции и высоту тахеометра. Координаты пунктов привязки уже известны.</li>' +
        '<li>Наведитесь на ближайший видимый пункт привязки, приблизьте зум и нажмите <b>O</b>; проверьте остальные <b>C</b>.</li>' +
        '<li>Измеряйте вешки: перекрестие в центре призмы, ЛКМ.</li>' +
        '<li>Вешку можно перенести: <b>E</b> рядом с ней, <b>E</b> — поставить, <b>R</b> — развернуть отражатель к тахеометру.</li>' +
        '<li>Высота вехи: <b>H</b> — окно ввода, <b>[</b> / <b>]</b> — ±5 см; работает и при переносе, и в окуляре.</li>' +
        '<li>Имя и высоту вешки меняйте в меню «Съёмка»; там же можно подписать точку, добавить практическую вешку и взять следующую из ящика.</li>' +
        '<li>В свободной съёмке поставьте вешку в любом месте и нажмите <b>T</b> — появится новая точка с именем.</li>' +
        '<li>Если участок не виден целиком, в меню «Станция» перенесите тахеометр на ST2…ST6.</li>' +
        '<li>Следите за высотой вехи и проверяйте журнал.</li>' +
        '<li>Завершите задание и разберите оценку.</li></ol>' +
        '<div class="callout" style="margin-top:12px"><b>Точность.</b> Углы выводятся до 1″, расстояния — до 1 мм. Ошибка наведения 20″ на 25 м даёт 2,4 мм; ошибка высоты вехи 10 см — 10 см по Z.</div>' +
        '</div>' +
        '<div><h4>ТАХЕОМЕТР</h4><div class="form-note">Тахеометр TA-5 на штативе с трегером и тремя подъёмными винтами; зум до 30×. В окуляре: сетка нитей, цифровые отсчёты HA/ZA/SD и индикатор захвата призмы. Координаты вычисляются по формулам:<br><br>' +
        '<span class="mono">HD = SD·sin(ZA); ΔH = SD·cos(ZA)<br>X = X₀ + HD·sin(HA)<br>Y = Y₀ + HD·cos(HA)<br>Z = Z₀ + hi + ΔH − hвехи</span></div></div>' +
        '<div><h4>ПРИВЯЗКА</h4><div class="form-note">На полигоне несколько геодезических пунктов — бетонные монолиты с жёлтой призмой (BS1–BS5 в большом выезде). По любому можно ориентироваться, по остальным — проверять привязку. Невязка покажет ошибку координат станции или наведения.</div>' +
        '<div class="mini-note" style="margin-top:12px">Симулятор учебный: он не заменяет работу с реальным тахеометром и не воспроизводит протоколы Leica/Sokkia/Topcon.</div></div>' +
        '</div>',
      foot: '<span class="mini-note">Все координаты и объекты — учебные.</span><span class="spacer"></span><button class="btn ghost" data-act="close">Закрыть</button>'
    });
  };

  /* -------------------------------------------------------------- results */
  UI.prototype.showResults = function (r) {
    this.currentResults = r;
    this.modalOpen = true;
    document.body.classList.add('modal-open');
    if (document.pointerLockElement) document.exitPointerLock();
    var gradeColor = r.total >= 75 ? 'var(--teal)' : (r.total >= 60 ? 'var(--amber)' : 'var(--red)');
    var recs = r.recommendations.map(function (x) {
      return '<li class="' + (x.warn ? 'warn' : '') + '">' + esc(x.text) + '</li>';
    }).join('');
    var pts = r.points.map(function (p) {
      var st = p.measured ? (p.hit ? '<span class="tag survey">в допуске</span>' : '<span class="tag control">вне допуска</span>') : '<span class="tag extra">пропуск</span>';
      return '<tr><td class="pid">' + esc(p.name || p.id) + '</td><td>' + kindRu(p.kind) + '</td><td>' + st + '</td>' +
        '<td>' + (p.measured ? p.errXY.toFixed(3) : '—') + '</td><td>' + (p.measured ? fmtSigned(p.errZ) : '—') + '</td>' +
        '<td>' + (p.measured ? p.x.toFixed(3) : '—') + '</td><td>' + (p.measured ? p.y.toFixed(3) : '—') + '</td><td>' + (p.measured ? p.z.toFixed(3) : '—') + '</td></tr>';
    }).join('');
    var controls = r.controls || [];
    var ctlRows = controls.map(function (c) {
      var ok = c.checked && Math.abs(c.residual) <= this.game.level.tolerance.orientationArcsec;
      var base = !c.checked && r.orientationFrom === c.id;
      var status = c.checked ? (ok ? '<span class="tag survey">в допуске</span>' : '<span class="tag control">вне допуска</span>')
        : (base ? '<span class="tag stakeout">база</span>' : '<span class="tag extra">не проверен</span>');
      return '<tr><td class="pid">' + esc(c.id) + '</td><td>' + c.x.toFixed(3) + '</td><td>' + c.y.toFixed(3) + '</td>' +
        '<td>' + (c.checked ? Math.abs(c.residual).toFixed(1) + '″' : '—') + '</td>' +
        '<td>' + status + '</td></tr>';
    }, this).join('');
    var html = '<div class="overlay"><div class="sheet wide"><div class="sheet-head"><div>' +
      '<div class="sheet-title">Результат полевого выезда</div>' +
      '<div class="sheet-sub">' + esc(this.game.level.title) + ' · ' + typeBadge(this.game.level) + '</div></div>' +
      '</div><div class="sheet-body">' +
      '<div class="result-hero"><div class="score-ring" style="--score:' + Math.round(r.total) + '"><div class="inner"><div class="val" style="color:' + gradeColor + '">' + Math.round(r.total) + '</div><div class="of">ИЗ 100</div></div></div>' +
      '<div><div class="result-title">' + esc(r.gradeText) + '</div>' +
      '<div class="result-grade" style="color:' + gradeColor + '">' + esc(r.grade) + ' · ' + (r.completed ? 'задание выполнено' : 'задание не завершено') + '</div>' +
      '<div class="result-stats">' +
      stat('ВРЕМЯ', fmtTime(r.timeSec)) + stat('ТОЧКИ', r.measured + ' / ' + r.required) +
      stat('СРЕДНЯЯ ОШИБКА', r.freeMode ? '—' : (r.measured ? r.meanXY.toFixed(3) + ' м' : '—')) +
      stat('МАКС. ОШИБКА', r.freeMode ? '—' : (r.measured ? r.maxXY.toFixed(3) + ' м' : '—')) +
      stat('ОРИЕНТИРОВАНИЕ', r.oriented ? (esc(r.orientationFrom || 'BS1') + ' · ' + Math.abs(r.orientationArcsec).toFixed(1) + '″') : 'нет') +
      stat('ПРИВЯЗКА', (r.checkedCount || 0) + ' / ' + controls.length) +
      stat('ТОЧНОСТЬ', r.freeMode ? '—' : (Math.round(r.accuracyScore) + ' / 100')) +
      stat('ПОЛНОТА', Math.round(r.completeness) + '%') +
      '</div></div></div>' +
      '<div class="result-section"><h4>РЕКОМЕНДАЦИИ</h4><ul class="rec-list">' + recs + '</ul></div>' +
      '<div class="result-section"><h4>ПУНКТЫ ПРИВЯЗКИ</h4><div class="table-wrap result-table"><table class="journal"><thead><tr><th>Пункт</th><th>X</th><th>Y</th><th>Невязка</th><th>Статус</th></tr></thead><tbody>' + ctlRows + '</tbody></table></div>' +
      '<div class="mini-note" style="margin-top:6px">Невязка — расхождение ориентирования по контрольному пункту. Для зачёта проверяются минимум два пункта.</div></div>' +
      '<div class="result-section"><h4>РАЗБОР ТОЧЕК</h4><div class="table-wrap result-table"><table class="journal"><thead><tr><th>Точка</th><th>Тип</th><th>Статус</th><th>ΔXY, м</th><th>ΔZ, м</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>' + pts + '</tbody></table></div></div>' +
      '<div class="result-section"><div class="mini-note">Оценка: точность 50% · полнота 28% · ориентирование 10% · время 7% · процедура 5%. Допуск по плану ' + (this.game.level.tolerance.xy * 100).toFixed(0) + ' см, по высоте ' + (this.game.level.tolerance.z * 100).toFixed(0) + ' см.</div></div>' +
      '</div><div class="sheet-foot">' +
      '<button class="btn" data-act="export-csv">Экспорт CSV</button>' +
      '<button class="btn ghost" data-act="restart">Пройти заново</button>' +
      '<span class="spacer"></span>' +
      (r.hasNext ? '<button class="btn primary" data-act="next-level">Следующий уровень</button>' : '') +
      '<button class="btn" data-act="title">В главное меню</button>' +
      '</div></div></div>';
    this.root.innerHTML = html;
    this.game.mode = 'results';
  };

  function field(id, label, value) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" inputmode="decimal" value="' + esc(value) + '"></div>';
  }
  function keyRow(k, v) {
    return '<div class="key-row"><span>' + k + '</span><kbd>' + v + '</kbd></div>';
  }
  function stat(label, value) {
    return '<div class="stat"><span>' + label + '</span><b>' + value + '</b></div>';
  }
  function fmtSigned(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(3);
  }
  function deltaClass(v, tol) {
    var a = Math.abs(v || 0);
    if (a <= tol) return 'delta-ok';
    if (a <= tol * 2) return 'delta-warn';
    return 'delta-bad';
  }

  GEO.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
