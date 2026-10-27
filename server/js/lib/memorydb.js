/**
 * Mini base de données en mémoire qui imite la partie de l'API `redis`
 * utilisée par BrowserQuest. Permet de jouer SANS installer Redis.
 * Les données sont sauvegardées dans server/data/db.json (persistance simple).
 */
var fs = require('fs');
var path = require('path');

var DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
var DATA_FILE = path.join(DATA_DIR, 'db.json');

function MemoryClient() {
    this.store = {};
    this._saveTimer = null;
    try {
        this.store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        this.store = {};
    }
}

MemoryClient.prototype._save = function () {
    var self = this;
    if (this._saveTimer) { return; }
    this._saveTimer = setTimeout(function () {
        self._saveTimer = null;
        try {
            if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); }
            fs.writeFileSync(DATA_FILE, JSON.stringify(self.store));
        } catch (e) { /* ignore */ }
    }, 1000);
    if (this._saveTimer.unref) { this._saveTimer.unref(); }
};

MemoryClient.prototype._hash = function (key) { return this.store[key] = this.store[key] || { t: 'h', v: {} }; };
MemoryClient.prototype._set = function (key) { return this.store[key] = this.store[key] || { t: 's', v: [] }; };
MemoryClient.prototype._zset = function (key) { return this.store[key] = this.store[key] || { t: 'z', v: {} }; };

// Opérations synchrones (retournent la valeur)
MemoryClient.prototype._ops = {
    auth: function () { return 'OK'; },
    get: function (c, k) { var e = c.store[k]; return e && e.t === 'k' ? e.v : null; },
    set: function (c, k, v) { c.store[k] = { t: 'k', v: String(v) }; c._save(); return 'OK'; },
    hget: function (c, k, f) { var e = c.store[k]; return e && e.v[f] !== undefined ? e.v[f] : null; },
    hset: function (c, k, f, v) { c._hash(k).v[f] = String(v); c._save(); return 1; },
    hdel: function (c, k, f) { var e = c.store[k]; if (e) { delete e.v[f]; c._save(); } return 1; },
    hincrby: function (c, k, f, n) {
        var h = c._hash(k).v;
        h[f] = String((parseInt(h[f], 10) || 0) + Number(n));
        c._save();
        return parseInt(h[f], 10);
    },
    sadd: function (c, k, m) {
        var s = c._set(k).v;
        if (s.indexOf(String(m)) === -1) { s.push(String(m)); c._save(); return 1; }
        return 0;
    },
    srem: function (c, k, m) {
        var s = c._set(k).v, i = s.indexOf(String(m));
        if (i !== -1) { s.splice(i, 1); c._save(); return 1; }
        return 0;
    },
    sismember: function (c, k, m) { var e = c.store[k]; return e && e.v.indexOf(String(m)) !== -1 ? 1 : 0; },
    smembers: function (c, k) { var e = c.store[k]; return e ? e.v.slice() : []; },
    srandmember: function (c, k) { var e = c.store[k]; return e && e.v.length ? e.v[Math.floor(Math.random() * e.v.length)] : null; },
    zrem: function (c, k, m) { var e = c.store[k]; if (e) { delete e.v[m]; c._save(); } return 1; },
    zscore: function (c, k, m) { var e = c.store[k]; return e && e.v[m] !== undefined ? String(e.v[m]) : null; },
    zrange: function (c, k, start, stop) {
        var e = c.store[k];
        var names = e ? Object.keys(e.v).sort(function (a, b) { return e.v[a] - e.v[b]; }) : [];
        start = parseInt(start, 10); stop = parseInt(stop, 10);
        if (start < 0) { start = names.length + start; }
        if (stop < 0) { stop = names.length + stop; }
        return names.slice(Math.max(start, 0), stop + 1);
    }
};

Object.keys(MemoryClient.prototype._ops).forEach(function (name) {
    MemoryClient.prototype[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        var result = this._ops[name].apply(null, [this].concat(args));
        if (cb) { process.nextTick(function () { cb(null, result); }); }
        return result;
    };
});

MemoryClient.prototype.multi = function () {
    var self = this, queue = [];
    var m = {
        exec: function (cb) {
            var results = queue.map(function (q) { return self._ops[q.name].apply(null, [self].concat(q.args)); });
            if (cb) { process.nextTick(function () { cb(null, results); }); }
        }
    };
    Object.keys(self._ops).forEach(function (name) {
        m[name] = function () { queue.push({ name: name, args: Array.prototype.slice.call(arguments) }); return m; };
    });
    return m;
};

exports.createClient = function () { return new MemoryClient(); };
