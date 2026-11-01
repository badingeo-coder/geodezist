/**
 * 01_gl.js — компактный WebGL2-рендерер без внешних зависимостей.
 * Матрицы column-major, как ожидает WebGL. Модуль не знает о геодезии.
 */
(function (root) {
  'use strict';
  var GEO = root.GEO = root.GEO || {};

  var M4 = {
    create: function () { return new Float32Array(16); },
    identity: function (out) {
      out = out || new Float32Array(16);
      out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
      out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
      return out;
    },
    multiply: function (out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (var i = 0; i < 4; i++) {
        var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return out;
    },
    perspective: function (out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2);
      out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
      out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
      return out;
    },
    lookAt: function (out, eye, center, up) {
      var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      var len = Math.hypot(zx, zy, zz) || 1;
      zx /= len; zy /= len; zz /= len;
      var xx = up[1] * zz - up[2] * zy;
      var xy = up[2] * zx - up[0] * zz;
      var xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz) || 1;
      xx /= len; xy /= len; xz /= len;
      var yx = zy * xz - zz * xy;
      var yy = zz * xx - zx * xz;
      var yz = zx * xy - zy * xx;
      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      out[15] = 1;
      return out;
    },
    translation: function (out, x, y, z) {
      M4.identity(out);
      out[12] = x; out[13] = y; out[14] = z;
      return out;
    },
    rotationY: function (out, a) {
      var c = Math.cos(a), s = Math.sin(a);
      M4.identity(out);
      out[0] = c; out[2] = -s;
      out[8] = s; out[10] = c;
      return out;
    },
    rotationX: function (out, a) {
      var c = Math.cos(a), s = Math.sin(a);
      M4.identity(out);
      out[5] = c; out[6] = s;
      out[9] = -s; out[10] = c;
      return out;
    }
  };

  function projectPoint(proj, view, p, width, height) {
    var m = M4.multiply(new Float32Array(16), proj, view);
    var x = p[0], y = p[1], z = p[2];
    var cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    var cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    var cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.001) return null;
    return {
      x: (cx / cw * 0.5 + 0.5) * width,
      y: (1 - (cy / cw * 0.5 + 0.5)) * height,
      z: cw
    };
  }

  // ---------------------------------------------------------------- mesh
  function MeshBuilder() {
    this.data = [];
    this.oy = 0; // вертикальное смещение для посадки объектов на рельеф
  }
  MeshBuilder.prototype.vertex = function (x, y, z, nx, ny, nz, c) {
    this.data.push(x, y + this.oy, z, nx, ny, nz, c[0], c[1], c[2]);
  };
  MeshBuilder.prototype.quad = function (a, b, c, d, col) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.vertex(a[0], a[1], a[2], nx, ny, nz, col);
    this.vertex(b[0], b[1], b[2], nx, ny, nz, col);
    this.vertex(c[0], c[1], c[2], nx, ny, nz, col);
    this.vertex(a[0], a[1], a[2], nx, ny, nz, col);
    this.vertex(c[0], c[1], c[2], nx, ny, nz, col);
    this.vertex(d[0], d[1], d[2], nx, ny, nz, col);
  };
  MeshBuilder.prototype.box = function (cx, cy, cz, sx, sy, sz, col, topCol) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2;
    var y0 = cy - sy / 2, y1 = cy + sy / 2;
    var z0 = cz - sz / 2, z1 = cz + sz / 2;
    var top = topCol || col;
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
  };
  MeshBuilder.prototype.cylinder = function (p0, p1, r0, r1, seg, col, capCol) {
    var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    var len = Math.hypot(ax, ay, az);
    if (len < 1e-6) return;
    ax /= len; ay /= len; az /= len;
    var ux = 0, uy = 1, uz = 0;
    if (Math.abs(ay) > 0.95) { ux = 1; uy = 0; uz = 0; }
    var tx = uy * az - uz * ay, ty = uz * ax - ux * az, tz = ux * ay - uy * ax;
    var tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    var bx = ay * tz - az * ty, by = az * tx - ax * tz, bz = ax * ty - ay * tx;
    var ring0 = [], ring1 = [];
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      var nx = tx * ca + bx * sa, ny = ty * ca + by * sa, nz = tz * ca + bz * sa;
      ring0.push([p0[0] + nx * r0, p0[1] + ny * r0, p0[2] + nz * r0, nx, ny, nz]);
      ring1.push([p1[0] + nx * r1, p1[1] + ny * r1, p1[2] + nz * r1, nx, ny, nz]);
    }
    for (var j = 0; j < seg; j++) {
      var a0 = ring0[j], a1 = ring0[j + 1], b1 = ring1[j + 1], b0 = ring1[j];
      this.vertex(a0[0], a0[1], a0[2], a0[3], a0[4], a0[5], col);
      this.vertex(b0[0], b0[1], b0[2], b0[3], b0[4], b0[5], col);
      this.vertex(b1[0], b1[1], b1[2], b1[3], b1[4], b1[5], col);
      this.vertex(a0[0], a0[1], a0[2], a0[3], a0[4], a0[5], col);
      this.vertex(b1[0], b1[1], b1[2], b1[3], b1[4], b1[5], col);
      this.vertex(a1[0], a1[1], a1[2], a1[3], a1[4], a1[5], col);
    }
    var cap = capCol || col;
    if (r1 > 0) {
      for (var k = 0; k < seg; k++) {
        var q0 = ring1[k], q1 = ring1[k + 1];
        this.vertex(p1[0], p1[1], p1[2], ax, ay, az, cap);
        this.vertex(q0[0], q0[1], q0[2], ax, ay, az, cap);
        this.vertex(q1[0], q1[1], q1[2], ax, ay, az, cap);
      }
    }
    if (r0 > 0) {
      for (var m = 0; m < seg; m++) {
        var s0 = ring0[m], s1 = ring0[m + 1];
        this.vertex(p0[0], p0[1], p0[2], -ax, -ay, -az, cap);
        this.vertex(s1[0], s1[1], s1[2], -ax, -ay, -az, cap);
        this.vertex(s0[0], s0[1], s0[2], -ax, -ay, -az, cap);
      }
    }
  };
  MeshBuilder.prototype.sphere = function (cx, cy, cz, r, seg, rings, col, squashY) {
    var sy = squashY || 1;
    for (var j = 0; j < rings; j++) {
      var v0 = (j / rings) * Math.PI, v1 = ((j + 1) / rings) * Math.PI;
      for (var i = 0; i < seg; i++) {
        var u0 = (i / seg) * Math.PI * 2, u1 = ((i + 1) / seg) * Math.PI * 2;
        var pts = [];
        var uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (var k = 0; k < 4; k++) {
          var u = uv[k][0], v = uv[k][1];
          var nx = Math.sin(v) * Math.cos(u), ny = Math.cos(v), nz = Math.sin(v) * Math.sin(u);
          pts.push([cx + nx * r, cy + ny * r * sy, cz + nz * r, nx, ny / sy, nz]);
        }
        for (var t = 0; t < 3; t++) {
          var p = pts[t];
          this.vertex(p[0], p[1], p[2], p[3], p[4], p[5], col);
        }
      }
    }
  };
  MeshBuilder.prototype.disc = function (cx, cy, cz, r, seg, col) {
    for (var i = 0; i < seg; i++) {
      var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.vertex(cx, cy, cz, 0, 1, 0, col);
      this.vertex(cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r, 0, 1, 0, col);
      this.vertex(cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r, 0, 1, 0, col);
    }
  };
  MeshBuilder.prototype.rectY = function (x0, z0, x1, z1, y, col) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col);
  };
  MeshBuilder.prototype.build = function () {
    return { data: new Float32Array(this.data), count: this.data.length / 9 };
  };

  // ------------------------------------------------------------- renderer
  var VS = [
    '#version 300 es',
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec3 aNormal;',
    'layout(location = 2) in vec3 aColor;',
    'uniform mat4 uProj, uView, uModel;',
    'uniform mat3 uNormalMat;',
    'out vec3 vNormal; out vec3 vColor; out vec3 vWorld;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vWorld = wp.xyz;',
    '  vNormal = uNormalMat * aNormal;',
    '  vColor = aColor;',
    '  gl_Position = uProj * uView * wp;',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNormal; in vec3 vColor; in vec3 vWorld;',
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;',
    'uniform vec3 uFogColor; uniform float uFogDensity;',
    'uniform vec3 uCameraPos; uniform vec3 uTint;',
    'uniform float uUnlit; uniform float uAlpha;',
    'out vec4 outColor;',
    'void main(){',
    '  vec3 base = vColor * uTint;',
    '  vec3 col;',
    '  if(uUnlit > 0.5){ col = base; }',
    '  else {',
    '    vec3 n = normalize(vNormal);',
    '    float ndl = max(dot(n, normalize(uSunDir)), 0.0);',
    '    vec3 viewDir = normalize(uCameraPos - vWorld);',
    '    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.05;',
    '    float sky = 0.5 + 0.5 * n.y;',
    '    col = base * (uAmbient * (0.65 + 0.35 * sky) + uSunColor * ndl) + vec3(rim);',
    '  }',
    '  float dist = length(vWorld - uCameraPos);',
    '  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);',
    '  col = mix(col, uFogColor, clamp(fog, 0.0, 0.95));',
    '  outColor = vec4(col, uAlpha);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader error: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.canvas = canvas;
    this.gl = gl;
    this.dpr = 1;
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(this.program));
    }
    this.loc = {};
    var self = this;
    ['uProj', 'uView', 'uModel', 'uNormalMat', 'uSunDir', 'uSunColor', 'uAmbient',
      'uFogColor', 'uFogDensity', 'uCameraPos', 'uTint', 'uUnlit', 'uAlpha'].forEach(function (name) {
      self.loc[name] = gl.getUniformLocation(self.program, name);
    });
    this.meshCache = [];
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.6, 0.75, 0.9, 1);
    this.identity = M4.identity();
    this.normalMat = new Float32Array(9);
  }

  Renderer.prototype.upload = function (mesh) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    var stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.bindVertexArray(null);
    var out = { vao: vao, vbo: vbo, count: mesh.count };
    this.meshCache.push(out);
    return out;
  };

  Renderer.prototype.freeMesh = function (mesh) {
    if (!mesh) return;
    this.gl.deleteBuffer(mesh.vbo);
    this.gl.deleteVertexArray(mesh.vao);
  };

  Renderer.prototype.resize = function (w, h, dpr) {
    var gl = this.gl;
    this.dpr = dpr || 1;
    var W = Math.max(1, Math.round(w * this.dpr));
    var H = Math.max(1, Math.round(h * this.dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    this.width = W;
    this.height = H;
  };

  Renderer.prototype.beginFrame = function (cam) {
    var gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.loc.uProj, false, cam.proj);
    gl.uniformMatrix4fv(this.loc.uView, false, cam.view);
    gl.uniform3fv(this.loc.uSunDir, cam.sunDir);
    gl.uniform3fv(this.loc.uSunColor, cam.sunColor);
    gl.uniform3fv(this.loc.uAmbient, cam.ambient);
    gl.uniform3fv(this.loc.uFogColor, cam.fogColor);
    gl.uniform1f(this.loc.uFogDensity, cam.fogDensity);
    gl.uniform3fv(this.loc.uCameraPos, cam.eye);
    this.frame = cam;
  };

  Renderer.prototype.draw = function (mesh, model, opts) {
    if (!mesh) return;
    opts = opts || {};
    var gl = this.gl;
    var modelMat = model || this.identity;
    gl.uniformMatrix4fv(this.loc.uModel, false, modelMat);
    var nm = this.normalMat;
    nm[0] = modelMat[0]; nm[1] = modelMat[1]; nm[2] = modelMat[2];
    nm[3] = modelMat[4]; nm[4] = modelMat[5]; nm[5] = modelMat[6];
    nm[6] = modelMat[8]; nm[7] = modelMat[9]; nm[8] = modelMat[10];
    gl.uniformMatrix3fv(this.loc.uNormalMat, false, nm);
    gl.uniform3fv(this.loc.uTint, opts.tint || WHITE);
    gl.uniform1f(this.loc.uUnlit, opts.unlit ? 1 : 0);
    gl.uniform1f(this.loc.uAlpha, opts.alpha == null ? 1 : opts.alpha);
    if (this.frame) {
      gl.uniform1f(this.loc.uFogDensity, this.frame.fogDensity * (opts.fog == null ? 1 : opts.fog));
    }
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  };

  Renderer.prototype.setBlend = function (on) {
    var gl = this.gl;
    if (on) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
  };

  Renderer.prototype.setDepthWrite = function (on) {
    this.gl.depthMask(!!on);
  };

  Renderer.prototype.setDepthTest = function (on) {
    if (on) this.gl.enable(this.gl.DEPTH_TEST); else this.gl.disable(this.gl.DEPTH_TEST);
  };

  var WHITE = new Float32Array([1, 1, 1]);
  var ONE = new Float32Array([1, 1, 1]);

  GEO.GL = {
    M4: M4, MeshBuilder: MeshBuilder, Renderer: Renderer, projectPoint: projectPoint
  };
})(typeof window !== 'undefined' ? window : globalThis);
