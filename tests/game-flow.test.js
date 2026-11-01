'use strict';
/* Интеграционный прогон игрового цикла без браузера: DOM и UI заменены заглушками. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function makeElement(id) {
  const classes = new Set();
  return {
    id,
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    textContent: '',
    innerHTML: '',
    value: '1.5',
    dataset: {},
    children: [],
    offsetParent: null,
    getContext: () => ({ clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, strokeRect() {}, closePath() {} }),
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    remove() {},
    querySelector: () => null,
    requestPointerLock() { return Promise.resolve(); }
  };
}

const elements = new Map();
global.window = globalThis;
global.document = {
  body: {
    classList: makeElement('body').classList,
    appendChild() {},
    removeChild() {}
  },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  exitPointerLock() {},
  pointerLockElement: null
};
global.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); }
};
global.requestAnimationFrame = function () { return 0; };
global.cancelAnimationFrame = function () {};
global.addEventListener = function () {};
global.removeEventListener = function () {};
global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 1;

require(path.join(__dirname, '..', 'js', '01_gl.js'));
const GEO = globalThis.GEO;
GEO.GL.Renderer = function FakeRenderer() {
  this.gl = {};
  this.resize = () => {};
  this.beginFrame = () => {};
  this.draw = () => {};
  this.setBlend = () => {};
  this.setDepthTest = () => {};
  this.setDepthWrite = () => {};
  this.upload = (m) => ({ data: m.data, count: m.count });
  this.freeMesh = () => {};
};
require(path.join(__dirname, '..', 'js', '02_survey_math.js'));
require(path.join(__dirname, '..', 'js', '03_error_model.js'));
require(path.join(__dirname, '..', 'js', '04_measurement.js'));
require(path.join(__dirname, '..', 'js', '05_scene.js'));
require(path.join(__dirname, '..', 'js', 'levels.data.js'));

function FakeUI(game) {
  this.game = game;
  this.modalOpen = false;
  this.menuTab = 'project';
  this.setupStep = 0;
  this.root = makeElement('modal-root');
  this.calls = [];
}
FakeUI.prototype.log = function (name, arg) { this.calls.push([name, arg]); };
['showTitle', 'showGameHud', 'rebuildLabels', 'updateLabels', 'setScope', 'updateHud',
  'updateMission', 'openSetup', 'openMenu', 'openJournal', 'openSettings', 'openHelp',
  'toast', 'setLockHint', 'prompt', 'setTargetBadge', 'updateLeveling', 'drawMinimap',
  'refreshStakeout', 'openHeightEditor'].forEach(function (name) {
  FakeUI.prototype[name] = function (arg) { this.log(name, arg); };
});
FakeUI.prototype.closeModal = function () {
  this.modalOpen = false;
  this.log('closeModal');
  if (this.game.onModalClosed) this.game.onModalClosed();
};
FakeUI.prototype.showResults = function (r) {
  this.modalOpen = true;
  this.lastResults = r;
  this.log('showResults', r);
};
GEO.UI = FakeUI;

require(path.join(__dirname, '..', 'js', '07_game.js'));

function pointAim(game, id) {
  const p = game.currentTarget(id);
  const ta = game.session.engine.trueAngles(p);
  game.session.aim.az = ta.ha;
  game.session.aim.za = ta.za;
}

function prepare(game, levelId) {
  game.startLevel(levelId);
  Object.assign(game.session.errors.config, {
    angularSigmaArcsec: 0, distanceSigmaMm: 0, ppm: 0, centeringMm: 0, heightMm: 0
  });
  game.player.x = 0;
  game.player.z = 2.2;
  game.interact();
  game.setupTripod();
  game.mountInstrument();
  assert.equal(game.levelingActive, true, 'должен открыться шаг выставления уровня');
  game.acceptLeveling(true);
  assert.equal(game.session.setup.leveled, true);
  game.applyStationData({
    x: 1000, y: 2000, z: 100, hi: 1.55
  });
  assert.equal(game.session.setup.dataEntered, true);
  assert.ok(game.session.engine, 'движок измерений должен быть создан');
  pointAim(game, 'BS1');
  game.updateCapture();
  assert.equal(game.captured.id, 'BS1');
  assert.equal(game.captured.hit, true);
  game.orientCurrent();
  assert.equal(game.session.setup.oriented, true);
  const err = Math.abs(game.session.setup.orientationErrorArcsec);
  assert.ok(err < 0.01, 'идеальное наведение даёт нулевую ошибку, получено ' + err);
}

test('полный цикл обучения: установка → ориентирование → измерение → оценка', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  pointAim(game, 'P1');
  game.updateCapture();
  assert.equal(game.captured.id, 'P1');
  game.measureCurrent();
  assert.equal(game.session.journal.length, 1);
  const row = game.session.journal[0];
  const p1 = game.level.targets.filter((t) => t.id === 'P1')[0];
  assert.ok(Math.abs(row.x - 1012) < 1e-6, 'X ' + row.x);
  assert.ok(Math.abs(row.y - 2004.5) < 1e-6, 'Y ' + row.y);
  assert.ok(Math.abs(row.z - p1.z) < 1e-6, 'Z ' + row.z + ' vs ' + p1.z);
  assert.equal(game.isTargetDone('P1'), true);

  const csv = game.buildCSV();
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'CSV с BOM для Excel');
  assert.ok(csv.indexOf('P1') >= 0, 'точка в CSV');
  assert.ok(csv.indexOf('HA') >= 0, 'заголовки CSV');
  assert.ok(csv.indexOf('1012.000') >= 0, 'координата X в CSV');

  // повторный замер создаёт вторую запись, но не дублирует прогресс
  game.measureCurrent();
  assert.equal(game.session.journal.length, 2);
  assert.equal(game.getLatestRow('P1').pointId, 'P1');

  game.finishLevel();
  assert.equal(game.mode, 'results');
  const r = game.lastResults;
  assert.equal(r.required, 1);
  assert.equal(r.measured, 1);
  assert.equal(r.completed, true);
  assert.ok(r.total >= 95, 'итог ' + r.total);
  assert.ok(r.total <= 95.01, 'автоуровень ограничивает итог 95 баллами');
  assert.equal(game.ui.lastResults, r);
});

test('вынос в натуру: смещение вешки командами и фиксация', () => {
  const game = new GEO.Game();
  prepare(game, 'level_04');
  game.selectDesign('D1');
  pointAim(game, 'D1');
  game.updateCapture();
  assert.equal(game.captured.id, 'D1');
  game.measureCurrent();
  assert.ok(game.session.stakeout.measurement, 'первое измерение вешки');
  const d0 = game.stakeoutDelta();
  assert.ok(Math.abs(d0.dx - 0.9) < 1e-6, 'ΔX ' + d0.dx);
  assert.ok(Math.abs(d0.dy + 0.9) < 1e-6, 'ΔY ' + d0.dy);

  for (let i = 0; i < 9; i++) game.nudgePole('E', 0.1);
  for (let i = 0; i < 9; i++) game.nudgePole('S', 0.1);
  const d1 = game.stakeoutDelta();
  assert.ok(d1.xy < 0.15, 'после команд ошибка ' + d1.xy);

  game.fixStakeout();
  const row = game.getLatestRow('D1');
  assert.ok(row, 'запись выноса в журнале');
  assert.equal(row.kind, 'stakeout');
  assert.equal(game.isTargetDone('D1'), true);
  const errXY = Math.hypot(row.x - 1016, row.y - 2006);
  assert.ok(errXY < 0.15, 'точность фиксации ' + errXY);
});

test('ошибка ориентирования сдвигает координаты', () => {
  const game = new GEO.Game();
  game.startLevel('level_02');
  Object.assign(game.session.errors.config, {
    angularSigmaArcsec: 0, distanceSigmaMm: 0, ppm: 0, centeringMm: 0, heightMm: 0
  });
  game.player.x = 0; game.player.z = 2.2;
  game.interact();
  game.setupTripod();
  game.mountInstrument();
  game.acceptLeveling(true);
  game.applyStationData({ x: 1000, y: 2000, z: 100, hi: 1.55 });
  const cap = game.session.engine.trueAngles(game.currentTarget('BS1'));
  game.session.aim.az = cap.ha + 30 * GEO.SurveyMath.ARCSEC; // 30″ правее
  game.session.aim.za = cap.za;
  game.updateCapture();
  assert.equal(game.captured.hit, true);
  game.orientCurrent();
  assert.ok(Math.abs(game.session.setup.orientationErrorArcsec + 30) < 0.1,
    'ошибка ' + game.session.setup.orientationErrorArcsec);

  pointAim(game, 'P1');
  game.updateCapture();
  game.measureCurrent();
  const row = game.getLatestRow('P1');
  const hd = Math.hypot(1012 - 1000, 2004.5 - 2000);
  const expected = hd * Math.sin(30 * GEO.SurveyMath.ARCSEC);
  assert.ok(Math.abs(Math.hypot(row.x - 1012, row.y - 2004.5) - expected) < 0.002,
    'смещение ' + Math.hypot(row.x - 1012, row.y - 2004.5) + ' вместо ' + expected);
});

test('удаление записи и повторное измерение восстанавливают прогресс', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  pointAim(game, 'P1');
  game.updateCapture();
  game.measureCurrent();
  const id = game.session.journal[0].id;
  game.deleteJournalRow(id);
  assert.equal(game.isTargetDone('P1'), false);
  game.measureCurrent();
  assert.equal(game.isTargetDone('P1'), true);
});

test('три пункта привязки: ориентирование и контроль по двум', () => {
  const game = new GEO.Game();
  prepare(game, 'level_02');
  assert.equal(game.controls.length, 3);
  assert.deepEqual(game.controls.map((c) => c.id), ['BS1', 'BS2', 'BS3']);

  for (const id of ['BS2', 'BS3']) {
    pointAim(game, id);
    game.updateCapture();
    assert.equal(game.captured.id, id, 'наведение на ' + id);
    assert.equal(game.captured.hit, true);
    game.checkCurrent();
  }
  assert.equal(Object.keys(game.session.setup.checkResiduals).length, 2);
  assert.equal(game.session.checkDone, true);
  assert.ok(Math.abs(game.session.setup.checkResiduals.BS2) < 0.1);
  assert.ok(Math.abs(game.session.setup.checkResiduals.BS3) < 0.1);

  game.finishLevel();
  const r = game.lastResults;
  assert.equal(r.checkedCount, 2);
  assert.equal(r.controls.length, 3);
  assert.equal(r.orientationFrom, 'BS1');
  assert.ok(r.maxCheck < 0.1, 'maxCheck ' + r.maxCheck);
  assert.equal(r.controls.filter((c) => c.checked).length, 2);
});

test('вешку можно перенести и развернуть отражатель к тахеометру', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  game.exitScope();
  const before = game.world.poles.get('P1');
  const startX = before.x, startY = before.y;
  const w = game.world.poleWorld('P1');
  game.player.x = w.x;
  game.player.z = w.z + 1.0;
  game.interact();
  assert.equal(game.session.carrying, 'P1');

  game.player.x = w.x + 3;
  game.player.z = w.z;
  game.player.yaw = 0;
  game.interact();
  assert.equal(game.session.carrying, null);
  const p = game.world.poles.get('P1');
  assert.ok(Math.hypot(p.x - startX, p.y - startY) > 1, 'вешка перенесена');
  assert.equal(game.isPrismFacing('P1'), false, 'после переноса призма смотрит не на тахеометр');

  game.enterScope();
  pointAim(game, 'P1');
  game.updateCapture();
  assert.equal(game.captured.id, 'P1');
  assert.equal(game.captured.facing, false);
  const count = game.session.journal.length;
  game.measureCurrent();
  assert.equal(game.session.journal.length, count, 'без разворота призмы измерение невозможно');

  game.facePrism('P1');
  game.updateCapture();
  assert.equal(game.captured.facing, true);
  assert.equal(game.captured.hit, true);
  game.measureCurrent();
  assert.equal(game.session.journal.length, count + 1);
});

test('вешку можно переименовать, изменить высоту и добавить/убрать', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  const before = game.targets.filter((t) => t.kind !== 'control').length;

  assert.equal(game.renamePole('P1', 'Угол дома'), true);
  assert.equal(game.poleName('P1'), 'Угол дома');

  game.setPoleHeight('P1', 1.72);
  assert.ok(Math.abs(game.world.poles.get('P1').prismHeight - 1.72) < 1e-9);
  assert.ok(Math.abs(game.session.prismHeightInput - 1.72) < 1e-9);

  const added = game.addPracticePole();
  assert.ok(added && added.practice, 'добавлена практическая вешка');
  assert.equal(game.targets.filter((t) => t.kind !== 'control').length, before + 1);
  assert.ok(game.world.poles.get(added.id), 'вешка есть в сцене');

  game.removeLastPracticePole();
  assert.equal(game.world.poles.get(added.id), undefined);
  assert.equal(game.targets.filter((t) => t.kind !== 'control').length, before);
});

test('рельеф задаёт высоты точек, а не плоскую плоскость', () => {
  const game = new GEO.Game();
  game.startLevel('level_03');
  const t = game.level.targets.filter((x) => x.id === 'P1')[0];
  const h = GEO.terrainHeightSurvey(t.x, t.y);
  assert.ok(Math.abs(t.z - (100 + h)) < 1e-9, 'Z точки равен высоте рельефа');
  assert.ok(h > 0.2, 'в точке есть заметный рельеф: ' + h);
  const zs = game.level.targets.map((x) => x.z);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 0.5, 'высоты точек различаются');
});

test('вешку можно поставить вплотную к углу здания', () => {
  const game = new GEO.Game();
  game.startLevel('level_01');
  game.player.x = 8.15;
  game.player.z = -8.0;
  game.player.yaw = Math.PI / 2; // на восток, к юго-западному углу дома
  const pose = game.placementPose();
  assert.ok(Math.hypot(pose.wx - 9, pose.wz + 8) < 0.16,
    'вешка у угла, а не отодвинута на полметра: ' + JSON.stringify(pose));
});

test('станцию можно перенести на ST2 и снова выставить тахеометр', () => {
  const game = new GEO.Game();
  prepare(game, 'level_03');
  const oldZ = game.session.setup.trueStation.z;
  game.moveToStation('ST2');
  assert.equal(game.mode, 'walk');
  assert.equal(game.session.setup.trueStation.id, 'ST2');
  assert.equal(game.session.setup.tripodPlaced, false);
  assert.equal(game.session.setup.dataEntered, false);
  assert.ok(Math.abs(game.world.instrumentSurvey.x - 1034) < 1e-9);
  assert.ok(Math.abs(game.player.x - 34) < 1e-9);

  game.setupTripod();
  game.mountInstrument();
  game.acceptLeveling(true);
  const st = game.stationById('ST2');
  game.applyStationData({ x: st.x, y: st.y, z: st.z, hi: game.level.instrumentHeight });
  assert.equal(game.mode, 'scope');
  assert.equal(game.session.engine.telescopePoint().x, st.x);
  assert.ok(Math.abs(st.z - oldZ) > 0.001, 'у станций разная высота рельефа');
});

test('к другой станции можно подойти и нажать E', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  game.exitScope();
  game.player.x = 34;
  game.player.z = -13.8;
  game.interact();
  assert.equal(game.session.setup.trueStation.id, 'ST2');
  assert.equal(game.ui.setupStep, 0);
  assert.equal(game.world.topVisible, false);
});

test('высоту вехи можно изменить клавишами и через H', () => {
  const game = new GEO.Game();
  prepare(game, 'level_01');
  pointAim(game, 'P1');
  game.updateCapture();
  assert.equal(game.currentHeightPole(), 'P1');
  const before = game.world.poles.get('P1').prismHeight;
  game.adjustPoleHeight(0.05);
  assert.ok(Math.abs(game.world.poles.get('P1').prismHeight - (before + 0.05)) < 1e-9);
  assert.ok(Math.abs(game.session.prismHeightInput - (before + 0.05)) < 1e-9);
  game.openHeightEditor();
  assert.ok(game.ui.calls.some((c) => c[0] === 'openHeightEditor' && c[1] === 'P1'));
  game.ui.calls.length = 0;
  game.onKeyDown({ code: 'KeyH', preventDefault: function () {} });
  assert.ok(game.ui.calls.some((c) => c[0] === 'openHeightEditor' && c[1] === 'P1'), 'клавиша H открывает окно');

  game.exitScope();
  const w = game.world.poleWorld('P1');
  game.player.x = w.x;
  game.player.z = w.z + 1.0;
  game.interact();
  assert.equal(game.session.carrying, 'P1');
  game.adjustPoleHeight(-0.05);
  assert.ok(Math.abs(game.world.poles.get('P1').prismHeight - 1.5) < 1e-9);
  assert.equal(game.currentHeightPole(), 'P1');
});

test('большой полигон: три активные вешки, ящик и линия хода', () => {
  const game = new GEO.Game();
  game.startLevel('level_06');
  assert.equal(game.stations.length, 6);
  assert.equal(game.controls.length, 5);
  assert.equal(game.world.zones.length, 4);
  assert.equal(game.world.paths.length, 5);
  assert.deepEqual(game.world.boxPoles.slice().sort(), ['P4', 'P5', 'P6']);
  assert.equal(!!game.world.poles.get('P1').stored, false, 'P1 стоит на точке');
  assert.equal(game.world.poles.get('P4').stored, true, 'P4 в ящике');

  assert.equal(game.world.isVisible(1000, 2000, 968, 2065), false, 'P1 закрыта от ST1');
  assert.equal(game.world.isVisible(1005, 2048, 968, 2065), true, 'P1 видна с ST4');
  assert.equal(game.world.isVisible(1000, 2000, 1072, 1952), false, 'P2 закрыта от ST1');
  assert.equal(game.world.isVisible(1052, 1975, 1072, 1952), true, 'P2 видна с ST5');

  const links = game.traverseLinks();
  assert.equal(links.length, 6);
  assert.ok(links.some((l) => l.station.id === 'ST4' && l.visible), 'линия хода ST4 видна');
});

test('запасную вешку можно взять из ящика', () => {
  const game = new GEO.Game();
  game.startLevel('level_06');
  game.player.x = 7.0;
  game.player.z = 2.0;
  game.player.yaw = 0;
  game.interact();
  assert.ok(['P4', 'P5', 'P6'].includes(game.session.carrying));
  assert.equal(game.world.poles.get(game.session.carrying).stored, false);
  game.interact();
  assert.equal(game.session.carrying, null);
});

test('на большом уровне три активные вешки, остальные в ящике', () => {
  const game = new GEO.Game();
  game.startLevel('level_03');
  const required = game.level.targets.filter((t) => t.required);
  const active = required.filter((t) => { const p = game.world.poles.get(t.id); return p && !p.stored; });
  const stored = required.filter((t) => { const p = game.world.poles.get(t.id); return p && p.stored; });
  assert.equal(required.length, 12);
  assert.equal(active.length, 3);
  assert.equal(stored.length, 9);
  assert.equal(game.world.boxPoles.length >= 9, true);
});

test('вешку можно взять из ящика через меню и поставить', () => {
  const game = new GEO.Game();
  game.startLevel('level_06');
  game.takePoleFromBox('P4');
  assert.equal(game.session.carrying, 'P4');
  assert.equal(!!game.world.poles.get('P4').stored, false);
  game.player.x = 7;
  game.player.z = 2;
  game.interact();
  assert.equal(game.session.carrying, null);
});

test('точку можно подписать, а вешку — взять по порядку', () => {
  const game = new GEO.Game();
  game.startLevel('level_03');
  assert.equal(game.renamePoint('P4', 'Ворота'), true);
  assert.equal(game.pointName('P4'), 'Ворота');
  assert.equal(game.poleName('P4'), 'P4', 'имя вешки не изменилось');
  assert.equal(game.world.boxPoles[0], 'P4');

  game.player.x = game.world.boxSurvey.x - 1000;
  game.player.z = -(game.world.boxSurvey.y - 2000);
  game.interact();
  assert.equal(game.session.carrying, 'P4');
  assert.equal(game.world.boxPoles[0], 'P5', 'следующая вешка — P5');
});

test('вешка точно притягивается к своей точке задания', () => {
  const game = new GEO.Game();
  game.startLevel('level_01');
  const t = game.level.targets.filter((x) => x.id === 'P1')[0];
  game.session.carrying = 'P1';
  game.player.x = t.x - 1000;
  game.player.z = -(t.y - 2000) + 0.9;
  game.player.yaw = 0;
  const pose = game.placementPose();
  assert.equal(pose.snapId, 'P1');
  assert.ok(Math.abs(pose.x - t.x) < 1e-9);
  assert.ok(Math.abs(pose.y - t.y) < 1e-9);
});

test('свободное задание преподавателя запускается', () => {
  const game = new GEO.Game();
  const base = game.levels.filter((l) => l.id === 'level_06')[0];
  const controls = JSON.parse(JSON.stringify(base.controlPoints));
  const st = { id: 'CST', x: 1005, y: 2005, z: 100, known: true, note: 'Свободная' };
  game.startCustomLevel({
    custom: true, title: 'Тестовое задание', order: 7,
    station: st, stations: [st].concat(JSON.parse(JSON.stringify(base.stations))),
    instrumentHeight: 1.55, backsight: controls[0], controlPoints: controls,
    targets: [{ id: 'C1', name: 'Моя точка', x: 1010, y: 2010, z: 100, prismHeight: 1.5, kind: 'survey', required: true, note: 'Моя точка' }],
    designPoints: [], tolerance: { xy: 0.03, z: 0.02, orientationArcsec: 60 },
    timeLimitSec: 1200,
    errorModel: { angularSigmaArcsec: 2, distanceSigmaMm: 2, ppm: 2, centeringMm: 2, heightMm: 1, tiltEnabled: false },
    scene: { weather: 'clear', timeOfDay: 'day', fog: 0.05 }, blockers: [],
    tutorial: [{ id: 'walk', text: 'test' }]
  });
  assert.equal(game.mode, 'walk');
  assert.equal(game.session.setup.trueStation.id, 'CST');
  assert.equal(game.level.targets[0].name, 'Моя точка');
  assert.ok(game.world.boxSurvey.x > 1005);
});

test('свободная съёмка: студент добавляет точку на месте вешки', () => {
  const game = new GEO.Game();
  const base = game.levels.filter((l) => l.id === 'level_06')[0];
  const controls = JSON.parse(JSON.stringify(base.controlPoints));
  const st = { id: 'CST', x: 1000, y: 2000, z: 100, known: true };
  game.startCustomLevel({
    custom: true, freeMode: true, freeTargetCount: 2, title: 'Свободная', order: 7,
    station: st, stations: [st].concat(JSON.parse(JSON.stringify(base.stations))),
    instrumentHeight: 1.55, backsight: controls[0], controlPoints: controls,
    targets: [{ id: 'W1', name: 'Запасная', x: 1002, y: 2001, z: 100, prismHeight: 1.5, kind: 'extra', required: false, freePole: true }],
    designPoints: [], tolerance: { xy: 0.03, z: 0.02, orientationArcsec: 60 },
    timeLimitSec: 600,
    errorModel: { angularSigmaArcsec: 0, distanceSigmaMm: 0, ppm: 0, centeringMm: 0, heightMm: 0, tiltEnabled: false },
    scene: { weather: 'clear', timeOfDay: 'day', fog: 0 }, blockers: [],
    tutorial: [{ id: 'measure', text: 'T' }]
  });
  game.player.x = game.world.boxSurvey.x - 1000;
  game.player.z = -(game.world.boxSurvey.y - 2000);
  game.takeNextFromBox();
  assert.equal(game.session.carrying, 'W1');
  game.interact();
  const t = game.addFreePoint();
  assert.ok(t && t.free);
  assert.equal(game.currentTarget(t.id).poleId, 'W1');
  assert.equal(game.pointName(t.id), 'Точка 1');
});

test('P10 «Край площадки» виден вне бетонной площадки и стоит в очереди после P9', () => {
  const game = new GEO.Game();
  game.startLevel('level_03');
  const p10 = game.level.targets.filter((t) => t.id === 'P10')[0];
  assert.ok(p10, 'P10 существует');
  assert.ok(p10.x < 994 || p10.y > 2005, 'P10 вынесен за бетонную площадку 12×10 м');
  const box = game.world.boxPoles;
  assert.equal(box.indexOf('P10'), box.indexOf('P9') + 1);
  assert.equal(box.indexOf('P11'), box.indexOf('P10') + 1);
  assert.equal(box.indexOf('P12'), box.indexOf('P11') + 1);
  assert.equal(box.length, 9, 'в ящике только 9 обязательных вешек, без P13/P14');
});

test('три подъёмных винта меняют наклон', () => {  const game = new GEO.Game();
  game.startLevel('level_01');
  game.player.x = 0;
  game.player.z = 2.2;
  game.interact();
  game.setupTripod();
  game.mountInstrument();
  const before = { x: game.session.setup.tilt.xArcsec, y: game.session.setup.tilt.yArcsec };
  game.setScrew(0, 0.9);
  const after = game.session.setup.tilt;
  assert.ok(Math.abs(after.xArcsec - before.x) > 10 || Math.abs(after.yArcsec - before.y) > 10,
    'винт A наклоняет тахеометр');
  game.setScrew(0, 0);
  assert.ok(Math.abs(game.session.setup.tilt.xArcsec - before.x) < 1e-6);
});
