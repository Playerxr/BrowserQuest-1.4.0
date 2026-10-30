define(['text!../config/config_build.json'],
function(build) {
    var buildConfig = {};
    try {
        buildConfig = JSON.parse(build);
    } catch (e) {}

    var isCapacitorOrApk = (typeof window !== 'undefined') && Boolean(
        window.Capacitor ||
        window.IS_NOVA_MOBILE_APP ||
        (window.location && (
            window.location.protocol === 'capacitor:' ||
            window.location.protocol === 'file:' ||
            (window.location.hostname === 'localhost' && !window.location.port)
        ))
    );

    var prodHost = buildConfig.host || "quest.universnovastudio.online";
    var prodPort = buildConfig.port || 443;

    var host = isCapacitorOrApk ? prodHost : (window.location.hostname || prodHost);
    var isHttps = isCapacitorOrApk || (window.location && window.location.protocol === "https:") || buildConfig.ssl === true;
    var defaultPort = isCapacitorOrApk
        ? prodPort
        : (window.location && window.location.port ? parseInt(window.location.port, 10) : (window.location && window.location.protocol === "https:" ? 443 : 8000));

    var dynamic = function() {
        return {
            host: host,
            port: defaultPort,
            ssl: isHttps,
            dispatcher: false
        };
    };

    var config = {
        dev: dynamic(),
        build: dynamic(),
        local: dynamic()
    };

    return config;
});
