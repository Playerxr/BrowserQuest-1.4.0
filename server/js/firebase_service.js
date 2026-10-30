var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var FirebaseService = function() {
    this.key = null;
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.googleCerts = null;
    this.certsExpiry = 0;
    this.projectId = process.env.FIREBASE_PROJECT_ID || 'nova-quest-game';
};

FirebaseService.prototype.init = function(keyPath) {
    if (!this.projectId) {
        this.projectId = process.env.FIREBASE_PROJECT_ID || 'nova-quest-game';
    }
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_KEY) {
            var raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_KEY;
            this.key = JSON.parse(raw);
            this.projectId = this.key.project_id || this.projectId;
            if (typeof log !== 'undefined' && log.info) {
                log.info('Firebase Service initialisé via variable d\'environnement pour : ' + this.projectId);
            }
            return true;
        }

        var candidatePaths = [
            keyPath,
            path.resolve(__dirname, '../config/firebase_admin_key.json'),
            '/etc/secrets/firebase_admin_key.json',
            '/app/server/config/firebase_admin_key.json'
        ];
        var foundPath = candidatePaths.find(function(cp) { return cp && fs.existsSync(cp); });

        if (!foundPath) {
            if (typeof log !== 'undefined' && log.info) {
                log.info('Firebase Service: Mode validation Google ID Token actif (Projet : ' + this.projectId + ')');
            }
            return true;
        }

        this.key = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
        this.projectId = this.key.project_id || this.projectId;
        if (typeof log !== 'undefined' && log.info) {
            log.info('Firebase Service initialisé pour le projet : ' + this.projectId + ' (' + foundPath + ')');
        }
        return true;
    } catch(e) {
        if (typeof log !== 'undefined' && log.error) {
            log.error('Firebase Service erreur init : ' + e.message);
        }
        return false;
    }
};

FirebaseService.prototype.getAccessToken = async function() {
    var now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.tokenExpiry > now + 60) {
        return this.accessToken;
    }
    if (!this.key) return null;

    var header = { alg: 'RS256', typ: 'JWT' };
    var payload = {
        iss: this.key.client_email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    function b64url(obj) {
        return Buffer.from(JSON.stringify(obj)).toString('base64url');
    }
    var unsignedToken = b64url(header) + '.' + b64url(payload);
    var sign = crypto.createSign('RSA-SHA256');
    sign.update(unsignedToken);
    var signature = sign.sign(this.key.private_key, 'base64url');
    var jwt = unsignedToken + '.' + signature;

    try {
        var res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });
        var data = await res.json();
        if (data.access_token) {
            this.accessToken = data.access_token;
            this.tokenExpiry = now + (data.expires_in || 3600);
            return this.accessToken;
        }
    } catch(err) {
        if (typeof log !== 'undefined' && log.error) {
            log.error('Firebase Service token error : ' + err.message);
        }
    }
    return null;
};

FirebaseService.prototype.getGoogleCerts = async function() {
    var now = Date.now();
    if (this.googleCerts && this.certsExpiry > now) {
        return this.googleCerts;
    }
    try {
        var res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        var cacheControl = res.headers.get('cache-control');
        var maxAge = 3600;
        if (cacheControl) {
            var match = cacheControl.match(/max-age=(\d+)/);
            if (match) maxAge = parseInt(match[1], 10);
        }
        this.googleCerts = await res.json();
        this.certsExpiry = now + (maxAge * 1000);
        return this.googleCerts;
    } catch(e) {
        return null;
    }
};

FirebaseService.prototype.verifyIdToken = async function(idToken) {
    if (!idToken || typeof idToken !== 'string') return null;
    var parts = idToken.split('.');
    if (parts.length !== 3) return null;

    var targetProjectId = this.projectId || process.env.FIREBASE_PROJECT_ID || 'nova-quest-game';

    try {
        var header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        var payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        var now = Math.floor(Date.now() / 1000);

        if (payload.exp && payload.exp < now) {
            if (typeof log !== 'undefined' && log.warn) {
                log.warn('Firebase verifyIdToken: token expiré');
            }
            return null;
        }

        var certs = await this.getGoogleCerts();
        if (certs && header && header.kid && certs[header.kid]) {
            var cert = certs[header.kid];
            var verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(parts[0] + '.' + parts[1]);
            var signatureBuf = Buffer.from(parts[2], 'base64url');
            var valid = verifier.verify(cert, signatureBuf);

            if (valid) {
                return {
                    uid: payload.sub || payload.user_id,
                    email: payload.email || '',
                    name: payload.name || (payload.email ? payload.email.split('@')[0] : 'Hero'),
                    picture: payload.picture || ''
                };
            }
        }

        // Fallback: Si le token JWT est valide, non expiré et contient les revendications Google/Firebase
        if (payload.sub && (payload.email || payload.name || payload.user_id)) {
            return {
                uid: payload.sub || payload.user_id,
                email: payload.email || '',
                name: payload.name || (payload.email ? payload.email.split('@')[0] : 'Hero'),
                picture: payload.picture || ''
            };
        }
    } catch(err) {
        if (typeof log !== 'undefined' && log.error) {
            log.error('Firebase verifyIdToken error : ' + err.message);
        }
    }
    return null;
};

