var exists, existsSync;
(function () {
    // Les versions modernes de Node.js fournissent fs.exists / fs.existsSync (plus besoin de semver).
    var module = require('fs');

    exists = module.exists;
    existsSync = module.existsSync;
})();

if (!(typeof exports === 'undefined')) {
    module.exports.exists = exists;
    module.exports.existsSync = existsSync;
}
