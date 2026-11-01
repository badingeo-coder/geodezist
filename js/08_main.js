/**
 * 08_main.js — запуск приложения.
 */
(function (root) {
  'use strict';
  function boot() {
    var GEO = root.GEO;
    try {
      var game = new GEO.Game();
      root.game = game;
      root.GEO.game = game;
      // QA/демо-режим: ?level=level_01 разворачивает площадку без кликов.
      var params = new URLSearchParams(root.location && root.location.search || '');
      var qaLevel = params.get('level');
      if (qaLevel) {
        setTimeout(function () {
          try {
            game.startLevel(qaLevel);
            var view = params.get('view');
            if (view === 'setup') {
              game.player.x = 0;
              game.player.z = 2;
              game.interact();
              game.ui.setLockHint(false);
              return;
            }
            if (view === 'scope' || view === 'results') {
              game.player.x = 0;
              game.player.z = 2;
              game.interact();
              game.acceptLeveling(true);
              var lvl = game.level;
              game.applyStationData({
                x: lvl.station.x, y: lvl.station.y, z: lvl.station.z,
                hi: lvl.instrumentHeight, bsX: lvl.backsight.x, bsY: lvl.backsight.y
              });
              var bs = game.session.engine.trueAngles(game.currentTarget(lvl.backsight.id));
              game.session.aim.az = bs.ha;
              game.session.aim.za = bs.za;
              game.updateCapture();
              game.orientCurrent();
              var t = (game.level.targets.filter(function (x) { return x.kind === 'survey'; })[0] || game.level.targets[0]);
              var pt = game.session.engine.trueAngles(game.currentTarget(t.id));
              game.session.aim.az = pt.ha;
              game.session.aim.za = pt.za;
              game.session.zoom = 10;
              game.updateCapture();
              if (game.captured) game.session.focus = game.captured.sd;
              game.ui.setLockHint(false);
              game.update();
              setTimeout(function () { game.ui.setLockHint(false); }, 1500);
              if (view === 'results') {
                game.measureCurrent();
                game.finishLevel();
              }
            }
          } catch (e) { console.error(e); }
        }, 250);
      }
    } catch (err) {
      console.error(err);
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#070c10;color:#dcecf0;font-family:Segoe UI,sans-serif;padding:24px;text-align:center;z-index:999';
      box.innerHTML = '<div><div style="font-size:22px;margin-bottom:10px">Не удалось запустить 3D-сцену</div>' +
        '<div style="color:#86a1a9;font-size:13px;line-height:1.6;max-width:560px">' +
        'Симулятору нужен браузер с поддержкой WebGL2 (Edge, Chrome, Firefox). ' +
        'Попробуйте обновить браузер или включить аппаратное ускорение.<br><br>' +
        '<span style="font-family:Consolas,monospace;font-size:11px;color:#ff9f95">' + String(err && err.message || err) + '</span></div></div>';
      document.body.appendChild(box);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
