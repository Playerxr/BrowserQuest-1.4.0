
define(['text!../config/config_build.json'],
function(build) {
    // L'hôte et le port sont déduits dynamiquement de l'URL de la page (ou port 8000 par défaut)
    var host = window.location.hostname || "localhost";
    var defaultPort = window.location.port ? parseInt(window.location.port, 10) :
        (window.location.protocol === "https:" ? 443 : 8000);
    var dynamic = function() {
        return { host: host, port: defaultPort, dispatcher: false };
    };

    var config = {
        dev: dynamic(),
        build: dynamic(),
        local: dynamic()
    };

    return config;
});
