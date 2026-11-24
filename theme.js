/*
 * 동행 · Together · 同行 — shared day/night theme controller.
 *
 * Independent from the learning record. The only key touched here is
 * `koreanSite_theme_v1`; `koreanSite_zhcn_draft_v01` is never read or written.
 */
(function () {
  "use strict";

  var THEME_KEY = "koreanSite_theme_v1";
  var DRAG_SLOP = 10;           // px before a gesture is treated as a drag
  var SWITCH_FLICK = 0.27;      // same flick ratio as the verified FAQ reference
  var root = document.documentElement;
  var mounts = [];
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var ready = false;

  function storedTheme() {
    try {
      var value = localStorage.getItem(THEME_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function systemTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function currentMode() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function posFor(mode) {
    return mode === "light" ? 1 : 0;
  }

  function clamp(n) {
    return Math.min(1, Math.max(0, n));
  }

  function readPos(sw) {
    var raw = sw ? sw.style.getPropertyValue("--pos") : "";
    var n = parseFloat(raw);
    if (Number.isFinite(n)) return clamp(n);
    return posFor(currentMode());
  }

  function updateMeta(mode) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute("content", mode === "dark" ? "#070c11" : "#f2ebdd");
  }

  function paint(mode, pos, persist) {
    var nextMode = mode === "dark" ? "dark" : "light";
    var nextPos = clamp(Number.isFinite(pos) ? pos : posFor(nextMode));
    root.setAttribute("data-theme", nextMode);
    root.style.colorScheme = nextMode;
    root.style.setProperty("--pos", String(nextPos));
    updateMeta(nextMode);
    mounts.forEach(function (sw) {
      sw.style.setProperty("--pos", String(nextPos));
      sw.setAttribute("aria-checked", nextMode === "light" ? "true" : "false");
      sw.setAttribute("data-mode", nextMode);
    });
    if (persist) {
      try { localStorage.setItem(THEME_KEY, nextMode); } catch (error) { /* private mode */ }
    }
    try {
      window.dispatchEvent(new CustomEvent("koreansthemechange", {
        detail: { mode: nextMode, pos: nextPos, persisted: !!persist }
      }));
    } catch (error) { /* older engines */ }
    return nextPos;
  }

  function toggle(persist) {
    var next = currentMode() === "light" ? "dark" : "light";
    paint(next, posFor(next), persist !== false);
  }

  function moonSvg() {
    /* A dense dot-matrix crescent: 1px dots clipped by a crescent mask. */
    return '<svg class="pix moon" viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<pattern id="themeMoonDots" width="1.62" height="1.62" patternUnits="userSpaceOnUse">'
      + '<rect width=".86" height=".86" fill="currentColor"></rect>'
      + '</pattern>'
      + '<mask id="themeMoonMask" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">'
      + '<rect width="24" height="24" fill="#000"></rect>'
      + '<circle cx="11.1" cy="12" r="8.35" fill="#fff"></circle>'
      + '<circle cx="15.9" cy="9.1" r="7.35" fill="#000"></circle>'
      + '</mask>'
      + '</defs>'
      + '<g shape-rendering="crispEdges">'
      + '<rect width="24" height="24" fill="url(#themeMoonDots)" mask="url(#themeMoonMask)"></rect>'
      + '<g class="dim" fill="currentColor">'
      + '<rect x="18" y="6.4" width="1.05" height="1.05"></rect>'
      + '<rect x="16.2" y="4.2" width="1.05" height="1.05"></rect>'
      + '<rect x="20.2" y="9.2" width="1.05" height="1.05"></rect>'
      + '<rect x="19.4" y="15.2" width="1.05" height="1.05"></rect>'
      + '<rect x="17.6" y="18.2" width="1.05" height="1.05"></rect>'
      + '<rect x="14.2" y="19.6" width="1.05" height="1.05"></rect>'
      + '</g>'
      + '</g>'
      + '</svg>';
  }

  function sunSvg() {
    /* Dense dark dotted square core with dotted rays at the eight compass points. */
    return '<svg class="pix sun" viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<pattern id="themeSunDots" width="1.74" height="1.74" patternUnits="userSpaceOnUse">'
      + '<rect width=".98" height=".98" fill="currentColor"></rect>'
      + '</pattern>'
      + '</defs>'
      + '<g shape-rendering="crispEdges" fill="currentColor">'
      + '<rect x="6.6" y="6.6" width="10.8" height="10.8" fill="url(#themeSunDots)"></rect>'
      + '<rect x="11.35" y="1.4" width="1.3" height="1.3"></rect>'
      + '<rect x="11.35" y="3.6" width="1.3" height="1.3"></rect>'
      + '<rect x="11.35" y="19.1" width="1.3" height="1.3"></rect>'
      + '<rect x="11.35" y="21.3" width="1.3" height="1.3"></rect>'
      + '<rect x="1.4" y="11.35" width="1.3" height="1.3"></rect>'
      + '<rect x="3.6" y="11.35" width="1.3" height="1.3"></rect>'
      + '<rect x="19.1" y="11.35" width="1.3" height="1.3"></rect>'
      + '<rect x="21.3" y="11.35" width="1.3" height="1.3"></rect>'
      + '<rect x="4.1" y="4.1" width="1.3" height="1.3"></rect>'
      + '<rect x="2.5" y="2.5" width="1.3" height="1.3"></rect>'
      + '<rect x="18.6" y="4.1" width="1.3" height="1.3"></rect>'
      + '<rect x="20.2" y="2.5" width="1.3" height="1.3"></rect>'
      + '<rect x="4.1" y="18.6" width="1.3" height="1.3"></rect>'
      + '<rect x="2.5" y="20.2" width="1.3" height="1.3"></rect>'
      + '<rect x="18.6" y="18.6" width="1.3" height="1.3"></rect>'
      + '<rect x="20.2" y="20.2" width="1.3" height="1.3"></rect>'
      + '</g>'
      + '</svg>';
  }

  function switchMarkup() {
    return '<button type="button" role="switch" class="theme-switch" aria-checked="false"'
      + ' aria-label="切换日间/夜间模式" title="切换日间/夜间模式">'
      + '<span class="theme-track" aria-hidden="true"><span class="theme-thumb">'
      + moonSvg() + sunSvg()
      + '</span></span></button>';
  }

  function setTravel(sw) {
    var track = sw.querySelector(".theme-track");
    var thumb = sw.querySelector(".theme-thumb");
    if (!track || !thumb) return;
    var travel = Math.max(1, track.clientWidth - thumb.offsetWidth - 6);
    sw.style.setProperty("--travel", travel + "px");
  }

  function finishDrag(sw, state) {
    if (!state) return;
    var startPos = state.startPos;
    var startMode = state.startMode;
    var pos = readPos(sw);
    var travel = parseFloat(sw.style.getPropertyValue("--travel")) || 30;
    sw.classList.remove("dragging");
    if (state.scroll || !state.active) return;
    var toward = startPos < 0.5 ? pos - startPos : startPos - pos;
    var flicked = toward * travel >= Math.max(10, travel * SWITCH_FLICK);
    if (flicked) {
      var next = startPos < 0.5 ? "light" : "dark";
      paint(next, posFor(next), true);
    } else {
      paint(startMode, posFor(startMode), true);
    }
  }

  function bindSwitch(sw) {
    var drag = null;
    var suppressClickUntil = 0;
    var suppressClick = false;
    var suppressTimer = 0;
    var cancelledGesture = false;

    function armIgnoreClick() {
      suppressClickUntil = Date.now() + 700;
    }
    function clearSuppress() {
      suppressClick = false;
      clearTimeout(suppressTimer);
    }
    function cancelDrag() {
      if (!drag) return;
      var state = drag;
      drag = null;
      sw.classList.remove("dragging");
      if (state.active) cancelledGesture = true;
      paint(state.startMode, posFor(state.startMode), false);
    }

    setTravel(sw);
    if (window.addEventListener) window.addEventListener("resize", function () { setTravel(sw); }, { passive: true });

    sw.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      clearSuppress();
      suppressClickUntil = 0;
      cancelledGesture = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startPos: readPos(sw),
        startMode: currentMode(),
        active: false,
        decided: false,
        scroll: false
      };
      try { sw.setPointerCapture(event.pointerId); } catch (error) { /* synthetic pointer */ }
    });

    sw.addEventListener("pointermove", function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.decided) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        drag.decided = true;
        if (Math.abs(dy) > Math.abs(dx)) {
          drag.scroll = true;
          return;
        }
        drag.active = true;
        sw.classList.add("dragging");
      }
      if (!drag.active || drag.scroll) return;
      if (event.cancelable) event.preventDefault();
      var travel = parseFloat(sw.style.getPropertyValue("--travel")) || 30;
      var next = clamp(drag.startPos + dx / travel);
      var mode = next >= 0.5 ? "light" : "dark";
      sw.style.setProperty("--pos", String(next));
      root.style.setProperty("--pos", String(next));
      root.setAttribute("data-theme", mode);
      root.style.colorScheme = mode;
      sw.setAttribute("aria-checked", mode === "light" ? "true" : "false");
      sw.setAttribute("data-mode", mode);
    }, { passive: false });

    sw.addEventListener("pointerup", function (event) {
      if (!drag || event.pointerId !== drag.id) {
        if (cancelledGesture) {
          cancelledGesture = false;
          armIgnoreClick();
        }
        return;
      }
      var state = drag;
      drag = null;
      var wasActive = state.active && !state.scroll;
      if (wasActive) {
        armIgnoreClick();
        finishDrag(sw, state);
      } else {
        sw.classList.remove("dragging");
        // A vertical scroll that started on the switch must not become a tap.
        if (state.scroll) armIgnoreClick();
      }
    });

    sw.addEventListener("pointercancel", function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      cancelDrag();
      armIgnoreClick();
    });

    sw.addEventListener("click", function (event) {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        return;
      }
      if (suppressClick) {
        event.preventDefault();
        return;
      }
      toggle(true);
    });

    sw.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        paint("dark", 0, true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        paint("light", 1, true);
      } else if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        suppressClick = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(clearSuppress, 400);
        toggle(true);
      } else if (event.key === "Escape" && drag) {
        event.preventDefault();
        cancelDrag();
      }
    });

    sw.addEventListener("lostpointercapture", function (event) {
      if (event.target !== sw || !drag || event.pointerId !== drag.id) return;
      cancelDrag();
      armIgnoreClick();
    });
  }

  function init() {
    if (ready) return;
    ready = true;
    var saved = storedTheme();
    var initial = saved || (root.getAttribute("data-theme") === "dark" || root.getAttribute("data-theme") === "light"
      ? currentMode()
      : systemTheme());
    paint(initial, posFor(initial), false);
    mounts = Array.prototype.slice.call(document.querySelectorAll("[data-theme-switch]"));
    mounts.forEach(function (mount) {
      if (mount.querySelector(".theme-switch")) return;
      mount.innerHTML = switchMarkup();
    });
    mounts = Array.prototype.slice.call(document.querySelectorAll(".theme-switch"));
    mounts.forEach(bindSwitch);
    paint(currentMode(), posFor(currentMode()), false);
  }

  function onStorage(event) {
    if (event.key !== THEME_KEY && event.key !== null) return;
    var saved = storedTheme();
    if (saved) paint(saved, posFor(saved), false);
    else paint(systemTheme(), posFor(systemTheme()), false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  window.addEventListener("storage", onStorage);
  if (media) {
    var onSystem = function () {
      if (storedTheme()) return;
      paint(systemTheme(), posFor(systemTheme()), false);
    };
    if (media.addEventListener) media.addEventListener("change", onSystem);
    else if (media.addListener) media.addListener(onSystem);
  }

  window.KoreanTheme = {
    key: THEME_KEY,
    get: currentMode,
    set: function (mode) { paint(mode, posFor(mode), true); },
    toggle: function () { toggle(true); },
    paint: paint,
    refresh: init
  };
})();
