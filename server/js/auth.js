var crypto = require('crypto'),
    Utils = require('./utils');

var MAX_PASSWORD_LENGTH = 256,
    KEY_LENGTH = 64,
    SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function isValidPassword(password) {
    return typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD_LENGTH;
}

function derive(password, salt, callback) {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, callback);
}

function hash(password, mode, callback) {
    if(!isValidPassword(password)) {
        process.nextTick(function() { callback(new Error('Invalid password length')); });
        return;
    }
    crypto.randomBytes(16, function(error, salt) {
        if(error) return callback(error);
        derive(password, salt, function(error, key) {
            callback(error, error ? undefined : 'scrypt$' + mode + '$' + salt.toString('hex') + '$' + key.toString('hex'));
        });
    });
}

function legacyPassword(password) {
    // Old accounts stored this transformed, truncated value. Keep that behavior
    // only for migrated accounts so their existing credentials keep working.
    return Utils.sanitize(password).trim().substr(0, 15);
}

function sameText(first, second) {
    return crypto.timingSafeEqual(
        crypto.createHash('sha256').update(first).digest(),
        crypto.createHash('sha256').update(second).digest()
    );
}

module.exports = {
    MAX_PASSWORD_LENGTH: MAX_PASSWORD_LENGTH,
    isValidPassword: isValidPassword,

    // callback(error, encodedHash); hashing runs on the crypto worker pool.
    hashPassword: function(password, callback) {
        hash(password, '1', callback);
    },

    // callback(error, matches, migratedHash). Persist migratedHash on success.
    verifyPassword: function(password, stored, callback) {
        if(!isValidPassword(password) || typeof stored !== 'string') {
            process.nextTick(function() { callback(null, false); });
            return;
        }

        // A historical plaintext password is at most 15 characters and may
        // itself start with "scrypt$". Encoded hashes are always much longer.
        if(stored.length > 15 && stored.indexOf('scrypt$') === 0) {
            var parts = stored.split('$');
            if(parts.length !== 4 || (parts[1] !== '1' && parts[1] !== 'legacy') ||
               !/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{128}$/.test(parts[3])) {
                process.nextTick(function() { callback(null, false); });
                return;
            }
            var candidate = parts[1] === 'legacy' ? legacyPassword(password) : password;
            derive(candidate, Buffer.from(parts[2], 'hex'), function(error, key) {
                callback(error, !error && crypto.timingSafeEqual(key, Buffer.from(parts[3], 'hex')));
            });
            return;
        }

        var legacyCandidate = legacyPassword(password);
        if(!sameText(legacyCandidate, stored)) {
            process.nextTick(function() { callback(null, false); });
            return;
        }
        hash(legacyCandidate, 'legacy', function(error, encoded) {
            callback(error, !error, encoded);
        });
    }
};
