'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SM = require(path.join(__dirname, '..', 'js', '02_survey_math.js'));
const { ErrorModel } = require(path.join(__dirname, '..', 'js', '03_error_model.js'));
const { MeasurementEngine } = require(path.join(__dirname, '..', 'js', '04_measurement.js'));

const ARCSEC = SM.ARCSEC;
const D2R = SM.D2R;

function close(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
}

function makeLevel(extra) {
  return Object.assign({
    id: 't',
    station: { x: 1000, y: 2000, z: 100 },
    instrumentHeight: 1.55,
    backsight: { id: 'BS1', x: 1024, y: 1995, z: 100, prismHeight: 1.5 },
    errorModel: { angularSigmaArcsec: 0, distanceSigmaMm: 0, ppm: 0, centeringMm: 0, heightMm: 0, tiltEnabled: false }
  }, extra || {});
}

function makeSetup(level) {
  return {
    stationInput: { x: level.station.x, y: level.station.y, z: level.station.z },
    instrumentHeightInput: level.instrumentHeight,
    trueInstrumentHeight: level.instrumentHeight,
    centering: { east: 0, north: 0 },
    tilt: { xArcsec: 0, yArcsec: 0 },
    oriented: false
  };
}

function aimAt(engine, target) {
  const a = engine.trueAngles(target);
  return { az: a.ha, za: a.za };
}

test('полярная развёртка: направление на восток', () => {
  const r = SM.polarToCartesian({
    stationX: 1000, stationY: 2000, stationZ: 100,
    instrumentHeight: 1.55, ha: 90 * D2R, za: 90 * D2R, sd: 10, targetHeight: 1.5
  });
  close(r.x, 1010, 1e-9, 'x');
  close(r.y, 2000, 1e-9, 'y');
  close(r.z, 100.05, 1e-9, 'z');
  close(r.hd, 10, 1e-9, 'hd');
});

test('полярная развёртка: наклонное расстояние', () => {
  const r = SM.polarToCartesian({
    stationX: 0, stationY: 0, stationZ: 0,
    instrumentHeight: 0, ha: 0, za: 45 * D2R, sd: 10 * Math.SQRT2, targetHeight: 0
  });
  close(r.hd, 10, 1e-9, 'hd');
  close(r.dh, 10, 1e-9, 'dh');
  close(r.y, 10, 1e-9, 'y');
  close(r.x, 0, 1e-9, 'x');
});

test('обратная и прямая задача согласованы', () => {
  const target = { x: 1012.5, y: 2004.2, z: 100.04 };
  const p = SM.cartesianToPolar({
    x: target.x, y: target.y, z: target.z,
    stationX: 1000, stationY: 2000, stationZ: 100,
    instrumentHeight: 1.55, targetHeight: 1.5
  });
  const back = SM.polarToCartesian({
    stationX: 1000, stationY: 2000, stationZ: 100,
    instrumentHeight: 1.55, ha: p.ha, za: p.za, sd: p.sd, targetHeight: 1.5
  });
  close(back.x, target.x, 1e-9, 'x');
  close(back.y, target.y, 1e-9, 'y');
  close(back.z, target.z, 1e-9, 'z');
});

test('формат углов: градусы-минуты-секунды', () => {
  assert.equal(SM.formatAngle(90 * D2R), '90°00\'00"');
  assert.equal(SM.formatAngle(123.456789 * D2R), '123°27\'24"');
  assert.equal(SM.formatAngle(359.9999999 * D2R), '0°00\'00"');
  assert.equal(SM.formatAngle(0, { padDeg: true }), '000°00\'00"');
});

test('разбор углов', () => {
  close(SM.parseAngle('90'), 90 * D2R, 1e-12, 'decimal degrees');
  close(SM.parseAngle('123 45 06'), (123 + 45 / 60 + 6 / 3600) * D2R, 1e-12, 'dms');
  close(SM.parseAngle('123°45\'06"'), (123 + 45 / 60 + 6 / 3600) * D2R, 1e-12, 'dms symbols');
  assert.ok(Number.isNaN(SM.parseAngle('123 75 00')));
});

test('ориентирование: идеальные условия дают точные координаты', () => {
  const level = makeLevel();
  level.targets = [{ id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 }];
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  const res = engine.orient(level.backsight, bsAim.ha);
  assert.ok(Math.abs(res.errorArcsec) < 1e-6);
  assert.ok(setup.oriented);

  const target = level.targets[0];
  const aim = aimAt(engine, target);
  const m = engine.measure(target, aim, { prismHeight: 1.5 });
  assert.ok(!m.error, m.error);
  close(m.x, target.x, 1e-9, 'x');
  close(m.y, target.y, 1e-9, 'y');
  close(m.z, target.z, 1e-9, 'z');
  close(m.errorXY, 0, 1e-9);
});

