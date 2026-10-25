/**
 * The element selection and editing tool, injected into an app's preview frame
 * on demand (no build plugin, so it works for every template). Hover
 * highlights an element and a click selects it. A selected element can be:
 * - dragged among its siblings, or moved with Alt+Arrow keys or the toolbar;
 * - edited in place: double-click its text, or use the toolbar;
 * - sent to the chat with "Ask AI", as the selection tool always did.
 * ArrowUp/ArrowDown select the parent or go back; Escape steps out of an edit,
 * then the selection, then the tool.
 *
 * Every change is posted to the Atelier window as the full list of pending
 * edits, kept on `window.__atelierEdits` so re-injecting the tool (after "Ask
 * AI") doesn't lose track of them. The page is reloaded on save or discard,
 * which also undoes the DOM changes the framework doesn't know about.
 *
 * Component names come from each framework's development tooling: React fiber
 * owners, Vue's component instance (which also knows its .vue file), and
 * Angular's `ng.getOwningComponent`.
 *
 * The page script is plain JavaScript in a string rather than a stringified
 * function, so bundler helpers can't leak into it.
 */
import { PREVIEW_SELECT_MESSAGE as SELECT_MESSAGE } from "@shared/ipc";

/** Script for WebFrameMain.executeJavaScript. Idempotent: it replaces an earlier copy. */
export function selectorScript(enable: boolean): string {
  return `(${PAGE_SCRIPT})(${JSON.stringify(SELECT_MESSAGE)}, ${enable});`;
}

