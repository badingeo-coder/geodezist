/**
 * ErrorModel — геодезически объяснимая модель погрешностей.
 * Все ошибки задаются в единицах, принятых в полевой практике:
 *  - углы: угловые секунды (″);
 *  - расстояния: миллиметры + ppm (мм/км);
 *  - центрирование и высоты: миллиметры.
 */
(function (root) {
  'use strict';

  var SurveyMath = root.SurveyMath || (typeof require !== 'undefined' ? require('./02_survey_math.js') : null);

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function ErrorModel(config, seed) {
    this.config = Object.assign({
      angularSigmaArcsec: 0,
      distanceSigmaMm: 0,
      ppm: 0,
      centeringMm: 0,
      heightMm: 0,
      prismConstantMm: 0,
      tiltEnabled: false
    }, config || {});
    this.rng = typeof seed === 'number' ? mulberry32(seed) : Math.random;
  }

  ErrorModel.prototype.setSeed = function (seed) {
    this.rng = mulberry32(seed);
  };

  ErrorModel.prototype.gaussian = function () {
    return gaussian(this.rng);
  };

  /** Случайная угловая погрешность, радианы. */
  ErrorModel.prototype.sampleAngle = function () {
    var sigma = this.config.angularSigmaArcsec;
    if (!sigma) return 0;
    return this.gaussian() * sigma * SurveyMath.ARCSEC;
  };

  /** Случайная линейная погрешность дальности, метры. */
  ErrorModel.prototype.sampleDistance = function (distanceM) {
    var mm = this.config.distanceSigmaMm || 0;
    var ppm = this.config.ppm || 0;
    if (!mm && !ppm) return 0;
    var sigmaM = (mm + (ppm * distanceM) / 1000) / 1000;
    return this.gaussian() * sigmaM;
  };

  /** Ошибка центрирования тахеометра, метры (смещение по осям). */
  ErrorModel.prototype.sampleCentering = function () {
    var mm = this.config.centeringMm || 0;
    if (!mm) return { east: 0, north: 0, value: 0 };
    var east = this.gaussian() * mm / 1000;
    var north = this.gaussian() * mm / 1000;
    return { east: east, north: north, value: Math.hypot(east, north) };
  };

  /** Случайная ошибка высоты тахеометра, метры. */
  ErrorModel.prototype.sampleHeight = function () {
    var mm = this.config.heightMm || 0;
    if (!mm) return 0;
    return this.gaussian() * mm / 1000;
  };

  /** Влияние остаточного наклона оси, радианы. */
  ErrorModel.prototype.tiltEffect = function (tilt, zen, ha) {
    if (!this.config.tiltEnabled || !tilt) return { ha: 0, za: 0 };
    var tX = (tilt.xArcsec || 0) * SurveyMath.ARCSEC;
    var tY = (tilt.yArcsec || 0) * SurveyMath.ARCSEC;
    // Упрощённая, но объяснимая модель: наклон по оси X даёт ошибку
    // горизонтального направления, наклон по оси Y — ошибку зенитного угла.
    var k = 0.5 + 0.5 * Math.abs(Math.cos(zen));
    return {
      ha: tX * k * (1 + 0.15 * Math.sin(ha)),
      za: tY * 0.5 * Math.sin(zen)
    };
  };

  function seeded(seed) {
    return new ErrorModel({}, seed);
  }

  var api = { ErrorModel: ErrorModel, mulberry32: mulberry32, gaussian: gaussian, seeded: seeded };
  root.ErrorModel = ErrorModel;
  root.GeoRandom = api;
  root.GEO = root.GEO || {};
  root.GEO.ErrorModel = ErrorModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
