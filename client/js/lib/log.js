
var Logger = function(level) {
    this.level = level;
};

Logger.prototype.info = function(message) {
    if(window.console) console.info(message);
};

Logger.prototype.debug = function(message) {
    if(window.console) console.log(message);
};

Logger.prototype.error = function(message, stacktrace) {
    if(window.console) {
        console.error(message);
        if(stacktrace && typeof printStackTrace === 'function') {
            console.error(printStackTrace().join('\n\n'));
        }
    }
};

log = new Logger("debug");
if(typeof window !== "undefined") {
    window.log = log;
}