const PAGE_SCRIPT = String.raw`function (messageType, enable) {
  var w = window;
  if (w.__atelierSelect) w.__atelierSelect.stop();
  if (!enable) return true;

  var ACCENT = "#7774ff";
  function overlay(tag, style) {
    var el = document.createElement(tag);
    el.setAttribute("style", style);
    el.setAttribute("data-atelier-overlay", "");
    document.documentElement.appendChild(el);
    return el;
  }
  var box = overlay("div", "position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed " + ACCENT + ";background:rgba(119,116,255,.08);border-radius:3px;display:none");
  var label = overlay("div", "position:fixed;pointer-events:none;z-index:2147483647;background:#5b5fe9;color:#fff;font:600 11px/1.6 -apple-system,system-ui,sans-serif;padding:1px 7px;border-radius:4px;white-space:nowrap;display:none");
  var selBox = overlay("div", "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid " + ACCENT + ";border-radius:3px;box-shadow:0 0 0 4px rgba(119,116,255,.18);display:none");
  var drop = overlay("div", "position:fixed;pointer-events:none;z-index:2147483647;background:" + ACCENT + ";border-radius:2px;display:none");
  var bar = overlay("div", "position:fixed;z-index:2147483647;display:none;align-items:center;gap:2px;padding:3px;background:#18181b;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:500 12px/1 -apple-system,system-ui,sans-serif;color:#fafafa");
  var prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";

  var current = null;
  var selected = null;
  var trail = [];
  var editor = null;
  var press = null;
  var dragging = false;

  // Pending edits survive re-injection: text edits keyed by text node, moves by element.
  var edits = w.__atelierEdits || (w.__atelierEdits = { texts: new Map(), moves: new Map() });

  // App-relative source file where a fiber's element was created, or undefined
  // when it was created by a library (node_modules) or the build has no debug info.
  function appSource(fiber) {
    if (!fiber) return undefined;
    if (fiber._debugSource && fiber._debugSource.fileName) {
      var fn = String(fiber._debugSource.fileName);
      return fn.indexOf("/node_modules/") >= 0 ? undefined : fn;
    }
    var stack = fiber._debugStack && fiber._debugStack.stack;
    if (!stack) return undefined;
    var lines = String(stack).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = /\((https?:\/\/[^)\s]+?):\d+:\d+\)\s*$/.exec(lines[i]) || /at (https?:\/\/\S+?):\d+:\d+\s*$/.exec(lines[i]);
      if (!m) continue;
      var u;
      try { u = new URL(m[1]); } catch (e) { continue; }
      if (u.origin !== location.origin) continue;
      if (u.pathname.indexOf("/node_modules/") >= 0 || u.pathname.indexOf("/@") === 0) continue;
      return u.pathname.replace(/^\//, "");
    }
    return undefined;
  }

  function components(el) {
    var names = [];
    var file;
    function add(n) { if (n && names.indexOf(n) < 0 && names.length < 8) names.push(n); }
    // React: walk the fiber tree from the element up. Development builds record
    // where each element was created (React 19: _debugStack, React 18:
    // _debugSource); when they do, only components created in app code are
    // kept, which drops router and library internals.
    var fiberKey = Object.keys(el).find(function (k) { return k.indexOf("__reactFiber$") === 0; });
    if (fiberKey) {
      var hostFiber = el[fiberKey];
      file = appSource(hostFiber);
      var traced = hostFiber && (hostFiber._debugStack || hostFiber._debugSource);
      for (var f = hostFiber; f && names.length < 8; f = f["return"]) {
        var t = f.type;
        if (!t || typeof t === "string") continue;
        if (traced && !appSource(f)) continue;
        add(t.displayName || t.name || (t.render && t.render.name));
      }
    }
    // Vue 3: development builds keep __file on single-file components.
    for (var vc = el.__vueParentComponent; vc && names.length < 8; vc = vc.parent) {
      var vt = vc.type || {};
      if (!file && vt.__file) file = vt.__file;
      add(vt.name || vt.__name || (vt.__file && vt.__file.split("/").pop().replace(/\.vue$/, "")));
    }
    // Angular: development mode exposes window.ng.
    if (w.ng && w.ng.getOwningComponent) {
      try {
        for (var c = w.ng.getOwningComponent(el); c && names.length < 8; ) {
          add(c.constructor.name.replace(/^_+/, ""));
          var host = w.ng.getHostElement(c);
          c = host && host.parentElement ? w.ng.getOwningComponent(host.parentElement) : null;
        }
      } catch (e) {}
    }
    return { names: names, file: file };
  }

  function describe(el) {
    var cs = getComputedStyle(el);
    var styles = {};
    ["display", "position", "text-align", "justify-content", "align-items", "flex-direction", "gap", "margin", "padding", "width", "height", "font-size", "font-weight", "color", "background-color"].forEach(function (p) {
      var v = cs.getPropertyValue(p);
      if (v && v !== "normal" && v !== "none" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)") styles[p] = v;
    });
    var attributes = {};
    Array.prototype.forEach.call(el.attributes, function (a) {
      if (a.name === "class" || a.name === "id" || a.name === "style" || a.name.indexOf("data-v-") === 0 || a.name.indexOf("_ng") === 0) return;
      if (Object.keys(attributes).length < 12) attributes[a.name] = a.value.slice(0, 200);
    });
    var r = el.getBoundingClientRect();
    var comp = components(el);
    var html = el.outerHTML.replace(/\s+/g, " ");
    return {
      route: location.pathname + location.search,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.prototype.slice.call(el.classList, 0, 20),
      text: String(el.innerText != null ? el.innerText : el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
      attributes: attributes,
      html: html.length > 1500 ? html.slice(0, 1500) + "…" : html,
      styles: styles,
      components: comp.names,
      file: comp.file,
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) }
    };
  }

  function rectOf(el) { return el.getBoundingClientRect(); }
  function place(node, r, pad) {
    node.style.display = "block";
    node.style.left = (r.left - pad) + "px";
    node.style.top = (r.top - pad) + "px";
    node.style.width = (r.width + pad * 2) + "px";
    node.style.height = (r.height + pad * 2) + "px";
  }

  function show(el) {
    current = el;
    if (!el || el === selected || dragging || editor) { box.style.display = "none"; label.style.display = "none"; return; }
    var r = rectOf(el);
    place(box, r, 2);
    var owner = components(el).names[0];
    label.textContent = el.tagName.toLowerCase() + (owner ? " · " + owner : "") + "  " + Math.round(r.width) + "×" + Math.round(r.height);
    label.style.display = "block";
    label.style.left = Math.max(2, r.left - 2) + "px";
    label.style.top = (r.top > 24 ? r.top - 24 : r.bottom + 4) + "px";
  }

  // ---------------------------------------------------------------- selection and toolbar

  function button(text, title, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.setAttribute("data-atelier-overlay", "");
    b.setAttribute("style", "all:unset;cursor:pointer;padding:5px 8px;border-radius:5px;white-space:nowrap");
    b.addEventListener("mouseenter", function () { b.style.background = "rgba(255,255,255,.12)"; });
    b.addEventListener("mouseleave", function () { b.style.background = "none"; });
    b.__atelierAction = action;
    return b;
  }

  function textNodeIn(el, x, y) {
    if (x != null && document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(x, y);
      var n = range && range.startContainer;
      if (n && n.nodeType === 3 && n.data.trim() && el.contains(n)) return n;
    }
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) { return t.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
    });
    return walker.nextNode();
  }

  function siblingsOf(el) {
    return Array.prototype.filter.call(el.parentElement ? el.parentElement.children : [], function (c) {
      return !c.hasAttribute("data-atelier-overlay") && c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && c.tagName !== "TEMPLATE";
    });
  }
  function movable(el) {
    return el && el.parentElement && el.parentElement !== document.documentElement && el !== document.body && siblingsOf(el).length > 1;
  }

  function renderBar() {
    bar.textContent = "";
    if (!selected) { bar.style.display = "none"; selBox.style.display = "none"; return; }
    if (movable(selected)) {
      bar.appendChild(button("↑", "Move earlier (Alt+↑)", function () { moveBy(-1); }));
      bar.appendChild(button("↓", "Move later (Alt+↓)", function () { moveBy(1); }));
    }
    if (textNodeIn(selected)) bar.appendChild(button("Edit text", "Edit text (double-click)", function () { startEdit(textNodeIn(selected)); }));
    bar.appendChild(button("Ask AI", "Ask the AI to change this element", function () {
      window.parent.postMessage({ type: messageType, element: describe(selected) }, "*");
      stop();
    }));
    positionSelection();
  }

  function positionSelection() {
    if (!selected) return;
    if (!selected.isConnected) { select(null); return; }
    var r = rectOf(selected);
    place(selBox, r, 2);
    bar.style.display = "flex";
    var bh = bar.offsetHeight || 30;
    bar.style.left = Math.max(4, Math.min(r.left, innerWidth - bar.offsetWidth - 4)) + "px";
    bar.style.top = (r.top > bh + 10 ? r.top - bh - 8 : Math.min(r.bottom + 8, innerHeight - bh - 4)) + "px";
  }

  function select(el) {
    selected = el;
    box.style.display = "none";
    label.style.display = "none";
    renderBar();
  }

  // ---------------------------------------------------------------- edits

  function summary(el) {
    return {
      tag: el.tagName.toLowerCase(),
      classes: Array.prototype.slice.call(el.classList, 0, 6),
      text: String(el.innerText != null ? el.innerText : el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
    };
  }

  function post() {
    var list = [];
    edits.texts.forEach(function (t) {
      if (t.after.trim() !== t.before.trim()) list.push({ kind: "text", element: t.element, before: t.before, after: t.after });
    });
    edits.moves.forEach(function (m, el) {
      if (!el.isConnected || el.parentElement !== m.parentEl) return;
      var to = siblingsOf(el).indexOf(el);
      if (to === m.from) return;
      list.push({ kind: "move", element: m.element, parent: m.parent, from: m.from, to: to, orderBefore: m.orderBefore, orderAfter: siblingsOf(el).map(summary) });
    });
    window.parent.postMessage({ type: messageType, edits: list }, "*");
  }

  function recordMove(el) {
    if (edits.moves.has(el)) return;
    var sibs = siblingsOf(el);
    edits.moves.set(el, { parentEl: el.parentElement, element: describe(el), parent: describe(el.parentElement), from: sibs.indexOf(el), orderBefore: sibs.map(summary) });
  }

  function moveTo(el, ref, after) {
    if (ref === el) return;
    recordMove(el);
    el.parentElement.insertBefore(el, after ? ref.nextSibling : ref);
    post();
    positionSelection();
  }

  function moveBy(step) {
    if (!movable(selected)) return;
    var sibs = siblingsOf(selected);
    var i = sibs.indexOf(selected);
    var j = i + step;
    if (j < 0 || j >= sibs.length) return;
    moveTo(selected, sibs[j], step > 0);
  }

  function startEdit(node) {
    if (!node || editor) return;
    var host = node.parentElement;
    var range = document.createRange();
    range.selectNodeContents(node);
    var r = range.getBoundingClientRect();
    if (!r.width && !r.height) r = rectOf(host);
    var cs = getComputedStyle(host);
    var original = node.data;
    var lead = /^\s*/.exec(original)[0];
    var trail2 = /\s*$/.exec(original)[0];
    var ta = document.createElement("textarea");
    ta.setAttribute("data-atelier-overlay", "");
    ta.setAttribute("aria-label", "Edit text");
    ta.value = original.trim();
    var style = "position:fixed;z-index:2147483647;margin:0;resize:none;overflow:hidden;box-sizing:content-box;border:none;outline:2px solid " + ACCENT + ";outline-offset:2px;border-radius:2px;background:#fff;color:#18181b;padding:0;";
    ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-align"].forEach(function (p) { style += p + ":" + cs.getPropertyValue(p) + ";"; });
    ta.setAttribute("style", style);
    ta.style.left = r.left + "px";
    ta.style.top = r.top + "px";
    ta.style.width = Math.max(r.width + 16, 60) + "px";
    document.documentElement.appendChild(ta);
    function grow() { ta.style.height = "0px"; ta.style.height = ta.scrollHeight + "px"; }
    grow();
    ta.addEventListener("input", grow);
    ta.focus();
    ta.select();
    function finish(save) {
      if (!editor) return;
      editor = null;
      ta.remove();
      if (save && ta.value.trim() !== original.trim()) {
        var entry = edits.texts.get(node);
        if (!entry) {
          entry = { element: describe(host), before: original.trim() };
          edits.texts.set(node, entry);
        }
        entry.after = ta.value.trim();
        node.data = lead + ta.value.trim() + trail2;
        post();
      }
      positionSelection();
    }
    ta.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    ta.addEventListener("blur", function () { finish(true); });
    editor = { textarea: ta, finish: finish };
    box.style.display = "none";
    label.style.display = "none";
  }

  // ---------------------------------------------------------------- dragging

  function dropTarget(el, x, y) {
    var parent = el.parentElement;
    var cs = getComputedStyle(parent);
    var horizontal = (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) || /grid/.test(cs.display);
    var best = null;
    var bestDist = Infinity;
    siblingsOf(el).forEach(function (s) {
      if (s === el) return;
      var r = rectOf(s);
      var dx = Math.max(r.left - x, 0, x - r.right);
      var dy = Math.max(r.top - y, 0, y - r.bottom);
      var d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = { el: s, r: r }; }
    });
    if (!best) return null;
    var r = best.r;
    // In a grid, siblings on another row are ordered by row.
    var sameRow = y >= r.top && y <= r.bottom;
    var useX = horizontal && sameRow;
    var after = useX ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    return { ref: best.el, after: after, useX: useX, r: r };
  }

  function showDrop(t) {
    if (!t) { drop.style.display = "none"; return; }
    var r = t.r;
    drop.style.display = "block";
    if (t.useX) {
      drop.style.left = ((t.after ? r.right : r.left) - 2) + "px";
      drop.style.top = r.top + "px";
      drop.style.width = "3px";
      drop.style.height = r.height + "px";
    } else {
      drop.style.left = r.left + "px";
      drop.style.top = ((t.after ? r.bottom : r.top) - 2) + "px";
      drop.style.width = r.width + "px";
      drop.style.height = "3px";
    }
  }

  // ---------------------------------------------------------------- events

  function target(e) {
    var t = (e.composedPath && e.composedPath()[0]) || e.target;
    return t instanceof Element && !t.hasAttribute("data-atelier-overlay") ? t : null;
  }
  function inOverlay(e) {
    var t = (e.composedPath && e.composedPath()[0]) || e.target;
    return t instanceof Element && t.closest("[data-atelier-overlay]");
  }
  function swallow(e) {
    if (inOverlay(e)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  }

  function onPointerDown(e) {
    if (inOverlay(e)) return;
    swallow(e);
    if (editor) { editor.finish(true); return; }
    var t = target(e);
    if (selected && t && selected.contains(t) && movable(selected) && e.button === 0) {
      press = { x: e.clientX, y: e.clientY, el: selected, prevOpacity: selected.style.opacity };
    }
  }
  function onMove(e) {
    if (press) {
      if (!dragging && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 4) {
        dragging = true;
        press.el.style.opacity = "0.45";
        document.documentElement.style.cursor = "grabbing";
        bar.style.display = "none";
        box.style.display = "none";
        label.style.display = "none";
      }
      if (dragging) { press.target = dropTarget(press.el, e.clientX, e.clientY); showDrop(press.target); }
      return;
    }
    if (editor || inOverlay(e)) return;
    trail.length = 0;
    show(target(e));
  }
  function onPointerUp(e) {
    if (inOverlay(e)) return;
    swallow(e);
    if (!press) return;
    var p = press;
    press = null;
    if (!dragging) return;
    dragging = false;
    p.el.style.opacity = p.prevOpacity;
    document.documentElement.style.cursor = "crosshair";
    showDrop(null);
    if (p.target) moveTo(p.el, p.target.ref, p.target.after);
    lastDrag = Date.now();
    positionSelection();
  }
  var lastDrag = 0;
  function onClick(e) {
    var o = inOverlay(e);
    if (o) {
      var b = (e.composedPath && e.composedPath()[0]) || e.target;
      while (b && !b.__atelierAction && b !== bar) b = b.parentElement;
      if (b && b.__atelierAction) { e.preventDefault(); e.stopPropagation(); b.__atelierAction(); }
      return;
    }
    swallow(e);
    // The click that ends a drag doesn't select what's under the pointer.
    if (Date.now() - lastDrag < 300) return;
    var el = current || target(e);
    if (el) select(el);
  }
  function onDblClick(e) {
    if (inOverlay(e)) return;
    swallow(e);
    var el = target(e);
    if (!el) return;
    var node = textNodeIn(el, e.clientX, e.clientY);
    if (!node) return;
    select(node.parentElement);
    startEdit(node);
  }
  function onKey(e) {
    if (editor) return;
    if (e.key === "Escape") {
      swallow(e);
      if (selected) { select(null); return; }
      window.parent.postMessage({ type: messageType, cancelled: true }, "*");
      stop();
    } else if (selected && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      swallow(e); moveBy(-1);
    } else if (selected && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      swallow(e); moveBy(1);
    } else if (selected && e.key === "Enter") {
      swallow(e); startEdit(textNodeIn(selected));
    } else if (e.key === "ArrowUp") {
      var base = selected || current;
      if (base && base.parentElement && base.parentElement !== document.documentElement) {
        swallow(e);
        trail.push(base);
        if (selected) select(base.parentElement); else show(base.parentElement);
      }
    } else if (e.key === "ArrowDown" && trail.length) {
      swallow(e);
      var back = trail.pop();
      if (selected) select(back); else show(back);
    }
  }
  function onScroll() {
    show(current);
    positionSelection();
  }

  // Keep the app from reacting to presses while the tool is on.
  var swallowed = ["mousedown", "mouseup", "contextmenu", "auxclick"];
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onDblClick, true);
  swallowed.forEach(function (t) { window.addEventListener(t, swallow, true); });
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  // Pending edits may predate this copy of the tool.
  if (edits.texts.size || edits.moves.size) post();

  function stop() {
    if (editor) editor.finish(true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("dblclick", onDblClick, true);
    swallowed.forEach(function (t) { window.removeEventListener(t, swallow, true); });
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    [box, label, selBox, drop, bar].forEach(function (n) { n.remove(); });
    document.documentElement.style.cursor = prevCursor;
    delete w.__atelierSelect;
  }
  w.__atelierSelect = { stop: stop };
  return true;
}`;
