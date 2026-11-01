/**
 * SurveyMath — независимый модуль геодезических расчётов.
 * Модуль не зависит от DOM/WebGL и покрыт тестами (tests/survey-math.test.js).
 *
 * Соглашения (как в формулах ТЗ):
 *  - Координаты: X — восток, Y — север, Z — вверх (местная система).
 *  - Горизонтальный угол HA — азимут по часовой стрелке от направления на север.
 *  - ZA — зенитный угол (0° в зените, 90° — горизонт).
 *  - VA — вертикальный угол (90° − ZA).
 *  - X = Xст + HD·sin(HA), Y = Yст + HD·cos(HA).
 *  - Внутренние вычисления — double, в радианах.
 */
(function (root) {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var ARCSEC = Math.PI / 180 / 3600; // радиан в одной угловой секунде
  var TWO_PI = Math.PI * 2;

  function normAz(a) {
    a = a % TWO_PI;
    if (a < 0) a += TWO_PI;
    if (a >= TWO_PI) a -= TWO_PI;
    return a;
  }

  function normDeg(d) {
    d = d % 360;
    if (d < 0) d += 360;
    return d;
  }

  /** Азимут направления по приращениям координат (dx — восток, dy — север). */
  function azimuth(dx, dy) {
    return normAz(Math.atan2(dx, dy));
  }

  function distance2D(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  function distance3D(dx, dy, dz) {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function horizontalDistance(sd, za) {
    return sd * Math.sin(za);
  }

  function heightDifference(sd, za) {
    return sd * Math.cos(za);
  }

  function zenithToVertical(za) {
    return Math.PI / 2 - za;
  }

  function verticalToZenith(va) {
    return Math.PI / 2 - va;
  }

  /**
   * Полярная развёртка: углы + наклонная дальность -> координаты точки.
   * X = Xст + HD·sin(HA); Y = Yст + HD·cos(HA);
   * Z = Zст + hi + ΔH − hвехи.
   */
  function polarToCartesian(o) {
    var za = o.za;
    var sd = o.sd;
    var hd = sd * Math.sin(za);
    var dh = sd * Math.cos(za);
    var ha = o.ha;
    return {
      x: o.stationX + hd * Math.sin(ha),
      y: o.stationY + hd * Math.cos(ha),
      z: o.stationZ + o.instrumentHeight + dh - (o.targetHeight || 0),
      hd: hd,
      dh: dh
    };
  }

  /**
   * Обратная задача: координаты точки -> HA, ZA, SD от станции.
   * Точка задана координатами земли, высота призмы учитывается.
   */
  function cartesianToPolar(o) {
    var dx = o.x - o.stationX; // восток
    var dy = o.y - o.stationY; // север
    var dz = (o.z + (o.targetHeight || 0)) - (o.stationZ + (o.instrumentHeight || 0));
    var sd = distance3D(dx, dy, dz);
    var ha = azimuth(dx, dy);
    var za = sd > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dz / sd))) : Math.PI / 2;
    return { ha: ha, za: za, sd: sd };
  }

  /** Ориентирование по задней точке: отсчёт по горизонтальному кругу -> азимут. */
  function orientationFromBacksight(station, bs, haReading) {
    var az = azimuth(bs.x - station.x, bs.y - station.y);
    return normAz(az - haReading);
  }

  function angleDiff(a, b) {
    var d = (a - b) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
  }

  function arcsec(rad) {
    return rad / ARCSEC;
  }

  function fromArcsec(sec) {
    return sec * ARCSEC;
  }

  /** Округление до заданного числа знаков (для отображения). */
  function roundTo(value, digits) {
    var k = Math.pow(10, digits);
    return Math.round(value * k) / k;
  }

  /** Формат угла: 123°45'06" (округление до 1″ с переносом). */
  function formatAngle(rad, opts) {
    opts = opts || {};
    var total = normDeg(rad * R2D) * 3600;
    var rounded = Math.round(total);
    if (rounded >= 360 * 3600) rounded = 0; // 359°59'59.6" -> 0°00'00"
    var deg = Math.floor(rounded / 3600);
    var min = Math.floor((rounded - deg * 3600) / 60);
    var sec = rounded - deg * 3600 - min * 60;
    if (opts.padDeg) deg = String(deg).padStart(3, '0');
    return deg + '°' + String(min).padStart(2, '0') + "'" + String(sec).padStart(2, '0') + '"';
  }

  function formatDms(deg, opts) {
    return formatAngle(normDeg(deg) * D2R, opts);
  }

  /** Формат знакового угла (для вертикальных углов): -0°02'41" */
  function formatSignedAngle(rad, opts) {
    var deg = rad * R2D;
    var sign = deg < -1e-9 ? '-' : '';
    return sign + formatAngle(Math.abs(deg) * D2R, opts);
  }

  /** Формат малого угла в угловых секундах: 12.4″ */
  function formatArcsec(rad, digits) {
    return (rad / ARCSEC).toFixed(digits == null ? 1 : digits) + '″';
  }

  function formatDistance(m, digits) {
    return (m).toFixed(digits == null ? 3 : digits);
  }

  /** Разбор угла: "123.4567" (градусы) или "123 45 06.5" / "123°45'06"". */
  function parseAngle(text) {
    if (text == null) return NaN;
    var s = String(text).trim().replace(',', '.');
    if (!s) return NaN;
    var dms = s.match(/^(-?\d+(?:\.\d+)?)[\s°d:]+(\d+(?:\.\d+)?)['\s:]+(\d+(?:\.\d+)?)"?$/);
    if (dms) {
      var sign = dms[1].trim().charAt(0) === '-' ? -1 : 1;
      var d = Math.abs(parseFloat(dms[1]));
      var m = parseFloat(dms[2]);
      var sec = parseFloat(dms[3]);
      if (m >= 60 || sec >= 60) return NaN;
      return sign * (d + m / 60 + sec / 3600) * D2R;
    }
    var deg = parseFloat(s);
    return isFinite(deg) ? deg * D2R : NaN;
  }

  /** Среднее круговых величин (для серии измерений). */
  function circularMean(angles) {
    var sx = 0, sy = 0;
    for (var i = 0; i < angles.length; i++) {
      sx += Math.cos(angles[i]);
      sy += Math.sin(angles[i]);
    }
    return normAz(Math.atan2(sy, sx));
  }

  var SurveyMath = {
    D2R: D2R,
    R2D: R2D,
    ARCSEC: ARCSEC,
    TWO_PI: TWO_PI,
    normAz: normAz,
    normDeg: normDeg,
    azimuth: azimuth,
    distance2D: distance2D,
    distance3D: distance3D,
    horizontalDistance: horizontalDistance,
    heightDifference: heightDifference,
    zenithToVertical: zenithToVertical,
    verticalToZenith: verticalToZenith,
    polarToCartesian: polarToCartesian,
    cartesianToPolar: cartesianToPolar,
    orientationFromBacksight: orientationFromBacksight,
    angleDiff: angleDiff,
    arcsec: arcsec,
    fromArcsec: fromArcsec,
    roundTo: roundTo,
    formatAngle: formatAngle,
    formatDms: formatDms,
    formatSignedAngle: formatSignedAngle,
    formatArcsec: formatArcsec,
    formatDistance: formatDistance,
    parseAngle: parseAngle,
    circularMean: circularMean
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SurveyMath;
  root.SurveyMath = SurveyMath;
  root.GEO = root.GEO || {};
  root.GEO.SurveyMath = SurveyMath;
})(typeof window !== 'undefined' ? window : globalThis);
