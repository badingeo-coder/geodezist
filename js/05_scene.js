/**
 * 05_scene.js — учебный полигон «Заречье».
 * Сцена процедурная: никаких внешних моделей и текстур.
 *
 * Системы координат:
 *  - съёмочная: X — восток, Y — север, Z — вверх;
 *  - мир: x = X − 1000 (восток), y = Z − 100 (вверх), z = −(Y − 2000) (север = −z).
 */
(function (root) {
  'use strict';
  var GEO = root.GEO = root.GEO || {};
  var M4 = GEO.GL.M4;
  var MeshBuilder = GEO.GL.MeshBuilder;

  var STATION = { x: 1000, y: 2000, z: 100 };
  var ORIGIN_X = STATION.x;
  var ORIGIN_Y = STATION.y;
  var GROUND_Z = STATION.z;

  function toWorld(x, y, z) {
    return { x: x - ORIGIN_X, y: (z == null ? GROUND_Z : z) - GROUND_Z, z: -(y - ORIGIN_Y) };
  }
  function toSurvey(wx, wz) {
    return { x: wx + ORIGIN_X, y: -wz + ORIGIN_Y };
  }

  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /**
   * Рельеф большого полигона: всхолмления, луг, лес и овраг.
   * Вокруг станции площадка плоская (r < 6 м), дальше рельеф «включается».
   */
  function terrainHWorld(wx, wz) {
    var u = wx, v = -wz;
    var r = Math.hypot(u, v);
    var k = smoothstep(6, 16, r);
    var h = 0.62 * Math.sin(u * 0.058 + 0.8) * Math.cos(v * 0.047 - 0.4)
      + 0.30 * Math.sin((u + v) * 0.093 + 1.2)
      + 0.13 * Math.cos(u * 0.21) * Math.sin(v * 0.18)
      + 1.15 * Math.exp(-(((u - 38) * (u - 38) + (v + 26) * (v + 26)) / 720))
      + 0.75 * Math.exp(-(((u + 31) * (u + 31) + (v - 24) * (v - 24)) / 560))
      // овраг на юго-западе: вытянутая ложбина с заметными бровками
      - 3.3 * Math.exp(-(((u + 62) * (u + 62)) / 180 + ((v + 28) * (v + 28)) / 430))
      // пологий всхолмлённый луг на севере
      + 0.55 * Math.exp(-(((u - 42) * (u - 42) + (v + 58) * (v + 58)) / 1100));
    return h * k;
  }

  function terrainHSurvey(x, y) {
    return terrainHWorld(x - ORIGIN_X, -(y - ORIGIN_Y));
  }

  var rand = (function () {
    var s = 1234567;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  })();

  function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
  function norm3(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  // --------------------------------------------------------------- env
  function environment(scene) {
    scene = scene || {};
    var cloudy = scene.weather === 'cloudy';
    var evening = scene.timeOfDay === 'evening';
    var fog = scene.fog == null ? 0.08 : scene.fog;
    var zenith, horizon, sun, ambient;
    if (evening) {
      zenith = [0.16, 0.2, 0.34];
      horizon = [0.92, 0.52, 0.3];
      sun = [1.0, 0.55, 0.28];
      ambient = [0.34, 0.32, 0.38];
    } else if (cloudy) {
      zenith = [0.42, 0.5, 0.58];
      horizon = [0.76, 0.8, 0.83];
      sun = [0.55, 0.58, 0.62];
      ambient = [0.62, 0.65, 0.68];
    } else {
      zenith = [0.25, 0.48, 0.78];
      horizon = [0.76, 0.86, 0.94];
      sun = [1.0, 0.93, 0.78];
      ambient = [0.46, 0.52, 0.58];
    }
    var sunDir = evening ? [-0.7, 0.32, 0.42] : (cloudy ? [-0.15, 0.95, 0.2] : [-0.42, 0.82, 0.38]);
    return {
      cloudy: cloudy,
      evening: evening,
      zenith: zenith,
      horizon: horizon,
      sunColor: sun,
      ambient: ambient,
      sunDir: norm3(sunDir),
      fogColor: horizon,
      fogDensity: 0.0035 + fog * 0.028
    };
  }

  // --------------------------------------------------------------- sky
  function buildSky(colors) {
    var b = new MeshBuilder();
    var seg = 40, rings = 24, R = 400;
    function colAt(y) {
      var t = Math.max(0, Math.min(1, y / R));
      var k = Math.pow(t, 0.55);
      return [
        colors.horizon[0] + (colors.zenith[0] - colors.horizon[0]) * k,
        colors.horizon[1] + (colors.zenith[1] - colors.horizon[1]) * k,
        colors.horizon[2] + (colors.zenith[2] - colors.horizon[2]) * k
      ];
    }
    for (var j = 0; j < rings; j++) {
      var v0 = (j / rings) * Math.PI, v1 = ((j + 1) / rings) * Math.PI;
      for (var i = 0; i < seg; i++) {
        var u0 = (i / seg) * Math.PI * 2, u1 = ((i + 1) / seg) * Math.PI * 2;
        var pts = [];
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].forEach(function (uv) {
          var u = uv[0], v = uv[1];
          var nx = Math.sin(v) * Math.cos(u), ny = Math.cos(v), nz = Math.sin(v) * Math.sin(u);
          var y = ny * R;
          var c = y >= 0 ? colAt(y) : [colors.horizon[0] * 0.8, colors.horizon[1] * 0.8, colors.horizon[2] * 0.82];
          pts.push([nx * R, y, nz * R, c]);
        });
        [0, 1, 2, 0, 2, 3].forEach(function (idx) {
          var p = pts[idx];
          b.vertex(p[0], p[1], p[2], 0, 1, 0, p[3]);
        });
      }
    }
    return b.build();
  }

  // ---------------------------------------------------------- primitives
  function addBuilding(b, o) {
    var cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    var sx = o.x1 - o.x0, sz = o.z1 - o.z0;
    var wall = o.wall || [0.76, 0.71, 0.61];
    var trim = shade(wall, 0.8);
    b.box(cx, o.h / 2, cz, sx, o.h, sz, wall, shade(wall, 1.05));
    b.box(cx, o.h + 0.12, cz, sx + 0.25, 0.28, sz + 0.25, shade(wall, 0.65), [0.3, 0.32, 0.35]);
    // цоколь
    b.box(cx, 0.22, cz, sx + 0.12, 0.44, sz + 0.12, shade(wall, 0.55));
    var rows = o.h > 5.5 ? [2.2, 4.6] : [1.7, 3.2];
    var winCol = [0.16, 0.22, 0.27];
    var colsX = Math.max(2, Math.round(sx / 2.4));
    var colsZ = Math.max(2, Math.round(sz / 2.4));
    for (var r = 0; r < rows.length; r++) {
      var y = rows[r];
      if (y > o.h - 1.1) continue;
      for (var i = 0; i < colsX; i++) {
        var x = o.x0 + (i + 0.5) * (sx / colsX);
        b.box(x, y, o.z0 - 0.03, 1.1, 0.9, 0.06, winCol); // север
        b.box(x, y, o.z1 + 0.03, 1.1, 0.9, 0.06, winCol); // юг
      }
      for (var k = 0; k < colsZ; k++) {
        var z = o.z0 + (k + 0.5) * (sz / colsZ);
        b.box(o.x0 - 0.03, y, z, 0.06, 0.9, 1.1, winCol); // запад
        b.box(o.x1 + 0.03, y, z, 0.06, 0.9, 1.1, winCol); // восток
      }
    }
    // дверь на южную сторону
    b.box(cx + sx * 0.22, 1.05, o.z1 + 0.04, 1.15, 2.1, 0.08, [0.24, 0.2, 0.17]);
    b.box(cx + sx * 0.22, 2.15, o.z1 + 0.06, 1.5, 0.12, 0.12, trim);
  }

  function addTree(b, shadow, x, z, s, dark, gy) {
    gy = gy || 0;
    b.oy = gy;
    shadow.oy = gy;
    var trunk = dark ? [0.31, 0.24, 0.17] : [0.36, 0.28, 0.2];
    b.cylinder([x, 0, z], [x + 0.05 * s, 2.1 * s, z], 0.13 * s, 0.09 * s, 7, trunk);
    var greens = dark
      ? [[0.16, 0.27, 0.16], [0.2, 0.33, 0.19], [0.14, 0.24, 0.14]]
      : [[0.24, 0.38, 0.19], [0.3, 0.45, 0.22], [0.21, 0.34, 0.17]];
    b.sphere(x, 2.7 * s, z, 1.25 * s, 7, 5, greens[0], 0.95);
    b.sphere(x + 0.65 * s, 3.25 * s, z + 0.25 * s, 0.95 * s, 7, 4, greens[1], 0.95);
    b.sphere(x - 0.55 * s, 3.35 * s, z - 0.2 * s, 0.85 * s, 7, 4, greens[2], 0.95);
    shadow.disc(x, 0.015, z, 1.5 * s, 12, [0, 0, 0]);
    b.oy = 0;
    shadow.oy = 0;
  }

  /** Дорожка: сегменты следуют рельефу. */
  function addPath(b, pts, width, color) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], c = pts[i + 1];
      var ax = a[0] - 1000, az = -(a[1] - 2000);
      var cx = c[0] - 1000, cz = -(c[1] - 2000);
      var dx = cx - ax, dz = cz - az;
      var len = Math.hypot(dx, dz) || 1;
      var nx = -dz / len * width / 2, nz = dx / len * width / 2;
      var p1 = [ax + nx, az + nz], p2 = [ax - nx, az - nz];
      var p3 = [cx - nx, cz - nz], p4 = [cx + nx, cz + nz];
      var h1 = terrainHWorld(p1[0], p1[1]) + 0.035;
      var h2 = terrainHWorld(p2[0], p2[1]) + 0.035;
      var h3 = terrainHWorld(p3[0], p3[1]) + 0.035;
      var h4 = terrainHWorld(p4[0], p4[1]) + 0.035;
      b.quad([p1[0], h1, p1[1]], [p4[0], h4, p4[1]], [p3[0], h3, p3[1]], [p2[0], h2, p2[1]], color);
    }
  }

  function addBench(b, shadow, x, z, ang) {
    var gy = terrainHWorld(x, z);
    b.oy = gy;
    b.box(x, 0.46, z, 1.7, 0.08, 0.42, [0.42, 0.27, 0.15]);
    b.box(x, 0.72, z - 0.22, 1.7, 0.32, 0.06, [0.42, 0.27, 0.15]);
    [-0.7, 0.7].forEach(function (dx) {
      b.box(x + dx, 0.23, z - 0.12, 0.08, 0.46, 0.08, [0.22, 0.22, 0.23]);
      b.box(x + dx, 0.23, z + 0.12, 0.08, 0.46, 0.08, [0.22, 0.22, 0.23]);
    });
    b.oy = 0;
    shadow.oy = gy;
    shadow.rectY(x - 0.9, z - 0.35, x + 0.9, z + 0.35, 0.015, [0, 0, 0]);
    shadow.oy = 0;
  }

  function addLamp(b, x, z) {
    var gy = terrainHWorld(x, z);
    b.oy = gy;
    b.cylinder([x, 0, z], [x, 3.2, z], 0.055, 0.045, 7, [0.24, 0.26, 0.27]);
    b.box(x, 3.28, z, 0.34, 0.05, 0.05, [0.24, 0.26, 0.27]);
    b.sphere(x + 0.16, 3.18, z, 0.18, 7, 5, [1.0, 0.86, 0.55], 1);
    b.oy = 0;
  }

  function addPoleTemplate(b) {
    // веха: чередующиеся красно-белые секции
    var segs = 6, h = 1.5, r = 0.023;
    for (var i = 0; i < segs; i++) {
      var y0 = (i / segs) * h, y1 = ((i + 1) / segs) * h;
      var c = i % 2 === 0 ? [0.88, 0.88, 0.84] : [0.72, 0.14, 0.1];
      b.cylinder([0, y0, 0], [0, y1, 0], r, r, 8, c);
    }
    // остриё
    b.cylinder([0, 0, 0], [0, 0.09, 0], 0.012, 0.023, 6, [0.6, 0.61, 0.63]);
    // крепление призмы
    b.box(0, h - 0.06, 0, 0.1, 0.1, 0.07, [0.22, 0.23, 0.24]);
    // призма — её центр совпадает с измеряемой точкой (h); белое окно смотрит в +z
    b.box(0, h, 0, 0.17, 0.16, 0.11, [0.95, 0.35, 0.08], [1.0, 0.55, 0.15]);
    b.box(0, h, 0.058, 0.08, 0.08, 0.006, [1.0, 0.86, 0.68]);
    // маркерная площадка
    b.cylinder([0, 0, 0], [0, 0.005, 0], 0.16, 0.16, 10, [0.9, 0.55, 0.1]);
  }

  /** Геодезический пункт: бетонный монолит, brass-марка и несъёмная призма. */
  function addControlPointTemplate(b) {
    // площадка и белая разметка
    b.disc(0, 0.012, 0, 0.7, 24, [0.28, 0.3, 0.29]);
    for (var a = 0; a < 16; a++) {
      var ang = (a / 16) * Math.PI * 2;
      b.box(Math.cos(ang) * 0.64, 0.02, Math.sin(ang) * 0.64, 0.13, 0.012, 0.045, [0.95, 0.95, 0.88]);
    }
    // бетонный монолит
    b.box(0, 0.1, 0, 0.56, 0.2, 0.56, [0.62, 0.62, 0.58], [0.7, 0.7, 0.66]);
    b.cylinder([0, 0.2, 0], [0, 0.52, 0], 0.2, 0.17, 12, [0.68, 0.68, 0.63]);
    // латунная марка
    b.cylinder([0, 0.52, 0], [0, 0.56, 0], 0.14, 0.14, 16, [0.82, 0.62, 0.18]);
    b.cylinder([0, 0.56, 0], [0, 0.575, 0], 0.05, 0.05, 10, [0.35, 0.28, 0.12]);
    // несъёмная стойка
    b.cylinder([0, 0.54, 0], [0, 1.5, 0], 0.02, 0.016, 7, [0.3, 0.32, 0.34]);
    // призма в жёлтом корпусе (отличается от съёмочных вешек)
    b.box(0, 1.5, 0, 0.2, 0.18, 0.12, [0.92, 0.72, 0.08], [1.0, 0.85, 0.2]);
    b.box(0, 1.5, 0, 0.205, 0.035, 0.125, [0.08, 0.08, 0.08]);
    b.box(0, 1.5, 0, 0.035, 0.18, 0.125, [0.08, 0.08, 0.08]);
    b.box(0, 1.5, 0.063, 0.1, 0.1, 0.006, [1.0, 0.95, 0.78]);
    // табличка
    b.box(0.27, 0.28, 0, 0.02, 0.22, 0.16, [0.15, 0.15, 0.15]);
    b.box(0.282, 0.28, 0, 0.005, 0.16, 0.11, [0.85, 0.85, 0.7]);
  }

  function addInstrument(b) {
    // штатив: три деревянные ноги с металлическими шарнирами и башмаками
    var feet = [[-0.52, 0.02, -0.3], [0.52, 0.02, -0.3], [0, 0.02, 0.6]];
    feet.forEach(function (f) {
      var top = [f[0] * 0.3, 1.3, f[2] * 0.3];
      b.cylinder([f[0], 0.03, f[2]], top, 0.03, 0.022, 7, [0.48, 0.33, 0.19]);
      b.cylinder([f[0], 0.03, f[2]], [f[0], 0.12, f[2]], 0.022, 0.035, 6, [0.16, 0.16, 0.16]);
      b.sphere(top[0], top[1], top[2], 0.035, 6, 4, [0.3, 0.32, 0.34], 1);
      b.box(f[0], 0.015, f[2], 0.11, 0.03, 0.11, [0.15, 0.15, 0.15]);
    });
    // головка штатива и становой винт
    b.cylinder([0, 1.26, 0], [0, 1.32, 0], 0.13, 0.12, 12, [0.35, 0.37, 0.39]);
    b.cylinder([0, 1.32, 0], [0, 1.37, 0], 0.05, 0.05, 8, [0.6, 0.62, 0.64]);
    // трегер
    b.cylinder([0, 1.37, 0], [0, 1.42, 0], 0.16, 0.15, 12, [0.22, 0.24, 0.26]);
    // три подъёмных винта
    for (var i = 0; i < 3; i++) {
      var a = Math.PI / 2 + i * Math.PI * 2 / 3;
      var sx = Math.cos(a) * 0.12, sz = Math.sin(a) * 0.12;
      b.cylinder([sx, 1.39, sz], [sx, 1.46, sz], 0.026, 0.026, 8, [0.55, 0.56, 0.58]);
      b.cylinder([sx, 1.46, sz], [sx, 1.49, sz], 0.038, 0.038, 10, [0.25, 0.27, 0.29]);
    }
    // круглый уровень на трегере
    b.cylinder([0.1, 1.43, 0.12], [0.1, 1.455, 0.12], 0.03, 0.03, 10, [0.15, 0.5, 0.3]);
    b.cylinder([0.1, 1.455, 0.12], [0.1, 1.46, 0.12], 0.032, 0.032, 10, [0.7, 0.9, 0.75]);
  }

  function addInstrumentTop(b) {
    // основание тахеометра на трегере
    b.cylinder([0, 1.42, 0], [0, 1.47, 0], 0.14, 0.13, 14, [0.24, 0.26, 0.28]);
    b.box(0, 1.48, 0, 0.26, 0.03, 0.22, [0.3, 0.33, 0.35]);
    // корпус, «смотрит» в −z
    b.box(0, 1.57, 0.02, 0.32, 0.25, 0.23, [0.14, 0.34, 0.32], [0.2, 0.43, 0.4]);
    b.box(0, 1.46, 0.02, 0.29, 0.08, 0.21, [0.12, 0.28, 0.27]);
    // дисплей и клавиатура на задней стороне
    b.box(0.075, 1.6, 0.145, 0.15, 0.11, 0.025, [0.05, 0.08, 0.08]);
    b.box(-0.07, 1.52, 0.145, 0.13, 0.07, 0.025, [0.05, 0.08, 0.08]);
    for (var k = 0; k < 4; k++) {
      b.box(-0.1 + k * 0.045, 1.5, 0.147, 0.025, 0.012, 0.02, [0.55, 0.58, 0.58]);
    }
    // ручка для переноски
    b.box(0, 1.73, 0.03, 0.18, 0.035, 0.15, [0.1, 0.12, 0.12]);
    b.box(-0.09, 1.7, 0.03, 0.03, 0.08, 0.03, [0.1, 0.12, 0.12]);
    b.box(0.09, 1.7, 0.03, 0.03, 0.08, 0.03, [0.1, 0.12, 0.12]);
    // зрительная труба
    b.cylinder([0, 1.57, -0.04], [0, 1.57, -0.42], 0.066, 0.058, 14, [0.22, 0.25, 0.27]);
    b.cylinder([0, 1.57, -0.42], [0, 1.57, -0.47], 0.075, 0.075, 14, [0.1, 0.12, 0.13]);
    b.cylinder([0, 1.57, -0.465], [0, 1.57, -0.475], 0.055, 0.055, 14, [0.25, 0.6, 0.7]);
    // фокусировочное кольцо и окуляр
    b.cylinder([0, 1.57, -0.04], [0, 1.57, 0.0], 0.062, 0.055, 14, [0.2, 0.22, 0.24]);
    b.cylinder([0, 1.57, 0.0], [0, 1.57, 0.11], 0.04, 0.032, 10, [0.08, 0.08, 0.08]);
    b.cylinder([0, 1.57, 0.11], [0, 1.57, 0.12], 0.045, 0.045, 10, [0.12, 0.12, 0.12]);
    // вертикальный круг и наводящие винты
    b.cylinder([-0.17, 1.57, 0], [-0.22, 1.57, 0], 0.07, 0.07, 12, [0.3, 0.32, 0.34]);
    b.cylinder([0.17, 1.57, 0], [0.22, 1.57, 0], 0.055, 0.055, 10, [0.3, 0.32, 0.34]);
    b.box(-0.2, 1.48, 0.02, 0.035, 0.05, 0.05, [0.5, 0.52, 0.54]);
    b.box(0.2, 1.48, 0.02, 0.035, 0.05, 0.05, [0.5, 0.52, 0.54]);
    // аккумулятор
    b.box(0.17, 1.48, 0.09, 0.07, 0.12, 0.08, [0.12, 0.14, 0.15]);
  }

  // ------------------------------------------------------------- World
  function World(renderer, level) {
    this.renderer = renderer;
    this.level = level;
    this.env = environment(level.scene);
    this.azimuth = 0;
    this.instrumentVisible = true;
    this.tripodVisible = false;
    this.topVisible = false;
    this.boxSurvey = { x: 1008.0, y: 2000.0 };
    if (level.custom && level.station) {
      this.boxSurvey = { x: level.station.x + 8, y: level.station.y };
    }
    this.boxPoles = [];
    this.instrumentSurvey = {
      x: level.station.x,
      y: level.station.y,
      z: level.station.z
    };
    this.poles = new Map();
    this.colliders = [];
    this.treeColliders = [];
    this.blockers = [
      { x0: 1009, x1: 1019, y0: 2008, y1: 2018, h: 7.0 },
      { x0: 1012, x1: 1024, y0: 1986, y1: 1994, h: 4.5 },
      { x0: 997, x1: 1001, y0: 2014, y1: 2018, h: 3.0 }
    ];
    (level.blockers || []).forEach(function (bl) {
      var c = { x0: bl.x0, x1: bl.x1, y0: bl.y0, y1: bl.y1, h: bl.h || 2.5, custom: true };
      this.blockers.push(c);
    }, this);
    this.buildStatic();
    this.makePoles();
    this.makeInstrument();
    this.resetPoles();
    this.storeSparePoles();
  }

  World.prototype.buildStatic = function () {
    var renderer = this.renderer;
    var b = new MeshBuilder();
    var shadow = new MeshBuilder();
    var self = this;

    // --- земля: рельеф с плавными всхолмлениями
    var base = [0.33, 0.43, 0.25];
    b.rectY(-320, -320, 320, 320, -3.2, [0.35, 0.44, 0.27]);
    for (var ix = -65; ix < 65; ix++) {
      for (var iz = -65; iz < 65; iz++) {
        var x0 = ix * 2, x1 = x0 + 2, z0 = iz * 2, z1 = z0 + 2;
        var h00 = terrainHWorld(x0, z0), h01 = terrainHWorld(x0, z1);
        var h10 = terrainHWorld(x1, z0), h11 = terrainHWorld(x1, z1);
        var n = rand();
        var cwx = x0 + 1, cwz = z0 + 1;
        var zbase = base;
        if (cwx > 28 && cwz > 8 && cwz < 100) zbase = [0.22, 0.33, 0.2];
        else if (cwx > 4 && cwz < -30) zbase = [0.44, 0.45, 0.24];
        else if (cwx < -10 && cwz < -30) zbase = [0.3, 0.41, 0.23];
        else if (cwx < -35 && cwz > 5) zbase = [0.35, 0.34, 0.23];
        var c = shade(zbase, 0.95 + n * 0.1);
        if (n > 0.93) c = shade(zbase, 1.12);
        else if (n < 0.05) c = shade(zbase, 0.88);
        b.quad([x0, h00, z0], [x0, h01, z1], [x1, h11, z1], [x1, h10, z0], c);
      }
    }

    // --- бетонная площадка вокруг станции
    b.rectY(-6, -5, 6, 5, 0.012, [0.53, 0.53, 0.51]);
    for (var i = -4; i <= 4; i += 1) {
      b.box(i, 0.018, 0, 0.012, 0.01, 10, [0.47, 0.47, 0.45]);
      b.box(0, 0.018, i, 12, 0.01, 0.012, [0.47, 0.47, 0.45]);
    }
    // разметка станции
    b.disc(0, 0.028, 0, 0.62, 22, [0.3, 0.31, 0.31]);
    for (var a = 0; a < 16; a++) {
      var ang = (a / 16) * Math.PI * 2;
      b.box(Math.cos(ang) * 0.78, 0.03, Math.sin(ang) * 0.78, 0.14, 0.018, 0.055, [0.92, 0.92, 0.87]);
    }

    // --- мелкая сетка 1 × 1 м для точной установки вешки
    for (var gx = -12; gx <= 12; gx++) {
      for (var gz = -12; gz < 12; gz++) {
        var gh = terrainHWorld(gx, gz + 0.5);
        if (gh < 0.01 && gx >= -6 && gx <= 6 && gz >= -5 && gz <= 5) continue;
        b.box(gx, gh + 0.012, gz + 0.5, 0.01, 0.003, 1, [0.43, 0.5, 0.32]);
      }
    }
    for (var gz2 = -12; gz2 <= 12; gz2++) {
      for (var gx2 = -12; gx2 < 12; gx2++) {
        var gh2 = terrainHWorld(gx2 + 0.5, gz2);
        if (gh2 < 0.01 && gx2 >= -6 && gx2 <= 6 && gz2 >= -5 && gz2 <= 5) continue;
        b.box(gx2 + 0.5, gh2 + 0.012, gz2, 1, 0.003, 0.01, [0.43, 0.5, 0.32]);
      }
    }

    // --- маркеры станций (ST1 уже обозначена площадкой)
    (this.level.stations || []).forEach(function (st) {
      if (st.id === 'ST1') return;
      var w = toWorld(st.x, st.y, st.z);
      var gy = terrainHWorld(w.x, w.z);
      b.disc(w.x, gy + 0.022, w.z, 0.5, 20, [0.24, 0.36, 0.34]);
      b.box(w.x, gy + 0.026, w.z, 0.5, 0.006, 0.05, [0.55, 0.95, 0.85]);
      b.box(w.x, gy + 0.026, w.z, 0.05, 0.006, 0.5, [0.55, 0.95, 0.85]);
    });

    // --- ящик для запасных вешек
    var boxX = this.boxSurvey.x - 1000, boxZ = -(this.boxSurvey.y - 2000);
    var boxY = terrainHWorld(boxX, boxZ);
    b.oy = boxY;
    b.box(boxX, 0.06, boxZ, 2.0, 0.12, 1.25, [0.24, 0.17, 0.1]);
    b.box(boxX, 0.42, boxZ - 0.6, 2.0, 0.72, 0.08, [0.4, 0.28, 0.15]);
    b.box(boxX, 0.42, boxZ + 0.6, 2.0, 0.72, 0.08, [0.4, 0.28, 0.15]);
    b.box(boxX - 0.96, 0.42, boxZ, 0.08, 0.72, 1.12, [0.4, 0.28, 0.15]);
    b.box(boxX + 0.96, 0.42, boxZ, 0.08, 0.72, 1.12, [0.4, 0.28, 0.15]);
    b.box(boxX, 0.78, boxZ, 0.08, 0.08, 1.2, [0.62, 0.47, 0.25]);
    b.oy = 0;

    // короткие торцы вешек в ящике — не мешают обзору
    var bgy = terrainHWorld(boxX, boxZ);
    b.oy = bgy;
    for (var bp = -1; bp <= 1; bp++) {
      b.cylinder([boxX - 0.65, 0.86, boxZ + bp * 0.26], [boxX + 0.65, 0.86, boxZ + bp * 0.26], 0.026, 0.026, 8, [0.8, 0.8, 0.76]);
      b.cylinder([boxX - 0.65, 0.86, boxZ + bp * 0.26], [boxX - 0.3, 0.86, boxZ + bp * 0.26], 0.026, 0.026, 8, [0.7, 0.14, 0.1]);
    }
    b.oy = 0;

    // --- маркеры точек задания (остаются на месте, если вешку перенесли)
    (this.level.targets || []).forEach(function (t) {
      if (t.kind === 'stakeout' || t.freePole) return;
      var w = toWorld(t.x, t.y, t.z);
      b.disc(w.x, w.y + 0.022, w.z, 0.16, 12, [0.9, 0.62, 0.12]);
      b.box(w.x, w.y + 0.024, w.z, 0.28, 0.006, 0.035, [0.98, 0.85, 0.52]);
      b.box(w.x, w.y + 0.024, w.z, 0.035, 0.006, 0.28, [0.98, 0.85, 0.52]);
      if (t.required) {
        var px = w.x + 0.2, pz = w.z + 0.16;
        b.cylinder([px, w.y + 0.02, pz], [px, w.y + 0.42, pz], 0.009, 0.007, 6, [0.95, 0.72, 0.18]);
        b.box(px + 0.065, w.y + 0.4, pz, 0.13, 0.075, 0.012, [0.98, 0.8, 0.22]);
      }
    });

    // --- здания (посажены на рельеф)
    var bA = terrainHWorld(14, -13);
    b.oy = bA;
    addBuilding(b, { x0: 9, x1: 19, z0: -18, z1: -8, h: 7.0, wall: [0.78, 0.73, 0.63] });
    b.oy = 0;
    var bB = terrainHWorld(18, 10);
    b.oy = bB;
    addBuilding(b, { x0: 12, x1: 24, z0: 6, z1: 14, h: 4.5, wall: [0.72, 0.68, 0.6] });
    b.oy = 0;
    var bC = terrainHWorld(-1, -16);
    b.oy = bC;
    addBuilding(b, { x0: -3, x1: 1, z0: -18, z1: -14, h: 3.0, wall: [0.55, 0.58, 0.6] });
    b.oy = 0;

    this.colliders.push({ x0: 8.7, x1: 19.3, z0: -18.3, z1: -7.7 });
    this.colliders.push({ x0: 11.7, x1: 24.3, z0: 5.7, z1: 14.3 });
    this.colliders.push({ x0: -3.3, x1: 1.3, z0: -18.3, z1: -13.7 });
    this.buildingRects = [
      { x0: 9, x1: 19, z0: -18, z1: -8 },
      { x0: 12, x1: 24, z0: 6, z1: 14 },
      { x0: -3, x1: 1, z0: -18, z1: -14 }
    ];
    shadow.oy = bA;
    shadow.rectY(9, -8, 19, -6.5, 0.016, [0, 0, 0]);
    shadow.oy = bB;
    shadow.rectY(12, 14, 24, 15.5, 0.016, [0, 0, 0]);
    shadow.oy = 0;

    // бордюры
    var curb = [[14, -8.05, 10.4, 0.25], [18, 14.05, 12.4, 0.25], [24.1, 10, 0.25, 8.2], [9.9, -13, 0.25, 10.2]];
    curb.forEach(function (c) {
      b.oy = terrainHWorld(c[0], c[1]);
      b.box(c[0], 0.11, c[1], c[2], 0.22, c[3], [0.7, 0.7, 0.66]);
      b.oy = 0;
    });

    // --- деревья
    var trees = [
      [-10, -4, 1.05], [-19, 10, 1.1], [12, 20, 0.9], [30, 20, 1.2],
      [-8, -14, 1.0], [26, 16, 1.15], [-12, 9, 0.95], [36, 8, 1.1],
      [16, -30, 1.2], [6, -33, 1.0], [-22, -18, 1.1], [18, 17, 0.95],
      [-16, 15, 1.05], [34, 8, 1.25], [-26, 2, 1.15], [25, 24, 1.0]
    ];
    trees.forEach(function (t) {
      var gy = terrainHWorld(t[0], t[1]);
      addTree(b, shadow, t[0], t[1], t[2], rand() > 0.7, gy);
      self.treeColliders.push({ x: t[0], z: t[1], r: 0.42 * t[2] });
    });

    // кустарники
    [[-4.5, -7.2, 0.6], [20.5, -6.8, 0.5], [10.4, 5.4, 0.55], [25.5, 13.2, 0.45]].forEach(function (s) {
      var gy = terrainHWorld(s[0], s[1]);
      b.oy = gy; shadow.oy = gy;
      b.sphere(s[0], s[2] * 0.8, s[1], s[2], 8, 6, [0.2, 0.33, 0.16], 0.85);
      shadow.disc(s[0], 0.014, s[1], s[2] * 1.1, 10, [0, 0, 0]);
      b.oy = 0; shadow.oy = 0;
    });

    // --- забор убран: территория расширена до парка, луга и леса
    // --- трава
    for (var g = 0; g < 300; g++) {
      var gx3 = (rand() - 0.5) * 230, gz3 = (rand() - 0.5) * 220;
      if (gx3 > 7 && gx3 < 21 && gz3 < -7 && gz3 > -19) continue;
      if (gx3 > 10 && gx3 < 25 && gz3 > 4 && gz3 < 15) continue;
      var hgt = 0.1 + rand() * 0.18;
      b.oy = terrainHWorld(gx3, gz3);
      b.cylinder([gx3, 0, gz3], [gx3 + (rand() - 0.5) * 0.05, hgt, gz3], 0.012, 0.004, 4, [0.3, 0.42, 0.2]);
      b.oy = 0;
    }

    // --- дальний лес по границе полигона (не ставим деревья на линии визирования вешек)
    var sightings = [];
    var sightTargets = (this.level.controlPoints || []).concat(this.level.targets || []);
    if (!this.level.controlPoints && this.level.backsight) sightTargets.push(this.level.backsight);
    sightTargets.forEach(function (t) {
      var w = toWorld(t.x, t.y, t.z);
      sightings.push(Math.atan2(w.x, -w.z));
    });
    function onSightline(x, z) {
      var b = Math.atan2(x, -z);
      for (var k = 0; k < sightings.length; k++) {
        var d = Math.abs(b - sightings[k]);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < 6 * Math.PI / 180) return true;
      }
      return false;
    }
    for (var f = 0; f < 48; f++) {
      var ang2 = rand() * Math.PI * 2;
      var rad = 118 + rand() * 22;
      var fx = Math.cos(ang2) * rad, fz = Math.sin(ang2) * rad;
      if (onSightline(fx, fz)) continue;
      var fh = 6 + rand() * 7;
      b.oy = terrainHWorld(fx, fz);
      b.cylinder([fx, 0, fz], [fx, fh * 0.35, fz], 0.28, 0.2, 5, [0.25, 0.22, 0.16]);
      b.cylinder([fx, fh * 0.3, fz], [fx, fh, fz], fh * 0.22, 0.02, 7, [0.16, 0.25, 0.16]);
      b.oy = 0;
    }

    // --- парк, лес, луг, овраг: большая территория
    this.zones = [
      { id: 'park', x0: 944, x1: 994, y0: 2038, y1: 2100, color: [0.28, 0.42, 0.24] },
      { id: 'meadow', x0: 998, x1: 1088, y0: 2030, y1: 2100, color: [0.46, 0.48, 0.24] },
      { id: 'forest', x0: 1028, x1: 1108, y0: 1922, y1: 2006, color: [0.16, 0.3, 0.18] },
      { id: 'ravine', x0: 936, x1: 974, y0: 1944, y1: 2008, color: [0.34, 0.33, 0.22] }
    ];
    this.paths = [
      { points: [[995, 2005], [990, 2012], [980, 2028], [968, 2045], [960, 2062]], width: 1.9, color: [0.56, 0.51, 0.4] },
      { points: [[995, 1995], [990, 1990], [978, 1978], [966, 1968], [956, 1958]], width: 1.8, color: [0.5, 0.47, 0.37] },
      { points: [[1005, 2005], [1018, 2012], [1032, 2028], [1046, 2042]], width: 1.9, color: [0.58, 0.52, 0.42] },
      { points: [[1005, 1995], [1020, 1992], [1040, 1978], [1058, 1964]], width: 1.7, color: [0.46, 0.43, 0.34] },
      { points: [[960, 2062], [950, 2078], [962, 2092], [980, 2087], [985, 2070], [974, 2054], [960, 2062]], width: 1.5, color: [0.6, 0.55, 0.43] }
    ];
    this.paths.forEach(function (p) { addPath(b, p.points, p.width, p.color); });

    // пруд в парке
    var pond = toWorld(957, 2078, 100 + terrainHSurvey(957, 2078));
    b.disc(pond.x, pond.y + 0.025, pond.z, 6.2, 28, [0.16, 0.35, 0.42]);
    b.disc(pond.x, pond.y + 0.035, pond.z, 5.6, 28, [0.2, 0.45, 0.52]);
    for (var pr = 0; pr < 20; pr++) {
      var pa = pr / 20 * Math.PI * 2;
      b.sphere(pond.x + Math.cos(pa) * 6.1, pond.y + 0.12, pond.z + Math.sin(pa) * 6.1, 0.28 + rand() * 0.2, 6, 4, [0.4, 0.4, 0.36], 0.9);
    }

    // скамейки и фонари в парке
    [[984, 2039], [966, 2053], [950, 2072], [976, 2082]].forEach(function (p) {
      addBench(b, shadow, p[0] - 1000, -(p[1] - 2000), 0);
    });
    [[972, 2046], [956, 2064], [982, 2070], [1040, 2038]].forEach(function (p) {
      addLamp(b, p[0] - 1000, -(p[1] - 2000));
    });

    // деревья парка
    for (var pt = 0; pt < 16; pt++) {
      var px = -68 + rand() * 58, pz = -98 + rand() * 58;
      if (Math.hypot(px - pond.x, pz - pond.z) < 8) continue;
      var pg = terrainHWorld(px, pz);
      addTree(b, shadow, px, pz, 0.7 + rand() * 0.45, rand() > 0.55, pg);
      self.treeColliders.push({ x: px, z: pz, r: 0.33 });
    }

    // густой лес на востоке/юге
    for (var ft = 0; ft < 120; ft++) {
      var fx2 = 31 + rand() * 76, fz2 = 11 + rand() * 82;
      if (fx2 > 11 && fx2 < 25 && fz2 > 5 && fz2 < 15) continue;
      var fg = terrainHWorld(fx2, fz2);
      addTree(b, shadow, fx2, fz2, 0.72 + rand() * 0.7, true, fg);
      self.treeColliders.push({ x: fx2, z: fz2, r: 0.36 });
    }
    // лесная подстилка и папоротники
    for (var fu = 0; fu < 60; fu++) {
      var ux = 32 + rand() * 74, uz = 12 + rand() * 80;
      var ugy = terrainHWorld(ux, uz);
      b.oy = ugy;
      b.cylinder([ux, 0, uz], [ux, 0.25 + rand() * 0.35, uz], 0.02, 0.005, 4, [0.18, 0.34, 0.16]);
      b.oy = 0;
    }

    // луг: высокая трава, цветы, валуны
    for (var mg = 0; mg < 60; mg++) {
      var mx = 4 + rand() * 92, mz = -104 + rand() * 78;
      var mgy = terrainHWorld(mx, mz);
      var mh = 0.18 + rand() * 0.35;
      b.oy = mgy;
      b.cylinder([mx, 0, mz], [mx + (rand() - 0.5) * 0.1, mh, mz], 0.016, 0.004, 4, [0.36, 0.47, 0.22]);
      if (rand() > 0.82) b.sphere(mx, mh + 0.03, mz, 0.045, 5, 3, [0.9, 0.78, 0.28], 1);
      b.oy = 0;
    }
    [[18, -62, 1.1], [44, -80, 0.8], [70, -48, 1.4], [30, -92, 0.7], [86, -72, 1.0]].forEach(function (r) {
      var gy = terrainHWorld(r[0], r[1]);
      b.oy = gy;
      b.sphere(r[0], r[2] * 0.45, r[1], r[2], 7, 5, [0.42, 0.43, 0.4], 0.92);
      b.oy = 0;
    });
    // цветущие поляны и стога на лугу
    for (var fl = 0; fl < 34; fl++) {
      var fx3 = 8 + rand() * 82, fz3 = -100 + rand() * 70;
      var fgy2 = terrainHWorld(fx3, fz3);
      var fc = rand() > 0.5 ? [0.92, 0.8, 0.28] : [0.88, 0.72, 0.78];
      b.oy = fgy2;
      b.sphere(fx3, 0.16 + rand() * 0.08, fz3, 0.09 + rand() * 0.07, 5, 3, fc, 1);
      b.oy = 0;
    }
    [[26, -58], [58, -86], [78, -62]].forEach(function (h) {
      var hy = terrainHWorld(h[0], h[1]);
      b.oy = hy;
      b.cylinder([h[0], 0, h[1]], [h[0], 1.0, h[1]], 0.85, 0.8, 10, [0.68, 0.57, 0.3], [0.78, 0.68, 0.4]);
      b.oy = 0;
    });

    // овраг: камни и сухое русло
    for (var rv = 0; rv < 26; rv++) {
      var rx = -92 + rand() * 45, rz = 8 + rand() * 58;
      if (Math.hypot(rx + 32, rz - 15) < 4.5) continue;
      if (Math.hypot(rx + 42, rz - 38) < 4.5) continue;
      var rgy = terrainHWorld(rx, rz);
      var rs = 0.22 + rand() * 0.55;
      b.oy = rgy;
      b.sphere(rx, rs * 0.35, rz, rs, 6, 4, [0.4, 0.39, 0.34], 0.9);
      b.oy = 0;
    }
    for (var st = 0; st < 40; st++) {
      var sx = -82 + rand() * 30, sz = 14 + rand() * 50;
      var sgy = terrainHWorld(sx, sz);
      b.oy = sgy;
      b.sphere(sx, 0.08, sz, 0.18 + rand() * 0.22, 5, 3, [0.48, 0.47, 0.42], 0.9);
      b.oy = 0;
    }

    // видимые преграды уровня: плотная живая изгородь из кустов
    (this.level.blockers || []).forEach(function (bl) {
      if (!bl.custom) return;
      var step = 1.35;
      for (var bx2 = bl.x0; bx2 <= bl.x1; bx2 += step) {
        for (var by2 = bl.y0; by2 <= bl.y1; by2 += step) {
          var wx = bx2 - 1000, wz = -(by2 - 2000);
          var gy = terrainHWorld(wx, wz);
          var rr = 0.7 + rand() * 0.45;
          b.sphere(wx, gy + rr * 0.85, wz, rr, 7, 5, [0.2 + rand() * 0.06, 0.32 + rand() * 0.08, 0.16], 0.9);
          shadow.oy = gy;
          shadow.disc(wx, 0.02, wz, rr * 1.1, 7, [0, 0, 0]);
          shadow.oy = 0;
          if (rand() > 0.55) self.treeColliders.push({ x: wx, z: wz, r: rr * 0.55 });
        }
      }
    });

    // линия хода от пунктов привязки к удалённым станциям (большой выезд)
    if (this.level.id === 'level_06') {
      var cps = this.level.controlPoints || [];
      (this.level.stations || []).forEach(function (st) {
        var best = null, bd = Infinity;
        cps.forEach(function (c) {
          var vis = self.isVisible(st.x, st.y, c.x, c.y);
          var d = Math.hypot(c.x - st.x, c.y - st.y) + (vis ? 0 : 1000);
          if (d < bd) { bd = d; best = c; }
        });
        if (!best) return;
        var line = [];
        var n = Math.max(2, Math.ceil(Math.hypot(best.x - st.x, best.y - st.y) / 2));
        for (var q = 0; q <= n; q++) {
          var t = q / n;
          line.push([st.x + (best.x - st.x) * t, st.y + (best.y - st.y) * t]);
        }
        addPath(b, line, 0.18, [0.95, 0.72, 0.18]);
        for (var q2 = 6; q2 < n; q2 += 5) {
          var rp = line[q2];
          var rw = rp[0] - 1000, rz = -(rp[1] - 2000);
          var rgy = terrainHWorld(rw, rz);
          b.oy = rgy;
          b.box(rw, 0.28, rz, 0.08, 0.56, 0.08, [0.92, 0.78, 0.25]);
          b.oy = 0;
        }
      });
    }

    this.staticMesh = renderer.upload(b.build());
    this.shadowMesh = renderer.upload(shadow.build());
    this.skyMesh = renderer.upload(buildSky(this.env));
    var sunB = new MeshBuilder();
    var sd = this.env.sunDir;
    sunB.sphere(sd[0] * 330, sd[1] * 330, sd[2] * 330, 7, 12, 8, this.env.sunColor);
    this.sunMesh = renderer.upload(sunB.build());
    var poleB = new MeshBuilder();
    addPoleTemplate(poleB);
    this.poleMesh = renderer.upload(poleB.build());
    var cpB = new MeshBuilder();
    addControlPointTemplate(cpB);
    this.controlMesh = renderer.upload(cpB.build());
    var instB = new MeshBuilder();
    addInstrument(instB);
    this.instrumentBase = renderer.upload(instB.build());
    var instTopB = new MeshBuilder();
    addInstrumentTop(instTopB);
    this.instrumentTop = renderer.upload(instTopB.build());
    var shadowDisc = new MeshBuilder();
    shadowDisc.disc(0, 0, 0, 0.5, 12, [0, 0, 0]);
    this.shadowDisc = renderer.upload(shadowDisc.build());
    var pm = new MeshBuilder();
    pm.disc(0, 0, 0, 0.32, 22, [1.0, 0.78, 0.16]);
    pm.box(0, 0.004, 0, 0.5, 0.004, 0.03, [0.15, 0.13, 0.06]);
    pm.box(0, 0.004, 0, 0.03, 0.004, 0.5, [0.15, 0.13, 0.06]);
    this.placementMesh = renderer.upload(pm.build());
  };

  function normalizeAz(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  /** Азимут с точки на станцию (X — восток, Y — север). */
  function azimuthToStation(x, y) {
    return normalizeAz(Math.atan2(STATION.x - x, STATION.y - y));
  }

  World.prototype.makePoles = function () {
    var self = this;
    this.poleList = [];
    var ids = {};
    var list = [];
    var controls = this.level.controlPoints || (this.level.backsight ? [this.level.backsight] : []);
    controls.forEach(function (c) {
      if (ids[c.id]) return;
      ids[c.id] = true;
      list.push({
        id: c.id, x: c.x, y: c.y, z: c.z, prismHeight: c.prismHeight,
        kind: 'control', control: true, required: false,
        note: c.note || 'Пункт привязки'
      });
    });
    (this.level.targets || []).forEach(function (t) {
      if (ids[t.id]) return;
      ids[t.id] = true;
      list.push(t);
    });
    list.forEach(function (t) { self.registerPole(t); });
  };

  World.prototype.registerPole = function (t) {
    if (this.poles.has(t.id)) return;
    var pos = t.initial ? { x: t.initial.x, y: t.initial.y } : { x: t.x, y: t.y };
    this.poles.set(t.id, {
      target: t,
      id: t.id,
      name: t.poleName || t.id,
      x: pos.x,
      y: pos.y,
      z: 100 + terrainHSurvey(pos.x, pos.y),
      prismHeight: t.prismHeight,
      stakeout: t.kind === 'stakeout',
      control: !!t.control,
      prismAz: azimuthToStation(pos.x, pos.y)
    });
    this.poleList.push(t.id);
    if (t.control) {
      var w = toWorld(pos.x, pos.y, t.z);
      this.treeColliders.push({ x: w.x, z: w.z, r: 0.34 });
    }
  };

  World.prototype.addPole = function (t) {
    this.registerPole(t);
  };

  World.prototype.removePole = function (id) {
    var p = this.poles.get(id);
    if (!p || p.control) return;
    this.poles.delete(id);
    this.poleList = this.poleList.filter(function (x) { return x !== id; });
    this.boxPoles = this.boxPoles.filter(function (x) { return x !== id; });
  };

  World.prototype.resetPoles = function () {
    var self = this;
    this.poleList.forEach(function (id) {
      var p = self.poles.get(id);
      var t = p.target;
      p.x = t.initial ? t.initial.x : t.x;
      p.y = t.initial ? t.initial.y : t.y;
      p.prismAz = azimuthToStation(p.x, p.y);
    });
  };

  World.prototype.storeSparePoles = function () {
    var self = this;
    var slot = 0, activeRequired = 0;
    this.poleList.forEach(function (id) {
      var p = self.poles.get(id);
      if (!p || p.control) return;
      if (p.target.kind === 'stakeout') return;
      if (p.target.required && activeRequired < 3) { activeRequired++; return; }
      self.storePole(id, slot++);
    });
  };

  World.prototype.storePole = function (id, slot) {
    var p = this.poles.get(id);
    if (!p || p.control) return;
    if (slot == null) slot = this.boxPoles.length;
    p.stored = true;
    p.boxSlot = slot;
    p.home = { x: p.target.x, y: p.target.y, z: p.target.z };
    var col = slot % 5, row = Math.floor(slot / 5);
    p.x = this.boxSurvey.x + (col - 2) * 0.3;
    p.y = this.boxSurvey.y - 0.45 + row * 0.3;
    p.z = 100 + terrainHSurvey(p.x, p.y);
    p.prismAz = azimuthToStation(p.x, p.y);
    if (this.boxPoles.indexOf(id) < 0) this.boxPoles.push(id);
  };

  World.prototype.takePole = function (id) {
    var p = this.poles.get(id);
    if (!p || !p.stored) return;
    p.stored = false;
    p.boxSlot = -1;
    this.boxPoles = this.boxPoles.filter(function (x) { return x !== id; });
  };
  World.prototype.setPole = function (id, x, y) {
    var p = this.poles.get(id);
    if (!p) return;
    p.x = x; p.y = y;
    p.prismAz = azimuthToStation(x, y);
  };

  World.prototype.movePole = function (id, dx, dy) {
    var p = this.poles.get(id);
    if (!p) return;
    p.x += dx; p.y += dy;
    p.prismAz = azimuthToStation(p.x, p.y);
  };

  World.prototype.makeInstrument = function () {
    this.instrumentVisible = true;
    this.instrumentAz = 0;
  };

  World.prototype.poleWorld = function (id) {
    var p = this.poles.get(id);
    if (!p) return null;
    return toWorld(p.x, p.y, p.z);
  };

  World.prototype.poleSurvey = function (id) {
    var p = this.poles.get(id);
    if (!p) return null;
    return { x: p.x, y: p.y, z: p.z, prismHeight: p.prismHeight, prismAz: p.prismAz, control: p.control };
  };

  World.prototype.instrumentWorld = function () {
    var p = toWorld(this.instrumentSurvey.x, this.instrumentSurvey.y, this.instrumentSurvey.z);
    return { x: p.x, y: p.y, z: p.z };
  };

  World.prototype.setInstrumentStation = function (st) {
    this.instrumentSurvey = { x: st.x, y: st.y, z: st.z };
  };

  World.prototype.collidePole = function (p, r) {
    r = r == null ? 0.04 : r;
    var x = p.x, z = p.z;
    (this.buildingRects || []).forEach(function (b) {
      if (x + r <= b.x0 || x - r >= b.x1 || z + r <= b.z0 || z - r >= b.z1) return;
      var dl = x + r - b.x0, dr = b.x1 - (x - r);
      var dn = z + r - b.z0, ds = b.z1 - (z - r);
      var m = Math.min(dl, dr, dn, ds);
      if (m === dl) x = b.x0 - r;
      else if (m === dr) x = b.x1 + r;
      else if (m === dn) z = b.z0 - r;
      else z = b.z1 + r;
    });
    this.treeColliders.forEach(function (t) {
      var dx = x - t.x, dz = z - t.z;
      var d = Math.hypot(dx, dz), min = t.r + r;
      if (d < min) {
        if (d < 1e-6) { x += min; } else { x = t.x + dx / d * min; z = t.z + dz / d * min; }
      }
    });
    x = Math.max(-126, Math.min(126, x));
    z = Math.max(-126, Math.min(126, z));
    return { x: x, z: z };
  };

  World.prototype.facePrismsTo = function (x, y) {
    this.poles.forEach(function (p) {
      p.prismAz = normalizeAz(Math.atan2(x - p.x, y - p.y));
    });
  };

  World.prototype.isVisible = function (x1, y1, x2, y2) {
    for (var i = 0; i < this.blockers.length; i++) {
      var b = this.blockers[i];
      if (segmentBox(x1, y1, x2, y2, b)) return false;
    }
    return true;
  };

  function segmentBox(x1, y1, x2, y2, b) {
    var t0 = 0, t1 = 1;
    var dx = x2 - x1, dy = y2 - y1;
    var p = [-dx, dx, -dy, dy];
    var q = [x1 - b.x0, b.x1 - x1, y1 - b.y0, b.y1 - y1];
    for (var i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) {
        if (q[i] < 0) return false;
      } else {
        var r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return t0 < t1 - 1e-9;
  }

  World.prototype.collide = function (pos, radius) {
    var x = pos.x, z = pos.z;
    for (var i = 0; i < this.colliders.length; i++) {
      var c = this.colliders[i];
      var x0 = c.x0 - radius, x1 = c.x1 + radius;
      var z0 = c.z0 - radius, z1 = c.z1 + radius;
      if (x > x0 && x < x1 && z > z0 && z < z1) {
        var dl = x - x0, dr = x1 - x, dn = z - z0, df = z1 - z;
        var m = Math.min(dl, dr, dn, df);
        if (m === dl) x = x0; else if (m === dr) x = x1;
        else if (m === dn) z = z0; else z = z1;
      }
    }
    // штатив
    var dsx = x, dsz = z;
    var dTripod = Math.hypot(dsx, dsz);
    if (dTripod < 0.45 + radius) {
      var k = (0.45 + radius) / (dTripod || 0.001);
      x = dsx * k; z = dsz * k;
    }
    for (var j = 0; j < this.treeColliders.length; j++) {
      var t = this.treeColliders[j];
      var dx = x - t.x, dz = z - t.z;
      var d = Math.hypot(dx, dz);
      if (d < t.r + radius && d > 1e-6) {
        x = t.x + (dx / d) * (t.r + radius);
        z = t.z + (dz / d) * (t.r + radius);
      }
    }
    x = Math.max(-125, Math.min(125, x));
    z = Math.max(-125, Math.min(125, z));
    return { x: x, z: z };
  };

  World.prototype.setAimAzimuth = function (az) {
    this.instrumentAz = az;
  };

  World.prototype.render = function (renderer, cam, opts) {
    var gl = renderer.gl;
    // небо и солнце
    renderer.setDepthTest(false);
    renderer.setDepthWrite(false);
    renderer.draw(this.skyMesh, null, { unlit: true, fog: 0 });
    renderer.draw(this.sunMesh, null, { unlit: true, fog: 0 });
    renderer.setDepthTest(true);
    renderer.setDepthWrite(true);

    renderer.draw(this.staticMesh, null, {});

    // мягкие тени
    renderer.setBlend(true);
    renderer.setDepthWrite(false);
    renderer.draw(this.shadowMesh, null, { unlit: true, alpha: 0.2, fog: 0 });
    var self = this;
    var carried = opts && opts.carry ? opts.carry.id : null;
    this.poleList.forEach(function (id) {
      if (id === carried) return;
      var p = self.poles.get(id);
      if (p.stored) return;
      var w = toWorld(p.x, p.y, p.z);
      var m = M4.translation(M4.create(), w.x, w.y + 0.02, w.z);
      renderer.draw(self.shadowDisc, m, { unlit: true, alpha: 0.22, fog: 0 });
    });
    renderer.setBlend(false);
    renderer.setDepthWrite(true);

    // вешки и геодезические пункты
    this.poleList.forEach(function (id) {
      if (id === carried) return;
      var p = self.poles.get(id);
      if (p.stored) return;
      var w = toWorld(p.x, p.y, p.z);
      var scale = p.prismHeight / 1.5;
      var model = M4.rotationY(M4.create(), Math.PI - p.prismAz);
      if (!p.control) model[5] = scale;
      model[12] = w.x; model[13] = w.y; model[14] = w.z;
      var tint = (opts && opts.highlight === id) ? HIGHLIGHT : null;
      renderer.draw(p.control ? self.controlMesh : self.poleMesh, model, { tint: tint });
    });

    // вешка в руках
    if (opts && opts.carry) {
      var c = opts.carry;
      var cm = M4.rotationY(M4.create(), Math.PI - c.prismAz);
      cm[5] = (c.prismHeight || 1.5) / 1.5;
      cm[12] = c.wx; cm[13] = terrainHWorld(c.wx, c.wz); cm[14] = c.wz;
      renderer.draw(this.poleMesh, cm, { tint: new Float32Array([1.15, 1.1, 1.0]) });
    }

    // посадочный маркер под переносимой вешкой
    if (opts && opts.placement) {
      var pl = opts.placement;
      var pmm = M4.translation(M4.create(), pl.wx, terrainHWorld(pl.wx, pl.wz) + 0.025, pl.wz);
      renderer.draw(this.placementMesh, pmm, { unlit: true, fog: 0 });
    }

    // тахеометр: штатив и верхняя часть устанавливаются отдельно
    if (!opts || !opts.hideInstrument) {
      var iw = toWorld(this.instrumentSurvey.x, this.instrumentSurvey.y, this.instrumentSurvey.z);
      var gy = iw.y;
      if (this.tripodVisible) {
        var baseModel = M4.translation(M4.create(), iw.x, gy, iw.z);
        renderer.draw(this.instrumentBase, baseModel, {});
      }
      if (this.topVisible) {
        var top = M4.rotationY(M4.create(), -this.instrumentAz);
        top[12] = iw.x; top[13] = gy; top[14] = iw.z;
        renderer.draw(this.instrumentTop, top, {});
      }
    }
  };

  var HIGHLIGHT = new Float32Array([1.7, 1.5, 1.3]);

  World.prototype.getEnv = function () { return this.env; };
  World.prototype.toWorld = toWorld;
  World.prototype.toSurvey = toSurvey;

  World.prototype.dispose = function () {
    var names = ['staticMesh', 'shadowMesh', 'skyMesh', 'sunMesh', 'poleMesh', 'controlMesh',
      'instrumentBase', 'instrumentTop', 'shadowDisc', 'placementMesh'];
    for (var i = 0; i < names.length; i++) {
      if (this[names[i]]) this.renderer.freeMesh(this[names[i]]);
      this[names[i]] = null;
    }
  };

  GEO.World = World;
  GEO.World.terrainHeightWorld = terrainHWorld;
  GEO.World.terrainHeightSurvey = terrainHSurvey;
  GEO.terrainHeightWorld = terrainHWorld;
  GEO.terrainHeightSurvey = terrainHSurvey;
  GEO.World.toWorld = toWorld;
  GEO.World.toSurvey = toSurvey;
})(typeof window !== 'undefined' ? window : globalThis);
