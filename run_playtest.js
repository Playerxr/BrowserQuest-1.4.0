const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Détection de l'IP Wi-Fi / LAN
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIp = getLocalIp();
console.log('----------------------------------------------------');
console.log('🚀 Démarrage du serveur Nova Quest...');
console.log('📱 Adresse réseau local (Wi-Fi) : http://' + localIp + ':8000');
console.log('----------------------------------------------------');

// 1. Démarrer le serveur de jeu Node
const serverProcess = spawn('node', ['server/js/main.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env: Object.assign({}, process.env, { BROWSERQUEST_TRUST_PROXY: 'true' })
});

serverProcess.on('exit', (code) => {
    console.error('⚠️ Le serveur de jeu s\'est arrêté avec le code :', code);
    process.exit(code || 0);
});

// 2. Démarrer le tunnel Cloudflare avec auto-reconnexion watchdog
let cloudflaredProcess = null;
let restartTimer = null;
let currentTunnelUrl = '';

function startCloudflareTunnel() {
    if (cloudflaredProcess) {
        try { cloudflaredProcess.kill('SIGKILL'); } catch(e) {}
        cloudflaredProcess = null;
    }

    const tokenFile = path.join(__dirname, 'cloudflare_token.txt');
    let token = process.env.CLOUDFLARE_TUNNEL_TOKEN || '';
    if (!token && fs.existsSync(tokenFile)) {
        token = fs.readFileSync(tokenFile, 'utf8').trim();
    }

    const cloudflaredBin = path.join(__dirname, 'cloudflared.exe');
    let args = [];

    if (token && token.length > 10) {
        console.log('🔑 Tunnel permanent avec Token Cloudflare Zero Trust détecté !');
        args = ['tunnel', '--no-prechecks', 'run', '--protocol', 'http2', '--dns-resolver-addrs', '1.1.1.1:53', '--dns-resolver-addrs', '8.8.8.8:53', '--token', token];
    } else {
        console.log('🌐 Connexion au tunnel temporaire Cloudflare en cours...');
        args = ['tunnel', '--no-prechecks', 'run', '--protocol', 'http2', '--dns-resolver-addrs', '1.1.1.1:53', '--dns-resolver-addrs', '8.8.8.8:53', '--url', 'http://localhost:8000'];
    }

    cloudflaredProcess = spawn(cloudflaredBin, args, {
        cwd: __dirname
    });

    let buffer = '';

    function handleData(data) {
        const text = data.toString();
        buffer += text;
        process.stdout.write(text);

        // Détection de la création du tunnel (Quick Tunnel)
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && match[0] !== currentTunnelUrl) {
            currentTunnelUrl = match[0];
            fs.writeFileSync(path.join(__dirname, 'current_tunnel_url.txt'), currentTunnelUrl);
            console.log('\n============================================================');
            console.log('🎮 NOVA QUEST EST EN LIGNE ET PRÊT POUR LE PLAYTEST !');
            console.log('🔗 LIEN PUBLIC : ' + currentTunnelUrl);
            console.log('📱 LIEN WI-FI LOCAL : http://' + localIp + ':8000');
            console.log('============================================================\n');
        }

        // Détection de la connexion du tunnel permanent (Named Tunnel Zero Trust)
        if (text.includes('Registered tunnel connection') || (text.includes('Connection') && text.includes('registered'))) {
            console.log('\n============================================================');
            console.log('🎮 NOVA QUEST EST EN LIGNE SUR VOTRE DOMAINE CLOUDFLARE !');
            console.log('🔗 STATUT : TUNNEL ZERO TRUST PERMANENT CONNECTÉ ET ACTIF');
            console.log('📱 LIEN WI-FI LOCAL : http://' + localIp + ':8000');
            console.log('============================================================\n');
        }

        // Watchdog : si Cloudflare expire la session
        if (text.includes('Tunnel not found') || text.includes('Unauthorized: Tunnel not found')) {
            console.warn('\n⚠️ Session Cloudflare expirée détectée. Régénération immédiate d\'un nouveau tunnel...\n');
            triggerRestart();
        }
    }

    cloudflaredProcess.stdout.on('data', handleData);
    cloudflaredProcess.stderr.on('data', handleData);

    cloudflaredProcess.on('exit', (code) => {
        console.warn('⚠️ Cloudflared s\'est arrêté (code ' + code + '). Redémarrage dans 2 secondes...');
        triggerRestart(2000);
    });

    cloudflaredProcess.on('error', (err) => {
        console.error('Erreur lancement cloudflared :', err.message);
        triggerRestart(5000);
    });
}

function triggerRestart(delay = 1000) {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        startCloudflareTunnel();
    }, delay);
}

// Lancer le tunnel après 2 secondes pour laisser le serveur écouter
setTimeout(startCloudflareTunnel, 2000);

process.on('SIGINT', () => {
    if (cloudflaredProcess) cloudflaredProcess.kill();
    if (serverProcess) serverProcess.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (cloudflaredProcess) cloudflaredProcess.kill();
    if (serverProcess) serverProcess.kill();
    process.exit(0);
});