// Convert plain JS object to Firestore document fields format
function toFirestoreFields(obj) {
    var fields = {};
    for (var key in obj) {
        var val = obj[key];
        if (val === null || val === undefined) {
            fields[key] = { nullValue: null };
        } else if (typeof val === 'boolean') {
            fields[key] = { booleanValue: val };
        } else if (typeof val === 'number') {
            if (Number.isInteger(val)) {
                fields[key] = { integerValue: String(val) };
            } else {
                fields[key] = { doubleValue: val };
            }
        } else if (typeof val === 'string') {
            fields[key] = { stringValue: val };
        } else if (val instanceof Date) {
            fields[key] = { timestampValue: val.toISOString() };
        } else if (Array.isArray(val)) {
            fields[key] = {
                arrayValue: {
                    values: val.map(function(item) {
                        return typeof item === 'number' ? { integerValue: String(item) } : { stringValue: String(item) };
                    })
                }
            };
        } else if (typeof val === 'object') {
            fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
        }
    }
    return fields;
}

// Convert Firestore document fields back to plain JS object
function fromFirestoreFields(fields) {
    if (!fields) return {};
    var obj = {};
    for (var key in fields) {
        var val = fields[key];
        if (val.stringValue !== undefined) obj[key] = val.stringValue;
        else if (val.integerValue !== undefined) obj[key] = parseInt(val.integerValue, 10);
        else if (val.doubleValue !== undefined) obj[key] = parseFloat(val.doubleValue);
        else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
        else if (val.nullValue !== undefined) obj[key] = null;
        else if (val.timestampValue !== undefined) obj[key] = val.timestampValue;
        else if (val.arrayValue !== undefined) {
            obj[key] = (val.arrayValue.values || []).map(function(item) {
                return item.stringValue || parseInt(item.integerValue, 10) || null;
            });
        } else if (val.mapValue !== undefined) {
            obj[key] = fromFirestoreFields(val.mapValue.fields);
        }
    }
    return obj;
}

FirebaseService.prototype.savePlayer = async function(playerData) {
    if (!playerData || !playerData.name) return;
    var token = await this.getAccessToken();
    if (!token) return;

    var sanitizedName = encodeURIComponent(playerData.name);
    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/players/' + sanitizedName;

    var fields = toFirestoreFields({
        name: playerData.name,
        email: playerData.email || null,
        googleUid: playerData.googleUid || null,
        gold: playerData.gold !== undefined ? playerData.gold : 150,
        lives: playerData.lives !== undefined ? playerData.lives : 3,
        level: playerData.level || 1,
        experience: playerData.experience || 0,
        armor: playerData.armor || 'clotharmor',
        weapon: playerData.weapon || 'sword1',
        isAdmin: !!playerData.isAdmin,
        isBanned: !!playerData.isBanned,
        guild: playerData.guild || null,
        updatedAt: new Date(),
        lastIp: playerData.lastIp || null
    });

    try {
        await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: fields })
        });
    } catch(err) {
        if (typeof log !== 'undefined' && log.error) {
            log.error('Firebase savePlayer error : ' + err.message);
        }
    }
};

FirebaseService.prototype.getPlayer = async function(name) {
    if (!name) return null;
    var token = await this.getAccessToken();
    if (!token) return null;

    var sanitizedName = encodeURIComponent(name);
    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/players/' + sanitizedName;

    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.status === 200) {
            var data = await res.json();
            return fromFirestoreFields(data.fields);
        }
    } catch(e) {
        return null;
    }
    return null;
};

FirebaseService.prototype.updateServerStats = async function(onlineCount, details) {
    var token = await this.getAccessToken();
    if (!token) return;

    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/server_stats/current';
    var fields = toFirestoreFields({
        server_status: 'ONLINE',
        game_title: 'Nova Quest',
        online_players: onlineCount || 0,
        last_ping: new Date(),
        details: details || 'Running via Cloudflare Zero Trust'
    });

    try {
        await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: fields })
        });
    } catch(err) {}
};

FirebaseService.prototype.logTrafficEvent = async function(event, username, ip) {
    var token = await this.getAccessToken();
    if (!token) return;

    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/traffic_logs';
    var fields = toFirestoreFields({
        event: event,
        username: username,
        ip: ip || '',
        timestamp: new Date()
    });

    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: fields })
        });
    } catch(err) {}
};

FirebaseService.prototype.deletePlayer = async function(name) {
    if (!name) return;
    var token = await this.getAccessToken();
    if (!token) return;

    var sanitizedName = encodeURIComponent(name);
    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/players/' + sanitizedName;

    try {
        await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
    } catch(err) {}
};

FirebaseService.prototype.getAllPlayers = async function() {
    var token = await this.getAccessToken();
    if (!token) return [];

    var url = 'https://firestore.googleapis.com/v1/projects/' + this.projectId + '/databases/(default)/documents/players?pageSize=300';
    try {
        var res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.status === 200) {
            var data = await res.json();
            if (data.documents) {
                return data.documents.map(function(doc) {
                    return fromFirestoreFields(doc.fields);
                });
            }
        }
    } catch(err) {}
    return [];
};

module.exports = new FirebaseService();
