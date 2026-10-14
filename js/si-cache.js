/* si-cache.js - Inventory Intel saved-data storage layer (IndexedDB).
 * Plain classic script. Public surface: window.siCache only.
 * Every method NEVER rejects. Every IndexedDB step is bounded by a timeout so a stuck
 * database can never hang the page. Records are keyed "<uid>:<key>"; no signed-in user
 * means get -> null and put -> false (never stored under an anonymous key). */
(function () {
  'use strict';
  var DB_NAME = 'groovy-si-cache', STORE = 'records', VERSION = 1, TIMEOUT_MS = 5000;
  // A write's bound grows with its payload (an array's rows): committing a big record to disk on a phone can take well over 5 s while the
  // browser is still working normally. Ceiling 30 s so a truly stuck database still cannot hold anything for long.
  var PUT_BASE_MS = 5000, PUT_PER_ROW_MS = 4, PUT_MAX_MS = 30000;
  var _dbPromise = null, _broken = false;

  function _recordKey(uid, key) { return String(uid) + ':' + String(key); }

  function _uid() {
    try {
      if (typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid) return String(auth.currentUser.uid);
    } catch (e) {}
    return null;
  }
  function _idb() {
    try { return (typeof indexedDB !== 'undefined' && indexedDB) ? indexedDB : null; } catch (e) { return null; }
  }
  function _setErr(e, ctx) {
    var m = '';
    try { m = String((e && (e.name || e.message)) || e || 'error'); api.lastError = m; } catch (x) {}
    if (ctx) ctx.err = m; // this call's own reason: api.lastError is shared by every call in flight
  }
  // Resolve with fn's promise, or with `fallback` on throw / reject / timeout. Never rejects.
  function _bounded(p, fallback, ms, ctx) {
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () {
        if (!done) { done = true; _setErr('timeout', ctx); if (ctx) ctx.timedOut = true; resolve(fallback); }
      }, ms || TIMEOUT_MS);
      function fin(v) { if (!done) { done = true; clearTimeout(t); resolve(v); } }
      try { Promise.resolve(p).then(fin, function (e) { _setErr(e, ctx); fin(fallback); }); }
      catch (e) { _setErr(e, ctx); fin(fallback); }
    });
  }
  function _open() {
    if (_dbPromise) return _dbPromise;
    var idb = _idb();
    if (!idb) { _broken = true; return Promise.resolve(null); }
    var p = new Promise(function (resolve) {
      var req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { _setErr(e); resolve(null); return; }
      req.onupgradeneeded = function () {
        try { var db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); } catch (e) { _setErr(e); }
      };
      req.onsuccess = function () {
        var db = req.result;
        try { db.onversionchange = function () { try { db.close(); } catch (e) {} _dbPromise = null; }; } catch (e) {}
        try { db.onclose = function () { _dbPromise = null; }; } catch (e) {}
        resolve(db);
      };
      req.onerror = function () { _setErr(req.error); resolve(null); };
      req.onblocked = function () { _setErr('blocked'); resolve(null); };
    });
    _dbPromise = _bounded(p, null).then(function (db) {
      if (!db) { _dbPromise = null; } // forget failure so a later call can retry
      return db;
    });
    return _dbPromise;
  }
  // Run one transaction step; `fn(store, done, fail)`. Resolves value or `fallback`.
  function _tx(mode, fn, fallback, ms, ctx) {
    return _bounded(_open().then(function (db) {
      if (!db) return fallback;
      return new Promise(function (resolve) {
        var out = fallback, tx;
        try { tx = db.transaction(STORE, mode); } catch (e) { _setErr(e, ctx); _dbPromise = null; resolve(fallback); return; }
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function (ev) {
          var er = null;
          try { er = (ev && ev.target && ev.target.error) || tx.error; } catch (x) {}
          _setErr(er, ctx); resolve(fallback);
        };
        tx.onabort = function () { _setErr(tx.error || 'aborted', ctx); resolve(fallback); };
        try { fn(tx.objectStore(STORE), function (v) { out = v; }); }
        catch (e) { _setErr(e, ctx); try { tx.abort(); } catch (x) {} resolve(fallback); }
      });
    }), fallback, ms, ctx);
  }

  function available() { return !!_idb() && !_broken; }

  function get(key) {
    var uid = _uid();
    if (!uid) return Promise.resolve(null);
    var rk = _recordKey(uid, key);
    return _tx('readonly', function (st, set) {
      var r = st.get(rk);
      r.onsuccess = function () {
        var rec = r.result;
        if (rec && rec.v === VERSION && rec.uid === uid && typeof rec.savedAt === 'number') {
          set({ value: rec.value, savedAt: rec.savedAt, meta: rec.meta || {} });
        }
      };
    }, null).then(function (v) { return v || null; }, function () { return null; });
  }

  function _putOnce(rk, uid, key, value, meta, ms, ctx) {
    return _tx('readwrite', function (st, set) {
      st.put({ v: VERSION, uid: uid, key: String(key), value: value, meta: meta || {}, savedAt: Date.now() }, rk);
      set(true);
    }, false, ms, ctx);
  }
  // The bound for one write: 5 s plus 4 ms a row, never over 30 s; opts.timeoutMs overrides (still capped).
  function _budget(value, opts) {
    var ms = opts && opts.timeoutMs > 0 ? opts.timeoutMs : PUT_BASE_MS + (Array.isArray(value) ? value.length * PUT_PER_ROW_MS : 0);
    return Math.max(TIMEOUT_MS, Math.min(PUT_MAX_MS, ms));
  }
  // Remove this user's single oldest record (other than rk); returns count removed.
  function _evictOldest(uid, rk) {
    return _tx('readwrite', function (st, set) {
      var recs = [], c = st.openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (cur) {
          var rec = cur.value;
          if (rec && rec.uid === uid && cur.key !== rk) recs.push({ k: cur.key, at: rec.savedAt || 0 });
          cur.continue();
        } else {
          recs.sort(function (a, b) { return a.at - b.at; });
          if (recs.length) { st.delete(recs[0].k); set(1); } else set(0);
        }
      };
    }, 0);
  }

  // putDetailed -> Promise<{ok, timedOut, error}>, never rejects. A timeout means "no answer within the bound", NOT "the browser refused":
  // the commit may still land afterwards, so a caller must not report it as a failure.
  function putDetailed(key, value, meta, opts) {
    var uid = _uid();
    if (!uid) return Promise.resolve({ ok: false, timedOut: false, error: 'not signed in' });
    var rk = _recordKey(uid, key), ms = _budget(value, opts), c1 = {}, c2 = {};
    return _putOnce(rk, uid, key, value, meta, ms, c1).then(function (ok) {
      if (ok) return { ok: true, timedOut: false, error: '' };
      var q = /quota/i.test(String(c1.err || ''));
      if (!q) return { ok: false, timedOut: !!c1.timedOut, error: c1.err || '' };
      return _evictOldest(uid, rk).then(function () { return _putOnce(rk, uid, key, value, meta, ms, c2); }).then(function (ok2) {
        return { ok: !!ok2, timedOut: !!c2.timedOut, error: ok2 ? '' : (c2.err || c1.err || '') };
      });
    }).then(function (r) { return r; }, function () { return { ok: false, timedOut: false, error: 'error' }; });
  }
  function put(key, value, meta, opts) {
    return putDetailed(key, value, meta, opts).then(function (r) { return !!(r && r.ok); }, function () { return false; });
  }

  function del(key) {
    var uid = _uid();
    if (!uid) return Promise.resolve(false);
    return _tx('readwrite', function (st, set) { st.delete(_recordKey(uid, key)); set(true); }, false)
      .then(function (v) { return !!v; }, function () { return false; });
  }

  function clear() {
    return _tx('readwrite', function (st, set) { st.clear(); set(true); }, false)
      .then(function (v) { return !!v; }, function () { return false; });
  }

  function bytesApprox() {
    return _bounded(Promise.resolve().then(function () {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) { return (e && typeof e.usage === 'number') ? e.usage : null; });
      }
      return null;
    }), null).then(function (v) { return v === undefined ? null : v; }, function () { return null; });
  }

  var api = { VERSION: VERSION, lastError: '', available: available, get: get, put: put, del: del,
              clear: clear, bytesApprox: bytesApprox, _recordKey: _recordKey, putDetailed: putDetailed, _budget: _budget };
  try { window.siCache = api; } catch (e) {}
})();
