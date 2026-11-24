/*
 * Injected only into the Capacitor www copy. The published static site does
 * not load this file. It tells the Android shell which day/night colors to
 * paint behind the status bar so the header buttons stay below the system UI.
 */
(function () {
  "use strict";

  var SAFE_AREA_CSS = [
    ".app-header {",
    "  padding-top: calc(7px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) !important;",
    "}",
    ".auth-page {",
    "  padding-top: calc(12px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) !important;",
    "}",
  ].join("\n");

  function mode() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function ensureSafeAreaStyle() {
    if (document.getElementById("android-shell-safe-area")) return;
    var style = document.createElement("style");
    style.id = "android-shell-safe-area";
    style.textContent = SAFE_AREA_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function apply() {
    ensureSafeAreaStyle();
    var bridge = window.KoreanSiteAndroid;
    if (bridge && typeof bridge.setMode === "function") {
      try { bridge.setMode(mode()); } catch (error) { /* native chrome is optional */ }
    }
    var plugins = window.Capacitor && window.Capacitor.Plugins;
    var bars = plugins && plugins.SystemBars;
    if (bars && typeof bars.setStyle === "function") {
      try {
        var pending = bars.setStyle({ style: mode() === "dark" ? "DARK" : "LIGHT" });
        if (pending && typeof pending.catch === "function") pending.catch(function () {});
      } catch (error) { /* WebView still lays out below the status bar via CSS or native padding. */ }
    }
  }

  function boot() {
    apply();
    if (typeof MutationObserver !== "function") return;
    try {
      new MutationObserver(apply).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    } catch (error) {
      /* The first apply() still ran. */
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("load", apply);
})();
