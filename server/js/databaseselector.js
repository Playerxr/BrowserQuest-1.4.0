var path = require('path');

module.exports = function(config) {
    if(!config.database || config.database === 'sqlite' || config.database === 'memory') {
        return require(path.resolve(__dirname, 'database'));
    }
    return require(path.resolve(__dirname, 'db_providers', config.database));
};
