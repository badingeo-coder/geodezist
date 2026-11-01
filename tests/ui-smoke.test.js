'use strict';
/* Дымовой тест реального UI на заглушке DOM: проверяет, что все экраны строятся. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function makeElement(id) {
  const classes = new Set();
  const el = {
    id, style: {}, textContent: '', innerHTML: '', value: '1.50', dataset: {},
    children: [], offsetParent: null, width: 480, height: 480,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    getContext: () => ({
      clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, fillText() {}, strokeRect() {}, closePath() {}, save() {}, restore() {},
      setLineDash() {}, createLinearGradient: () => ({ addColorStop() {} })
    }),
    addEventListener() {}, appendChild(child) { this.children.push(child); },
    get firstChild() { return this.children[0] || null; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); },
    remove() {}, querySelector: () => null,
    requestPointerLock() { return Promise.resolve(); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
  };
  return el;
}

const elements = new Map();
global.window = globalThis;
global.document = {
  body: Object.assign(makeElement('body'), { appendChild() {} }),
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
  exitPointerLock() {}, pointerLockElement: null
};
global.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); }
};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 1;

require(path.join(__dirname, '..', 'js', '01_gl.js'));
const GEO = globalThis.GEO;
GEO.GL.Renderer = function FakeRenderer() {
  this.gl = {};
  this.resize = () => {}; this.beginFrame = () => {}; this.draw = () => {};
  this.setBlend = () => {}; this.setDepthTest = () => {}; this.setDepthWrite = () => {};
  this.upload = (m) => ({ data: m.data, count: m.count });
  this.freeMesh = () => {};
};
require(path.join(__dirname, '..', 'js', '02_survey_math.js'));
require(path.join(__dirname, '..', 'js', '03_error_model.js'));
require(path.join(__dirname, '..', 'js', '04_measurement.js'));
require(path.join(__dirname, '..', 'js', '05_scene.js'));
require(path.join(__dirname, '..', 'js', 'levels.data.js'));
require(path.join(__dirname, '..', 'js', '06_ui.js'));
require(path.join(__dirname, '..', 'js', '07_game.js'));

function pointAim(game, id) {
  const p = game.currentTarget(id);
  const ta = game.session.engine.trueAngles(p);
  game.session.aim.az = ta.ha;
  game.session.aim.za = ta.za;
}

test('UI: главный экран, меню тахеометра, журнал и результаты строятся без ошибок', () => {
  const game = new GEO.Game();
  assert.equal(game.mode, 'title');
  assert.ok(game.ui.root.innerHTML.indexOf('ГЕОДЕЗИСТ') >= 0, 'титульный экран отрисован');

  game.startLevel('level_01');
  assert.equal(game.mode, 'walk');
  assert.ok(game.ui.root.innerHTML === '', 'титульный экран закрыт');
  assert.ok(game.ui.labels.size >= 2, 'метки вешек созданы');

  game.player.x = 0; game.player.z = 2.2;
  game.interact();
  assert.equal(game.levelingActive, false);
  assert.ok(game.ui.root.innerHTML.indexOf('СБОРКА ТАХЕОМЕТРА') >= 0, 'экран сборки');
  game.setupTripod();
  game.mountInstrument();
  assert.equal(game.levelingActive, true);
  assert.ok(game.ui.root.innerHTML.indexOf('Горизонтирование') >= 0, 'экран выставления уровня');
  game.acceptLeveling(true);
  assert.ok(game.ui.root.innerHTML.indexOf('Исходные данные') >= 0, 'экран ввода данных');
  game.applyStationData({ x: 1000, y: 2000, z: 100, hi: 1.55 });
  assert.equal(game.mode, 'scope');

  pointAim(game, 'BS1');
  game.updateCapture();
  game.orientCurrent();
  assert.equal(game.session.setup.oriented, true);

  game.ui.openMenu('project');
  assert.ok(game.ui.root.innerHTML.indexOf('Задание') >= 0);
  game.ui.openMenu('station');
  assert.ok(game.ui.root.innerHTML.indexOf('ОРИЕНТИРОВАНИЕ') >= 0);
  game.ui.openMenu('survey');
  assert.ok(game.ui.root.innerHTML.indexOf('ВЕШКИ') >= 0);
  game.ui.openMenu('stakeout');
  assert.ok(game.ui.root.innerHTML.indexOf('вынос') >= 0 || game.ui.root.innerHTML.indexOf('Вынос') >= 0);
  game.ui.openMenu('settings');
  assert.ok(game.ui.root.innerHTML.indexOf('Чувствительность') >= 0);
  game.ui.openHelp();
  assert.ok(game.ui.root.innerHTML.indexOf('УПРАВЛЕНИЕ') >= 0);
  game.ui.closeModal();

  pointAim(game, 'P1');
  game.updateCapture();
  game.measureCurrent();
  assert.equal(game.session.journal.length, 1);
  game.ui.openJournal();
  assert.ok(game.ui.root.innerHTML.indexOf('Полевой журнал') >= 0);
  assert.ok(game.ui.root.innerHTML.indexOf('P1') >= 0);
  game.ui.closeModal();

  game.finishLevel();
  assert.equal(game.mode, 'results');
  assert.ok(game.ui.root.innerHTML.indexOf('Результат полевого выезда') >= 0);
  assert.ok(game.ui.root.innerHTML.indexOf('РЕКОМЕНДАЦИИ') >= 0);
});

test('UI: вынос в натуру показывает разности и команды', () => {
  const game = new GEO.Game();
  game.startLevel('level_04');
  Object.assign(game.session.errors.config, { angularSigmaArcsec: 0, distanceSigmaMm: 0, ppm: 0 });
  game.player.x = 0; game.player.z = 2.2;
  game.interact();
  game.setupTripod();
  game.mountInstrument();
  game.acceptLeveling(true);
  game.applyStationData({ x: 1000, y: 2000, z: 100, hi: 1.55 });
  pointAim(game, 'BS1'); game.updateCapture(); game.orientCurrent();
  game.selectDesign('D1');
  game.ui.openMenu('stakeout');
  assert.ok(game.ui.root.innerHTML.indexOf('D1') >= 0);
  game.ui.closeModal();
  pointAim(game, 'D1'); game.updateCapture(); game.measureCurrent();
  assert.ok(game.session.stakeout.measurement, 'вешка измерена');
  game.ui.openMenu('stakeout');
  assert.ok(game.ui.root.innerHTML.indexOf('ΔX') >= 0, 'разности отрисованы');
  assert.ok(game.ui.root.innerHTML.indexOf('Север') >= 0, 'команды отрисованы');
  game.nudgePole('E', 0.1);
  game.ui.openMenu('stakeout');
  assert.ok(game.ui.root.innerHTML.indexOf('ΔX') >= 0);
  game.fixStakeout();
  assert.equal(game.isTargetDone('D1'), true);
});