test('ошибка наведения на заднюю точку разворачивает измерения', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  const pointing = 20 * ARCSEC; // 20″ вправо
  engine.orient(level.backsight, bsAim.ha + pointing);
  assert.ok(Math.abs(setup.orientationErrorArcsec + 20) < 0.1, 'orientation error ' + setup.orientationErrorArcsec);

  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const aim = aimAt(engine, target);
  const m = engine.measure(target, aim, { prismHeight: 1.5 });
  const hd = Math.hypot(target.x - 1000, target.y - 2000);
  close(m.errorXY, hd * Math.sin(20 * ARCSEC), 0.0005, 'xy error');
});

test('неверные координаты задней точки дают ошибку ориентирования', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  const wrongBs = { x: 1024, y: 1996, z: 100, prismHeight: 1.5 };
  engine.orient(wrongBs, bsAim.ha);
  assert.ok(Math.abs(setup.orientationErrorArcsec) > 60, 'должна быть заметная ошибка');
});

test('ошибки высоты тахеометра уходят в Z', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  setup.instrumentHeightInput = 1.45;   // ввели меньше фактической на 10 см
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  engine.orient(level.backsight, bsAim.ha);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const m = engine.measure(target, aimAt(engine, target), { prismHeight: 1.5 });
  close(m.errorVec.dz, -0.10, 1e-9, 'z error из-за высоты тахеометра');
});

test('ошибка высоты вехи уходит в Z', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  engine.orient(level.backsight, bsAim.ha);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const m = engine.measure(target, aimAt(engine, target), { prismHeight: 1.4 });
  close(m.errorVec.dz, 0.10, 1e-9, 'z error из-за высоты вехи');
});

test('захват цели по угловому размеру призмы', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  engine.orient(level.backsight, engine.trueAngles(level.backsight).ha);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const aim = aimAt(engine, target);
  assert.equal(engine.capture(target, aim).hit, true);
  const shifted = { az: aim.az, za: aim.za + 0.02 }; // 0.02 рад ≈ 4126″
  assert.equal(engine.capture(target, shifted).hit, false);
});

test('отражатель должен быть развёрнут к тахеометру', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  engine.orient(level.backsight, engine.trueAngles(level.backsight).ha);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const toInstrument = SM.azimuth(1000 - target.x, 2000 - target.y);
  target.prismAz = toInstrument;
  const aim = aimAt(engine, target);
  const cap = engine.capture(target, aim);
  assert.equal(cap.facing, true);
  assert.equal(cap.hit, true);
  const m = engine.measure(target, aim, { prismHeight: 1.5 });
  assert.ok(!m.error, m.error);

  target.prismAz = SM.normAz(toInstrument + Math.PI);
  const cap2 = engine.capture(target, aim);
  assert.equal(cap2.facing, false);
  assert.equal(cap2.hit, false);
  const m2 = engine.measure(target, aim, { prismHeight: 1.5 });
  assert.equal(m2.error, 'PRISM_NOT_FACING');
});

test('нет видимости — измерение отклоняется', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup, null, () => false);
  engine.orient(level.backsight, engine.trueAngles(level.backsight).ha);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const m = engine.measure(target, engine.trueAngles(target), { prismHeight: 1.5 });
  assert.equal(m.error, 'NO_VISIBILITY');
});

test('до ориентирования измерения запрещены', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const target = { id: 'P1', x: 1012, y: 2004.5, z: 100.04, prismHeight: 1.5 };
  const m = engine.measure(target, engine.trueAngles(target), { prismHeight: 1.5 });
  assert.equal(m.error, 'NOT_ORIENTED');
});

test('контроль по задней точке показывает остаточное расхождение', () => {
  const level = makeLevel();
  const setup = makeSetup(level);
  const engine = new MeasurementEngine(level, setup);
  const bsAim = engine.trueAngles(level.backsight);
  engine.orient(level.backsight, bsAim.ha + 15 * ARCSEC);
  const check = engine.checkBacksight(level.backsight, aimAt(engine, level.backsight));
  assert.ok(Math.abs(check.residualArcsec - 15) < 0.1, 'остаточное расхождение ' + check.residualArcsec);
  const check2 = engine.checkBacksight(level.backsight, { az: bsAim.ha + 15 * ARCSEC, za: bsAim.za });
  assert.ok(Math.abs(check2.residualArcsec) < 1e-6, 'при том же наведении расхождение нулевое');
});

test('ErrorModel: нулевые сигмы не дают шума', () => {
  const em = new ErrorModel({});
  assert.equal(em.sampleAngle(), 0);
  assert.equal(em.sampleDistance(30), 0);
  assert.deepEqual(em.sampleCentering(), { east: 0, north: 0, value: 0 });
});

test('ErrorModel: воспроизводимый генератор', () => {
  const a = new ErrorModel({ angularSigmaArcsec: 2 }, 42);
  const b = new ErrorModel({ angularSigmaArcsec: 2 }, 42);
  for (let i = 0; i < 5; i++) assert.equal(a.sampleAngle(), b.sampleAngle());
});
