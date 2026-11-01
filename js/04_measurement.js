/**
 * MeasurementEngine — вычисление отсчётов и координат.
 * Отделён от UI и 3D: получает на вход состояние установки тахеометра,
 * истинное положение цели и текущее наведение, возвращает отсчёты.
 */
(function (root) {
  'use strict';

  var SM = root.SurveyMath || (typeof require !== 'undefined' ? require('./02_survey_math.js') : null);
  var ErrorModel = root.ErrorModel || (typeof require !== 'undefined' ? require('./03_error_model.js').ErrorModel : null);

  var PRISM_RADIUS_M = 0.07; // половина ширины призмы, м
  var PRISM_ACCEPTANCE = 35 * Math.PI / 180; // допустимый разворот отражателя

  function normAz(a) { return SM.normAz(a); }

  function aimAngles(aim) {
    return {
      az: aim.az != null ? aim.az : aim.ha,
      za: aim.za
    };
  }

  /**
   * @param {Object} level  JSON уровня
   * @param {Object} setup  состояние установки (см. GameSession)
   * @param {ErrorModel} errors
   * @param {Function} visibility  (x1,z1,x2,z2) -> bool, необязательно
   */
  function MeasurementEngine(level, setup, errors, visibility) {
    this.level = level;
    this.setup = setup;
    this.errors = errors || new ErrorModel(level.errorModel || {});
    this.visibility = visibility || null;
    this.telescope = null;
  }

  /**
   * Истинное положение оси вращения трубы в координатах съёмки.
   * Учитывает центрирование и фактическую высоту тахеометра.
   */
  MeasurementEngine.prototype.telescopePoint = function () {
    var st = this.setup.trueStation || this.level.station;
    var s = this.setup;
    var north = s.centering ? s.centering.north : 0;
    var east = s.centering ? s.centering.east : 0;
    var hi = s.trueInstrumentHeight != null ? s.trueInstrumentHeight : this.level.instrumentHeight;
    return {
      x: st.x + north,
      y: st.y + east,
      z: st.z + hi
    };
  };

  /** Положение центра призмы цели (истинное). */
  MeasurementEngine.prototype.prismPoint = function (target) {
    var ph = target.truePrismHeight != null ? target.truePrismHeight : target.prismHeight;
    return { x: target.x, y: target.y, z: target.z + ph };
  };

  /** Истинные HA/ZA/SD на цель. */
  MeasurementEngine.prototype.trueAngles = function (target) {
    var t = this.telescopePoint();
    var p = this.prismPoint(target);
    var dx = p.x - t.x;
    var dy = p.y - t.y;
    var dz = p.z - t.z;
    var sd = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return {
      ha: SM.azimuth(dx, dy),
      za: sd > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dz / sd))) : Math.PI / 2,
      sd: sd,
      dx: dx,
      dy: dy,
      dz: dz
    };
  };

  /** Проверка видимости цели (здания/сооружения). */
  MeasurementEngine.prototype.hasVisibility = function (target) {
    if (!this.visibility) return true;
    var t = this.telescopePoint();
    var p = this.prismPoint(target);
    return this.visibility(t.x, t.y, p.x, p.y);
  };

  /**
   * Захват цели: попадает ли перекрестие в угловой размер призмы.
   * Возвращает угловое смещение от центра призмы (рад).
   */
  MeasurementEngine.prototype.capture = function (target, aim) {
    aim = aimAngles(aim);
    var ta = this.trueAngles(target);
    var dHa = SM.angleDiff(ta.ha, aim.az);
    var dZa = ta.za - aim.za;
    // расстояние в касательной плоскости
    var off = Math.hypot(dHa * Math.sin(ta.za), dZa);
    var radius = Math.atan(PRISM_RADIUS_M / Math.max(0.5, ta.sd));
    // отражатель должен быть развёрнут приёмным окном к тахеометру
    var facing = true;
    var facingOff = 0;
    if (target.prismAz != null) {
      var t = this.telescopePoint();
      var toInstrument = SM.azimuth(t.x - target.x, t.y - target.y);
      facingOff = SM.angleDiff(target.prismAz, toInstrument);
      facing = Math.abs(facingOff) <= PRISM_ACCEPTANCE;
    }
    return {
      hit: off <= radius * 1.05 && facing,
      off: off,
      radius: radius,
      dHa: dHa,
      dZa: dZa,
      sd: ta.sd,
      facing: facing,
      facingOff: facingOff,
      visible: this.hasVisibility(target)
    };
  };

  /** Отсчёт горизонтального угла, соответствующий текущему наведению. */
  MeasurementEngine.prototype.haReading = function (aimAz) {
    var orient = this.setup.orientation || 0;
    return normAz(aimAz + orient);
  };

  /**
   * Ориентирование по задней точке.
   * @param {Object} bs  координаты задней точки из задания
   * @param {number} aimAz  фактический азимут наведения (мировой)
   */
  MeasurementEngine.prototype.orient = function (bs, aimAz) {
    var st = this.setup.stationInput;
    var azAssumed = SM.azimuth(bs.x - st.x, bs.y - st.y);
    var noise = this.errors.sampleAngle();
    var orientation = normAz(azAssumed - aimAz + noise);
    this.setup.orientation = orientation;

    // Оценка ошибки ориентирования относительно «идеального» значения
    var trueAz = this.trueAngles({ x: bs.x, y: bs.y, z: bs.z, prismHeight: bs.prismHeight }).ha;
    var ideal = normAz(azAssumed - trueAz);
    var err = SM.angleDiff(orientation, ideal);
    this.setup.orientationErrorArcsec = SM.arcsec(err);
    this.setup.oriented = true;
    return {
      orientation: orientation,
      azAssumed: azAssumed,
      errorArcsec: SM.arcsec(err)
    };
  };

  /** Контроль ориентирования: повторное наведение на BS. */
  MeasurementEngine.prototype.checkBacksight = function (bs, aim) {
    aim = aimAngles(aim);
    var st = this.setup.stationInput;
    var azAssumed = SM.azimuth(bs.x - st.x, bs.y - st.y);
    var ta = this.trueAngles({ x: bs.x, y: bs.y, z: bs.z, prismHeight: bs.prismHeight });
    var dHa = SM.angleDiff(ta.ha, aim.az);
    var off = Math.abs(dHa);
    var has = this.capture({ x: bs.x, y: bs.y, z: bs.z, prismHeight: bs.prismHeight }, aim);
    var residual = SM.angleDiff(azAssumed, this.haReading(aim.az));
    return {
      residual: SM.arcsec(residual),
      residualArcsec: SM.arcsec(residual),
      pointingArcsec: SM.arcsec(off),
      captured: has.hit
    };
  };

  /**
   * Измерение цели.
   * @param {Object} target  координаты и высота призмы
   * @param {Object} aim     {az, za} текущее наведение
   * @param {Object} opts    {prismHeight, allowOffTarget, tracking}
   * @returns {Object} результат измерения
   */
  MeasurementEngine.prototype.measure = function (target, aim, opts) {
    opts = opts || {};
    aim = aimAngles(aim);
    if (!this.setup.oriented && !opts.allowUnoriented) {
      return { error: 'NOT_ORIENTED' };
    }
    var cap = this.capture(target, aim);
    if (!cap.visible) return { error: 'NO_VISIBILITY', capture: cap };
    if (!cap.facing) return { error: 'PRISM_NOT_FACING', capture: cap };
    if (!cap.hit && !opts.allowOffTarget && !opts.tracking) {
      return { error: 'NO_TARGET', capture: cap };
    }

    var ta = this.trueAngles(target);
    var tilt = this.setup.tilt || { xArcsec: 0, yArcsec: 0 };
    var tiltEff = this.errors.tiltEffect(tilt, aim.za, ta.ha);

    // В режиме слежения шум не накапливается: тахеометр «ведёт» призму.
    var noiseHa = opts.tracking ? 0 : this.errors.sampleAngle();
    var noiseZa = opts.tracking ? 0 : this.errors.sampleAngle();
    var noiseSd = opts.tracking ? 0 : this.errors.sampleDistance(ta.sd);

    // Отсчёты тахеометра формируются из фактического наведения + погрешностей
    var haMeas = normAz(aim.az + (this.setup.orientation || 0) + noiseHa + tiltEff.ha);
    var zaMeas = aim.za + noiseZa + tiltEff.za;
    var sdMeas = ta.sd + noiseSd;

    var prismHeightInput = opts.prismHeight != null ? opts.prismHeight : target.prismHeight;
    var stationInput = this.setup.stationInput;
    var hiInput = this.setup.instrumentHeightInput != null ? this.setup.instrumentHeightInput : this.level.instrumentHeight;

    var coords = SM.polarToCartesian({
      stationX: stationInput.x,
      stationY: stationInput.y,
      stationZ: stationInput.z,
      instrumentHeight: hiInput,
      ha: haMeas,
      za: zaMeas,
      sd: sdMeas,
      targetHeight: prismHeightInput
    });

    // Истинные координаты точки (для оценки)
    var trueCoords = { x: target.x, y: target.y, z: target.z };
    var eX = coords.x - trueCoords.x;
    var eY = coords.y - trueCoords.y;
    var eZ = coords.z - trueCoords.z;

    return {
      targetId: target.id,
      ha: haMeas,
      za: zaMeas,
      sd: sdMeas,
      hd: coords.hd,
      dh: coords.dh,
      x: coords.x,
      y: coords.y,
      z: coords.z,
      prismHeight: prismHeightInput,
      true: trueCoords,
      errorVec: { dx: eX, dy: eY, dz: eZ },
      errorXY: Math.hypot(eX, eY),
      errorZ: Math.abs(eZ),
      capture: cap,
      orientationErrorArcsec: this.setup.orientationErrorArcsec || 0
    };
  };

  var api = { MeasurementEngine: MeasurementEngine, PRISM_RADIUS_M: PRISM_RADIUS_M, PRISM_ACCEPTANCE: PRISM_ACCEPTANCE };
  root.MeasurementEngine = MeasurementEngine;
  root.GeoMeasure = api;
  root.GEO = root.GEO || {};
  root.GEO.MeasurementEngine = MeasurementEngine;
  root.GEO.PRISM_RADIUS_M = PRISM_RADIUS_M;
  root.GEO.PRISM_ACCEPTANCE = PRISM_ACCEPTANCE;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
