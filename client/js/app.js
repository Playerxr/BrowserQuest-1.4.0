
define(['jquery', 'storage'], function($, Storage) {

    // Polyfill jQuery .on / .off for legacy jQuery bundled in BrowserQuest
    if ($ && !$.fn.on) {
        $.fn.on = function(events, selector, data, handler) {
            if (typeof selector === 'function') {
                return this.bind(events, selector);
            }
            if (typeof data === 'function') {
                handler = data;
                data = undefined;
            }
            if (typeof selector === 'string') {
                return this.delegate(selector, events, data, handler);
            }
            return this.bind(events, data, handler);
        };
    }
    if ($ && !$.fn.off) {
        $.fn.off = function(events, selector, handler) {
            if (typeof selector === 'string') {
                return this.undelegate(selector, events, handler);
            }
            return this.unbind(events, selector);
        };
    }

    var App = Class.extend({
        init: function() {
            this.currentPage = 1;
            this.blinkInterval = null;
            this.isParchmentReady = true;
            this.ready = false;
            this.storage = new Storage();
            this.watchNameInputInterval = setInterval(this.toggleButton.bind(this), 100);
            this.initFormFields();
            this.chatMode = 'global';
            this.hubState = null;
            this.initHubEvents();
            this.initGoogleAuth();
            this.initRememberMe();
            this.initChatLog();

            if(localStorage && (localStorage.data || localStorage.getItem('nova_remember_username'))) {
                this.frontPage = 'loadcharacter';
                $('#parchment').removeClass().addClass('loadcharacter');
            } else {
                this.frontPage = 'createcharacter';
                $('#parchment').removeClass().addClass('createcharacter');
            }
        },

        setGame: function(game) {
            this.game = game;
            this.isMobile = this.game.renderer.mobile;
            this.isTablet = this.game.renderer.tablet;
            this.isDesktop = !(this.isMobile || this.isTablet);
            this.supportsWorkers = !!window.Worker;
            this.ready = true;
        },

        initFormFields: function() {
            var self = this;

            // Play button
            this.$play = $('.play');
            this.getPlayButton = function() {
                var $form = this.getActiveForm();
                return $form ? $form.find('.play button, .play span') : $('.play button, .play span');
            };
            this.setPlayButtonState(true);

            // Login form fields
            this.$loginnameinput = $('#loginnameinput');
            this.$loginpwinput = $('#loginpwinput');
            this.loginFormFields = [this.$loginnameinput, this.$loginpwinput];

            // Create new character form fields
            this.$nameinput = $('#nameinput');
            this.$pwinput = $('#pwinput');
            this.$pwinput2 = $('#pwinput2');
            this.$email = $('#emailinput');
            this.createNewCharacterFormFields = [this.$nameinput, this.$pwinput, this.$pwinput2, this.$email];

            // Functions to return the proper username / password fields to use, depending on which form
            // (login or create new character) is currently active.
            this.getUsernameField = function() { return this.createNewCharacterFormActive() ? this.$nameinput : this.$loginnameinput; };
            this.getPasswordField = function() { return this.createNewCharacterFormActive() ? this.$pwinput : this.$loginpwinput; };
        },

        updateAdminStatus: function(isAdmin) {
            this.isAdmin = Boolean(isAdmin);
            if(this.isAdmin) {
                $('body').addClass('dev-mode');
                $('#hub-tab-admin').show();
                $('#nova-door-diag-btn').show();
            } else {
                $('body').removeClass('dev-mode');
                $('#hub-tab-admin').hide();
                $('#nova-door-diag-btn').hide();
                $('#nova-door-diag-overlay').hide();
                if($('#hub-panel-admin').hasClass('active')) {
                    $('.hub-tab[data-tab="bag"]').click();
                }
            }
        },

        initRememberMe: function() {
            try {
                if(typeof localStorage === 'undefined') return;
                var rememberMe = localStorage.getItem('nova_remember_me');
                var savedUser = localStorage.getItem('nova_remember_username');
                var savedPw = localStorage.getItem('nova_remember_pw');

                if(rememberMe !== 'false' && savedUser) {
                    if(this.$loginnameinput) this.$loginnameinput.val(savedUser);
                    if(savedPw && this.$loginpwinput) this.$loginpwinput.val(savedPw);
                    $('#remember-me-checkbox').prop('checked', true);
                    $('#remember-me-create-checkbox').prop('checked', true);
                } else if(rememberMe === 'false') {
                    $('#remember-me-checkbox').prop('checked', false);
                    $('#remember-me-create-checkbox').prop('checked', false);
                }
            } catch(e) {}
        },

        center: function() {
            window.scrollTo(0, 1);
        },

        canStartGame: function() {
            if(this.isDesktop) {
                return (this.game && this.game.map && this.game.map.isLoaded);
            } else {
                return this.game;
            }
        },

        tryStartingGame: function() {
            var now = Date.now();
            if(this.starting) {
                if(this._startingTimestamp && (now - this._startingTimestamp > 8000)) {
                    this.setPlayButtonState(true);
                } else {
                    return; // Already loading
                }
            }
            this._startingTimestamp = now;

            var self = this;
            var action = this.createNewCharacterFormActive() ? 'create' : 'login';
            var username = String(this.getUsernameField().val() || '').trim();
            var userpw = String(this.getPasswordField().val() || '');
            var email = '';
            var userpw2 = '';

            if(action === 'create') {
                email = String(this.$email.val() || '').trim();
                userpw2 = String(this.$pwinput2.val() || '');
            }

            if(!this.validateFormFields(username, userpw, userpw2, email)) {
                this.setPlayButtonState(true);
                return;
            }
            
            this.setPlayButtonState(false);

            if(!this.ready || !this.game) {
                var waitDeadline = Date.now() + 60000;
                var watchCanStart = setInterval(function() {
                    if(self.ready && self.game) {
                        clearInterval(watchCanStart);
                        self.startGame(action, username, userpw, email);
                    } else if(Date.now() >= waitDeadline) {
                        clearInterval(watchCanStart);
                        self.setPlayButtonState(true);
                        self.addValidationError(null, 'Le jeu ne se charge pas. Rechargez la page puis réessayez.');
                    }
                }, 100);
            } else {
                this.startGame(action, username, userpw, email);
            }
        },

        startGame: function(action, username, userpw, email) {
            var self = this;
            if(!this.game) {
                this.setPlayButtonState(true);
                this.addValidationError(null, 'Le jeu est encore en cours de chargement. Réessayez.');
                return;
            }

            if(username && !this.game.started) {
                var host = window.location.hostname || "localhost",
                    port = window.location.port ? parseInt(window.location.port, 10) : (window.location.protocol === "https:" ? 443 : 8000);

                log.debug("Starting game with dynamic WebSocket host: " + host + ":" + port);
                this.game.setServerOptions(host, port, username, userpw, email);

                if(!this.isDesktop && (!this.game.map || !this.game.map.isLoaded)) {
                    this.game.loadMap();
                }

                this.center();
                try {
                    this.game.run(action, function(result) {
                    if(result.success === true) {
                        try {
                            var isRemember = (action === 'create') ? $('#remember-me-create-checkbox').is(':checked') : $('#remember-me-checkbox').is(':checked');
                            if(isRemember) {
                                localStorage.setItem('nova_remember_username', username);
                                localStorage.setItem('nova_remember_pw', userpw);
                                localStorage.setItem('nova_remember_me', 'true');
                            } else {
                                localStorage.removeItem('nova_remember_username');
                                localStorage.removeItem('nova_remember_pw');
                                localStorage.setItem('nova_remember_me', 'false');
                            }
                        } catch(e) {}
                        self.start();
                    } else {
                        self.setPlayButtonState(true);

                        switch(result.reason) {
                            case 'invalidlogin':
                                if(action === 'login') {
                                    self.addValidationError(null, "Compte introuvable ou mot de passe incorrect. Nouveau joueur ? Cliquez ci-dessous sur 'Créer un compte'.");
                                } else {
                                    self.addValidationError(null, "Le pseudo ou mot de passe est invalide (2 à 12 caractères).");
                                }
                                self.getUsernameField().focus();
                                break;
                            case 'userexists':
                                // Attempted to create a new user, but the username was taken
                                self.addValidationError(self.getUsernameField(), 'Ce nom de héros est déjà utilisé.');
                                break;
                            case 'loggedin':
                                // Attempted to log in with the same user multiple times simultaneously
                                self.addValidationError(self.getUsernameField(), 'Un joueur avec ce nom est déjà connecté.');
                                break;
                            case 'banned':
                                self.addValidationError(self.getUsernameField(), 'Ce compte a été banni par un administrateur.');
                                break;
                            default:
                                self.addValidationError(null, 'Impossible de lancer le jeu : ' + (result.reason ? result.reason : '(erreur inconnue)'));
                                break;
                        }
                    }
                    });
                } catch(error) {
                    self.game.started = false;
                    self.setPlayButtonState(true);
                    self.addValidationError(null, 'Le jeu ne peut pas démarrer. Rechargez la page puis réessayez.');
                    log.error('Game initialization failed: ' + error.message);
                }
            }
        },

        openGoogleNameChooser: function(idToken, suggestedName, email, providerType) {
            var self = this;
            this.pendingGoogleAuth = {
                idToken: idToken,
                email: email || '',
                provider: providerType || 'google'
            };

            $('.google-auth-btn, .play-games-auth-btn').removeClass('loading').prop('disabled', false);
            $('#google-login-btn .google-text').text("Se connecter avec Google");
            $('#google-signup-btn .google-text').text("Créer avec Google");
            $('.play-games-auth-btn .play-games-text').text("Google Play Jeux");
            $('#google-name-submit').removeClass('loading');
            $('#google-name-submit .link').text("Entrer dans l'Aventure");
            $('#google-name-submit .google-play-spinner').hide();
            this.setPlayButtonState(true);
            this.clearValidationErrors();
            $('#google-name-validation').empty();

            var isPlayGames = (providerType === 'playgames');
            var providerLabel = isPlayGames ? 'Play Jeux' : 'Google';
            var cleanSuggested = String(suggestedName || '').replace(/[^a-zA-Z0-9_\-\u00C0-\u017F]/g, '').trim().substr(0, 12);
            $('#google-verified-email').text(email ? (providerLabel + ' : ' + email) : ('Compte ' + providerLabel + ' authentifié'));
            $('#parchment').addClass('google-choose-name');
            $('#google-name-chooser').show();

            var $input = $('#google-name-input');
            $input.removeClass('field-error').val(cleanSuggested);
            setTimeout(function() {
                $input.focus().select();
            }, 50);
        },

        closeGoogleNameChooser: function() {
            this.pendingGoogleAuth = null;
            $('#google-name-validation').empty();
            $('#google-name-input').removeClass('field-error');
            $('#google-name-chooser').hide();
            $('#parchment').removeClass('google-choose-name');
            this.setPlayButtonState(true);
        },

        submitGoogleChosenName: function() {
            if(!this.pendingGoogleAuth || !this.pendingGoogleAuth.idToken || this.starting) {
                return;
            }
            var $input = $('#google-name-input');
            var chosenName = String($input.val() || '').trim();
            $('#google-name-validation').empty();
            $input.removeClass('field-error');

            var showNameError = function(msg) {
                $('<span/>', {
                    'class': 'validation-error blink',
                    text: msg
                }).appendTo('#google-name-validation');
                $input.addClass('field-error').focus();
            };

            if(!chosenName) {
                showNameError('Veuillez choisir un pseudo pour votre héros.');
                return;
            }
            if(chosenName.length < 2 || chosenName.length > 12) {
                showNameError('Le pseudo doit contenir entre 2 et 12 caractères.');
                return;
            }
            if(!/^[a-zA-Z0-9_\-\u00C0-\u017F]+$/.test(chosenName)) {
                showNameError('Le pseudo ne peut contenir que des lettres, chiffres ou tirets.');
                return;
            }

            try {
                localStorage.setItem('nova_google_fallback_name', chosenName);
            } catch(e) {}

            this.startGoogleGame(this.pendingGoogleAuth.idToken, chosenName);
        },

        startGoogleGame: function(idToken, preferredName) {
            var self = this;
            self.setPlayButtonState(false);
            $('.google-auth-btn').addClass('loading');
            $('#google-login-btn .google-text').text("Connexion en cours...");
            $('#google-signup-btn .google-text').text("Connexion en cours...");
            $('#google-name-submit').addClass('loading');
            $('#google-name-submit .link').text("Connexion en cours...");
            $('#google-name-submit .google-play-spinner').show();

            var cleanPreferred = String(preferredName || '').replace(/[^a-zA-Z0-9_\-\u00C0-\u017F]/g, '').trim().substr(0, 12);

            var resetBtns = function() {
                $('.google-auth-btn, .play-games-auth-btn').removeClass('loading').prop('disabled', false);
                $('#google-login-btn .google-text').text("Se connecter avec Google");
                $('#google-signup-btn .google-text').text("Créer avec Google");
                $('.play-games-auth-btn .play-games-text').text("Google Play Jeux");
                $('#google-name-submit').removeClass('loading');
                $('#google-name-submit .link').text("Entrer dans l'Aventure");
                $('#google-name-submit .google-play-spinner').hide();
                self.setPlayButtonState(true);
            };

            var doConnect = function() {
                var host = window.location.hostname || "localhost",
                    port = window.location.port ? parseInt(window.location.port, 10) : (window.location.protocol === "https:" ? 443 : 8000);

                self.game.setServerOptions(host, port, cleanPreferred || "GoogleHero", "", "");
                self.game.googleIdToken = idToken;
                self.game.preferredGoogleName = cleanPreferred;

                if(!self.isDesktop && (!self.game.map || !self.game.map.isLoaded)) {
                    self.game.loadMap();
                }

                self.center();
                try {
                    self.game.run('google', function(result) {
                        resetBtns();

                        if(result.success === true) {
                            $('#google-name-chooser').hide();
                            $('#parchment').removeClass('google-choose-name');
                            self.start();
                        } else {
                            switch(result.reason) {
                                case 'loggedin':
                                    self.addValidationError(null, 'Un joueur avec ce compte est déjà en jeu.');
                                    break;
                                case 'banned':
                                    self.addValidationError(null, 'Ce compte a été banni par un administrateur.');
                                    break;
                                default:
                                    self.addValidationError(null, 'Erreur de connexion Google : ' + (result.reason || 'inconnue'));
                                    break;
                            }
                        }
                    });
                } catch(error) {
                    resetBtns();
                    self.game.started = false;
                    self.addValidationError(null, 'Le jeu ne peut pas démarrer. Rechargez la page.');
                }
            };

            // Attendre que le moteur de jeu et la carte soient chargés
            if(!self.ready || !self.game || !self.game.map || !self.game.map.isLoaded) {
                var waitDeadline = Date.now() + 60000;
                var watchReady = setInterval(function() {
                    if(self.ready && self.game && self.game.map && self.game.map.isLoaded) {
                        clearInterval(watchReady);
                        doConnect();
                    } else if(Date.now() >= waitDeadline) {
                        clearInterval(watchReady);
                        resetBtns();
                        self.addValidationError(null, 'Le chargement du jeu a expiré. Rechargez la page.');
                    }
                }, 100);
            } else {
                doConnect();
            }
        },

        initGoogleAuth: function() {
            var self = this;

            try { localStorage.removeItem('nova_google_fallback_uid'); } catch(e) {}

            // Google Play Jeux est réservé à l'application mobile native (Android APK / Capacitor).
            // Sur navigateur web (desktop & mobile), il est masqué pour garantir une présentation soignée et professionnelle.
            var isNativeApp = Boolean(
                (typeof window !== 'undefined' && window.Capacitor) ||
                (typeof window !== 'undefined' && window.IS_NOVA_MOBILE_APP === true) ||
                (typeof window !== 'undefined' && typeof window.NovaMobileBridge !== 'undefined') ||
                (typeof window !== 'undefined' && window.location && (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:')) ||
                (typeof navigator !== 'undefined' && /NovaQuestMobile|wv|Capacitor/i.test(navigator.userAgent))
            );

            if(isNativeApp) {
                $('body').addClass('native-app');
                $('.play-games-auth-btn').show();
            } else {
                $('body').removeClass('native-app');
                $('.play-games-auth-btn').hide();
            }

            var resetGoogleBtns = function() {
                if(self._mobilePollTimer) {
                    clearInterval(self._mobilePollTimer);
                    self._mobilePollTimer = null;
                }
                $('.google-auth-btn, .play-games-auth-btn').removeClass('loading').prop('disabled', false);
                $('#google-login-btn .google-text').text("Se connecter avec Google");
                $('#google-signup-btn .google-text').text("Créer avec Google");
                $('.play-games-auth-btn .play-games-text').text("Google Play Jeux");
                self.setPlayButtonState(true);
            };

            var clearPendingFlags = function() {
                try { sessionStorage.removeItem('nova_google_pending'); } catch(e) {}
                try { localStorage.removeItem('nova_google_pending'); } catch(e) {}
                try { localStorage.removeItem('nova_google_provider'); } catch(e) {}
            };

            var setPendingFlags = function(providerType) {
                try { sessionStorage.setItem('nova_google_pending', '1'); } catch(e) {}
                try { localStorage.setItem('nova_google_pending', '1'); } catch(e) {}
                try { localStorage.setItem('nova_google_provider', providerType || 'google'); } catch(e) {}
            };

            var getPendingProvider = function() {
                try { return localStorage.getItem('nova_google_provider') || 'google'; } catch(e) { return 'google'; }
            };

            var hasPendingFlags = function() {
                var p1 = false, p2 = false;
                try { p1 = sessionStorage.getItem('nova_google_pending') === '1'; } catch(e) {}
                try { p2 = localStorage.getItem('nova_google_pending') === '1'; } catch(e) {}
                return p1 || p2;
            };

            // Attendre que l'onglet soit au premier plan (crucial sur mobile où les onglets en arrière-plan sont suspendus)
            var runWhenTabVisible = function(fn) {
                if(typeof document === 'undefined' || !document.hidden) {
                    fn();
                    return;
                }
                var onVisible = function() {
                    if(!document.hidden) {
                        document.removeEventListener('visibilitychange', onVisible);
                        window.removeEventListener('focus', onVisible);
                        fn();
                    }
                };
                document.addEventListener('visibilitychange', onVisible);
                window.addEventListener('focus', onVisible);
            };

            var presentGoogleNameStep = function(user, providerType) {
                if(!user || (self.game && self.game.started)) return Promise.resolve();
                var pType = providerType || getPendingProvider();
                clearPendingFlags();
                return new Promise(function(resolve) {
                    runWhenTabVisible(function() {
                        user.getIdToken(true).then(function(idToken) {
                            var prefName = (self.getUsernameField && self.getUsernameField().length) ? String(self.getUsernameField().val() || '').trim() : '';
                            var savedName = '';
                            try { savedName = localStorage.getItem('nova_google_fallback_name') || ''; } catch(e) {}
                            var suggested = prefName || savedName || user.displayName || '';
                            self.openGoogleNameChooser(idToken, suggested, user.email || '', pType);
                            resolve();
                        }).catch(function(err) {
                            resetGoogleBtns();
                            self.showGoogleAlert("Impossible de valider la session. Veuillez réessayer.");
                            resolve();
                        });
                    });
                });
            };

            // Ouverture du pont d'authentification dans le navigateur système mobile (Chrome Custom Tab / Safari)
            // afin d'utiliser le compte Google / Play Jeux déjà connecté sur le téléphone sans ressaisir Gmail + code.
            var startMobileBrowserBridgeAuth = function(providerType) {
                var isPlayGames = (providerType === 'playgames');
                var label = isPlayGames ? 'Play Jeux' : 'Google';
                var sessionKey = 'nq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 10);
                try { localStorage.setItem('nova_mobile_auth_key', sessionKey); } catch(e) {}

                var isCap = Boolean(window.Capacitor || /^capacitor:|^file:/i.test(window.location.protocol));
                var baseHost = (self.game && self.game.host && self.game.host !== 'localhost')
                    ? ('https://' + self.game.host)
                    : (isCap ? 'https://quest.universnovastudio.online' : window.location.origin);
                var bridgeUrl = baseHost + '/auth/mobile-bridge?key=' + encodeURIComponent(sessionKey) + '&provider=' + encodeURIComponent(providerType || 'google');
                var pollUrl = baseHost + '/api/auth/mobile-session?key=' + encodeURIComponent(sessionKey);

                if(isPlayGames) {
                    $('.play-games-auth-btn').addClass('loading').find('.play-games-text').text("Navigateur Play Jeux...");
                } else {
                    $('.google-auth-btn').addClass('loading').find('.google-text').text("Navigateur Google...");
                }
                self.setPlayButtonState(false);

                // Ouvrir dans le navigateur système du téléphone (Chrome Custom Tabs sur Capacitor ou _blank système)
                try {
                    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser && typeof window.Capacitor.Plugins.Browser.open === 'function') {
                        window.Capacitor.Plugins.Browser.open({ url: bridgeUrl });
                    } else {
                        window.open(bridgeUrl, '_blank');
                    }
                } catch(e) {
                    window.open(bridgeUrl, '_blank');
                }

                var pollStart = Date.now();
                if(self._mobilePollTimer) clearInterval(self._mobilePollTimer);

                var checkMobileSession = function() {
                    if(self.game && self.game.started) {
                        clearInterval(self._mobilePollTimer);
                        self._mobilePollTimer = null;
                        return;
                    }
                    if(Date.now() - pollStart > 240000) {
                        resetGoogleBtns();
                        return;
                    }
                    $.ajax({
                        url: pollUrl,
                        method: 'GET',
                        dataType: 'json',
                        cache: false,
                        success: function(data) {
                            if(data && data.completed && data.idToken) {
                                clearInterval(self._mobilePollTimer);
                                self._mobilePollTimer = null;
                                try { localStorage.removeItem('nova_mobile_auth_key'); } catch(e) {}
                                try {
                                    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser && typeof window.Capacitor.Plugins.Browser.close === 'function') {
                                        window.Capacitor.Plugins.Browser.close();
                                    }
                                } catch(e) {}
                                var prefName = (self.getUsernameField && self.getUsernameField().length) ? String(self.getUsernameField().val() || '').trim() : '';
                                var savedName = '';
                                try { savedName = localStorage.getItem('nova_google_fallback_name') || ''; } catch(e) {}
                                var suggested = prefName || savedName || data.displayName || '';
                                self.openGoogleNameChooser(data.idToken, suggested, data.email || '', data.provider || providerType || 'google');
                            }
                        }
                    });
                };

                self._mobilePollTimer = setInterval(checkMobileSession, 1200);
                self._checkMobileSessionNow = checkMobileSession;
            };

            window.addEventListener('message', function(ev) {
                if(ev && ev.data && ev.data.type === 'nova-mobile-auth-complete' && typeof self._checkMobileSessionNow === 'function') {
                    self._checkMobileSessionNow();
                }
            });

            var triggerGoogleAuth = function(forceExternalBrowser, providerType) {
                var pType = providerType || 'google';
                var isPlayGames = (pType === 'playgames');
                self.clearValidationErrors();
                $('#google-alert-banner').hide().empty();

                var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
                var isCapacitorApp = Boolean(window.Capacitor || /NovaQuestMobile/i.test(ua) || /^capacitor:|^file:/i.test(window.location.protocol));
                var isMobileDevice = isCapacitorApp || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) ||
                                     (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && window.innerWidth <= 1024);

                // Sur APK Android / Mobile ou clic sur "Connexion rapide via le navigateur du téléphone" :
                // passer par le pont du navigateur système afin d'utiliser le compte Google / Play Jeux déjà connecté
                if(isCapacitorApp || forceExternalBrowser) {
                    startMobileBrowserBridgeAuth(pType);
                    return;
                }

                if(!window.firebase || typeof firebase.auth !== 'function') {
                    startMobileBrowserBridgeAuth(pType);
                    return;
                }

                if(isPlayGames) {
                    $('.play-games-auth-btn').addClass('loading').find('.play-games-text').text("Connexion Play Jeux...");
                } else {
                    $('.google-auth-btn').addClass('loading').find('.google-text').text("Authentification Google...");
                }
                self.setPlayButtonState(false);

                try {
                    var authInstance = firebase.auth();
                    var provider = new firebase.auth.GoogleAuthProvider();
                    if(provider && typeof provider.setCustomParameters === 'function') {
                        provider.setCustomParameters({ prompt: 'select_account' });
                    }

                    setPendingFlags(pType);
                    authInstance.signInWithPopup(provider).then(function(result) {
                        if(result && result.user) {
                            return presentGoogleNameStep(result.user, pType);
                        }
                        resetGoogleBtns();
                    }).catch(function(error) {
                        clearPendingFlags();
                        resetGoogleBtns();
                        if(!error) return;

                        console.warn("[Auth]", error.code || error.message);

                        // Si la popup est bloquée ou sur navigateur mobile intégré, ouvrir le pont navigateur système
                        if(error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request' || error.code === 'auth/operation-not-supported-in-this-environment' || isMobileDevice) {
                            startMobileBrowserBridgeAuth(pType);
                            return;
                        }

                        if(error.code === 'auth/popup-closed-by-user') {
                            self.showGoogleAlert("Authentification annulée. Sur mobile, cliquez sur 'Connexion rapide via le navigateur du téléphone'.");
                            return;
                        }

                        if(error.code === 'auth/unauthorized-domain') {
                            startMobileBrowserBridgeAuth(pType);
                            return;
                        }

                        self.showGoogleAlert("Erreur d'authentification : " + (error.message || error.code));
                    });
                } catch(syncErr) {
                    clearPendingFlags();
                    resetGoogleBtns();
                    startMobileBrowserBridgeAuth(pType);
                }
            };

            if(window.firebase && typeof firebase.auth === 'function') {
                try {
                    firebase.auth().getRedirectResult().then(function(result) {
                        if(result && result.user) {
                            presentGoogleNameStep(result.user, getPendingProvider());
                        }
                    }).catch(function(err) {
                        clearPendingFlags();
                        resetGoogleBtns();
                    });
                } catch(e) {}

                try {
                    firebase.auth().onAuthStateChanged(function(user) {
                        if(user && hasPendingFlags() && (!self.game || !self.game.started)) {
                            presentGoogleNameStep(user, getPendingProvider());
                        }
                    });
                } catch(e) {}

                var checkOnFocus = function() {
                    if(document.hidden || (self.game && self.game.started)) return;
                    if(typeof self._checkMobileSessionNow === 'function') {
                        self._checkMobileSessionNow();
                    }
                    if(hasPendingFlags() && window.firebase && typeof firebase.auth === 'function') {
                        var u = firebase.auth().currentUser;
                        if(u) {
                            presentGoogleNameStep(u, getPendingProvider());
                        }
                    }
                };
                document.addEventListener('visibilitychange', checkOnFocus);
                window.addEventListener('focus', checkOnFocus);
            }

            $(document).on('click', '.google-auth-btn', function(e) {
                e.preventDefault();
                var $btn = $(this);
                if($btn.hasClass('loading') || self.starting) return;
                triggerGoogleAuth(false, 'google');
            });

            $(document).on('click', '.play-games-auth-btn', function(e) {
                e.preventDefault();
                var $btn = $(this);
                if($btn.hasClass('loading') || self.starting) return;
                triggerGoogleAuth(false, 'playgames');
            });

            $(document).on('click', '.google-redirect-btn', function(e) {
                e.preventDefault();
                if(self.starting) return;
                triggerGoogleAuth(true, 'google');
            });

            $(document).on('click', '#google-name-submit', function(e) {
                e.preventDefault();
                self.submitGoogleChosenName();
            });

            $(document).on('submit', '#google-name-form', function(e) {
                e.preventDefault();
                self.submitGoogleChosenName();
            });

            $(document).on('keydown', '#google-name-input', function(e) {
                $('#google-name-input').removeClass('field-error');
                $('#google-name-validation').empty();
                if(e.which === 13) {
                    e.preventDefault();
                    self.submitGoogleChosenName();
                }
            });

            $(document).on('click', '#google-name-cancel', function(e) {
                e.preventDefault();
                self.closeGoogleNameChooser();
            });
        },

        showGoogleAlert: function(text) {
            var $banner = $('#google-alert-banner');
            if($banner.length === 0) {
                $banner = $('<div id="google-alert-banner"></div>').insertBefore('.auth-divider');
            }
            $banner.text(text).show();
            this.addValidationError(null, text);
        },

        start: function() {
            var self = this,
                firstTimePlaying = !self.storage.hasAlreadyPlayed();

            this.hideIntro(function() {
                if(!self.isDesktop && (!self.game.map || !self.game.map.isLoaded)) {
                    self.game.loadMap();
                }
            });
            $('body').addClass('started');
            if(firstTimePlaying) {
                this.toggleInstructions();
            }
        },
        
        showQueueStatus: function(position, total) {
            var posNum = (typeof position === 'number' && position > 0) ? position : 1;
            var totalNum = (typeof total === 'number' && total >= posNum) ? total : posNum;
            var message = 'Waiting in line... (' + posNum + '/' + totalNum + ')';

            this.isWaitingInQueue = true;
            this.queuePosition = posNum;
            this.queueTotal = totalNum;
            this.queueMessage = message;
            this._startingTimestamp = Date.now() + 120000;

            var $playButton = this.getPlayButton ? this.getPlayButton() : null;
            if($playButton && typeof $playButton.text === 'function') {
                $playButton.text('Waiting in line...');
            }
            $('#google-name-submit .link').text('Waiting in line...');

            $('.queue-status-message').remove();
            $('<span/>', {
                'class': 'queue-status-message validation-error blink',
                text: message
            }).appendTo('.validation-summary');
        },

        hideQueueStatus: function() {
            this.isWaitingInQueue = false;
            this.queuePosition = 0;
            this.queueTotal = 0;
            this.queueMessage = null;
            $('.queue-status-message').remove();
        },

        setPlayButtonState: function(enabled) {
            var self = this;
            var $playButton = this.getPlayButton();

            if(enabled) {
                this.starting = false;
                this.hideQueueStatus();
                this.$play.removeClass('loading');
                if(this.playButtonRestoreText) {
                    $playButton.text(this.playButtonRestoreText);
                }
            } else {
                // Loading state
                this.starting = true;
                this.$play.addClass('loading');
                if(!this.isWaitingInQueue) {
                    this.playButtonRestoreText = $playButton.text();
                }
                $playButton.text(this.isWaitingInQueue ? 'Waiting in line...' : 'Chargement...');
            }
        },

        getActiveForm: function() { 
            if(this.loginFormActive()) return $('#loadcharacter');
            else if(this.createNewCharacterFormActive()) return $('#createcharacter');
            else return null;
        },

        loginFormActive: function() {
            return $('#parchment').hasClass("loadcharacter");
        },

        createNewCharacterFormActive: function() {
            return $('#parchment').hasClass("createcharacter");
        },

        /**
         * Performs some basic validation on the login / create new character forms (required fields are filled
         * out, passwords match, email looks valid). Assumes either the login or the create new character form
         * is currently active.
         */
        validateFormFields: function(username, userpw, userpw2, email) {
            this.clearValidationErrors();

            if(!username) {
                this.addValidationError(this.getUsernameField(), 'Veuillez entrer un nom de personnage.');
                this.setPlayButtonState(true);
                return false;
            }

            if(username.length < 2 || username.length > 12) {
                this.addValidationError(this.getUsernameField(), 'Le pseudo doit contenir entre 2 et 12 caractères.');
                this.setPlayButtonState(true);
                return false;
            }

            if(!/^[a-zA-Z0-9_\-\u00C0-\u017F]+$/.test(username)) {
                this.addValidationError(this.getUsernameField(), 'Le pseudo ne peut contenir que des lettres, chiffres ou tirets.');
                this.setPlayButtonState(true);
                return false;
            }

            if(!userpw) {
                this.addValidationError(this.getPasswordField(), 'Veuillez entrer un mot de passe.');
                this.setPlayButtonState(true);
                return false;
            }

            if(userpw.length > 256) {
                this.addValidationError(this.getPasswordField(), 'Le mot de passe doit contenir au maximum 256 caractères.');
                this.setPlayButtonState(true);
                return false;
            }

            if(this.createNewCharacterFormActive()) {     // In Create New Character form (rather than login form)
                if(!userpw2) {
                    this.addValidationError(this.$pwinput2, 'Veuillez confirmer votre mot de passe.');
                    this.setPlayButtonState(true);
                    return false;
                }

                if(userpw !== userpw2) {
                    this.addValidationError(this.$pwinput2, 'Les mots de passe ne correspondent pas.');
                    this.setPlayButtonState(true);
                    return false;
                }

                // Email field is not required, but if it's filled out, then it should look like a valid email.
                if(email && !this.validateEmail(email)) {
                    this.addValidationError(this.$email, 'L\'adresse email semble invalide (ou laissez ce champ vide).');
                    this.setPlayButtonState(true);
                    return false;
                }
            }

            return true;
        },

        validateEmail: function(email) {
            // Regex borrowed from http://stackoverflow.com/a/46181/393005
            var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            return re.test(email);
        },

        addValidationError: function(field, errorText) {
            $('<span/>', {
                'class': 'validation-error blink',
                text: errorText
            }).appendTo('.validation-summary');

            if(field) {
                field.addClass('field-error').select();
                field.bind('keypress', function (event) {
                    field.removeClass('field-error');
                    $('.validation-error').remove();
                    $(this).unbind(event);
                });
            }
        },

        clearValidationErrors: function() {
            var fields = this.loginFormActive() ? this.loginFormFields : this.createNewCharacterFormFields;
            $.each(fields, function(i, field) {
                field.removeClass('field-error');
            });
            $('.validation-error').remove();
        },

        setMouseCoordinates: function(event) {
            var $fg = $('#foreground'),
                fgOffset = $fg.offset() || $('#container').offset(),
                scale = this.game.renderer.getScaleFactor(),
                width = this.game.renderer.getWidth(),
                height = this.game.renderer.getHeight(),
                rect = ($fg[0] && $fg[0].getBoundingClientRect) ? $fg[0].getBoundingClientRect() : null,
                ratioX = (rect && rect.width > 0) ? (width / rect.width) : 1,
                ratioY = (rect && rect.height > 0) ? (height / rect.height) : 1,
                mouse = this.game.mouse;

            mouse.x = Math.round((event.pageX - fgOffset.left) * ratioX);
            mouse.y = Math.round((event.pageY - fgOffset.top) * ratioY);

            if(mouse.x <= 0) {
                mouse.x = 0;
            } else if(mouse.x >= width) {
                mouse.x = width - 1;
            }

            if(mouse.y <= 0) {
                mouse.y = 0;
            } else if(mouse.y >= height) {
                mouse.y = height - 1;
            }
        },
        //Init the hud that makes it show what creature you are mousing over and attacking
        initTargetHud: function(){
            var self = this;
            if(!this.game || !this.game.player) return;
            var scale = self.game.renderer.getScaleFactor(),
                healthMaxWidth = $("#inspector .health").width() - (12 * scale),
                timeout;

            var frenchEntityNames = {
                rat: "Rat",
                skeleton: "Squelette",
                goblin: "Gobelin",
                ogre: "Ogre",
                spectre: "Spectre",
                crab: "Crabe géant",
                bat: "Chauve-souris",
                wizard: "Sorcier noir",
                eye: "Œil maléfique",
                snake: "Serpent",
                skeleton2: "Grand Squelette",
                boss: "👑 Roi Squelette (Boss)",
                grandogre: "👑 Grand Ogre (Boss)",
                spectreancien: "👑 Spectre Ancien (Boss)",
                seigneurmort: "👑 Seigneur de la Mort (Boss)",
                archimage: "👑 Archimage Noir (Boss)",
                oeilabyssal: "👑 Œil Abyssal (Boss)",
                reinecrabe: "👑 Reine Crabe Géante (Boss)",
                roigobelin: "👑 Roi Gobelin (Boss)",
                hydreserpent: "👑 Hydre Venimeuse (Boss)",
                colossesquelette: "👑 Colosse d'Os (Boss)",
                deathknight: "Chevalier de la Mort",
                guard: "Garde",
                king: "Le Roi",
                octocat: "Octocat",
                villagegirl: "Villageoise",
                villager: "Villageois",
                priest: "Prêtre",
                scientist: "Alchimiste",
                agent: "Agent",
                rick: "Troubadour",
                nyan: "Nyan",
                sorcerer: "Archimage",
                beachnpc: "Vacancier",
                forestnpc: "Forestier",
                desertnpc: "Éclaireur",
                lavanpc: "Garde des Flammes",
                coder: "Développeur Nova"
            };

            this.game.player.onSetTarget(function(target, name, mouseover){
                var el = '#inspector';
                var sprite = target.sprite,
                    x = ((sprite.animationData.idle_down.length-1)*sprite.width),
                    y = ((sprite.animationData.idle_down.row)*sprite.height);
                var displayName = frenchEntityNames[name] || name;
                $(el+' .name').text(displayName);

                //Show how much Health creature has left.
                if(target.healthPoints){
                    $(el+" .health").css('width', Math.round(target.healthPoints/target.maxHp*100)+'%');
                } else{
                    $(el+" .health").css('width', '0%');
                }
                var level = Types.getMobLevel(Types.getKindFromString(name));
                if(level !== undefined) {
                    $(el + ' .level').text("Niveau " + level);
                }
                else {
                    $('#inspector .level').text('');
                }

                $(el).fadeIn('fast');
            });

            self.game.onUpdateTarget(function(target){
                $("#inspector .health").css('width', Math.round(target.healthPoints/target.maxHp*100) + "%");
            });

            self.game.player.onRemoveTarget(function(targetId){
                $('#inspector').fadeOut('fast');
                $('#inspector .level').text('');
                self.game.player.inspecting = null;
            });
        },
         initExpBar: function(){
            var maxHeight = $("#expbar").height();

            this.game.onPlayerExpChange(function(expInThisLevel, expForLevelUp){
               var barHeight = Math.round((maxHeight / expForLevelUp) * (expInThisLevel > 0 ? expInThisLevel : 0));
               $("#expbar").css('height', barHeight + "px");
            });
        },

        initHealthBar: function() {
            var self = this;
            var updateHpWidth = function(hp, maxHp) {
                var hbWidth = $("#healthbar").width() || 204;
                var hitLeft = parseInt($("#hitpoints").css('left'), 10);
                if (isNaN(hitLeft) || hitLeft <= 0) {
                    hitLeft = hbWidth >= 300 ? 33 : (hbWidth >= 180 ? 22 : 11);
                }
                var rightPad = hbWidth >= 300 ? 3 : (hbWidth >= 180 ? 2 : 1);
                var healthMaxWidth = Math.max(40, hbWidth - hitLeft - rightPad);
                var safeMax = (maxHp && maxHp > 0) ? maxHp : 1;
                var safeHp = (hp && hp > 0) ? Math.min(hp, safeMax) : 0;
                var barWidth = Math.round((healthMaxWidth / safeMax) * safeHp);
                $("#hitpoints").css('width', barWidth + "px");
            };

            this.game.onPlayerHealthChange(function(hp, maxHp) {
                self._lastHp = hp;
                self._lastMaxHp = maxHp;
                updateHpWidth(hp, maxHp);
            });

            $(window).bind('resize.novaHealthBar', function() {
                if (typeof self._lastHp === 'number' && typeof self._lastMaxHp === 'number') {
                    updateHpWidth(self._lastHp, self._lastMaxHp);
                }
            });

            this.game.onPlayerHurt(this.blinkHealthBar.bind(this));
        },

        blinkHealthBar: function() {
            var $hitpoints = $('#hitpoints');

            $hitpoints.addClass('white');
            setTimeout(function() {
                $hitpoints.removeClass('white');
            }, 500)
        },

        toggleButton: function() {
            var activeField = (typeof this.getUsernameField === 'function') ? this.getUsernameField() : null;
            var name = (activeField && activeField.length) ? activeField.val() : '';
            var $play = $('.play');

            if(name && String(name).trim().length > 0) {
                $play.removeClass('disabled');
                $('#character').removeClass('disabled');
            } else {
                $play.removeClass('disabled');
                $('#character').addClass('disabled');
            }
        },

        hideIntro: function(hidden_callback) {
            clearInterval(this.watchNameInputInterval);
            $('body').removeClass('intro');
            setTimeout(function() {
                $('body').addClass('game');
                hidden_callback();
            }, 500);
        },

        showChat: function() {
            if(this.game.started) {
                $('#chatbox').addClass('active');
                var $ci = $('#chatinput');
                if($ci.val() === $ci.attr('placeholder')) {
                    $ci.val('');
                }
                $ci.focus();
                $('#chatbutton').addClass('active');
            }
        },

        hideChat: function() {
            if(this.game.started) {
                $('#chatbox').removeClass('active');
                $('#chatinput').blur();
                $('#chatbutton').removeClass('active');
            }
        },

        toggleInstructions: function() {
            if($('#achievements').hasClass('active')) {
                this.toggleAchievements();
                $('#achievementsbutton').removeClass('active');
            }
            if($('#nova-hub').hasClass('active')) {
                $('#nova-hub').removeClass('active');
                $('#achievementsbutton').removeClass('active');
            }
            $('#instructions').toggleClass('active');
        },

        toggleAchievements: function() {
            if($('#instructions').hasClass('active')) {
                this.toggleInstructions();
                $('#helpbutton').removeClass('active');
            }
            if($('#achievements').hasClass('active')) {
                this.resetPage();
                $('#achievements').removeClass('active');
                return;
            }
            $('#nova-hub').toggleClass('active');
            if($('#nova-hub').hasClass('active') && this.game && this.game.client) {
                this.game.client.sendHub('refresh', {});
            }
        },

        resetPage: function() {
            var self = this,
                $achievements = $('#achievements');

            if($achievements.hasClass('active')) {
                $achievements.bind(TRANSITIONEND, function() {
                    $achievements.removeClass('page' + self.currentPage).addClass('page1');
                    self.currentPage = 1;
                    $achievements.unbind(TRANSITIONEND);
                });
            }
        },

        initEquipmentIcons: function() {
            var scale = this.game.renderer.getScaleFactor(),
                getIconPath = function(spriteName) {
                    return 'img/'+ scale +'/item-' + spriteName + '.png';
                },
                weapon = this.game.player.getWeaponName(),
                armor = this.game.player.getSpriteName(),
                weaponPath = getIconPath(weapon),
                armorPath = getIconPath(armor);

            $('#weapon').css('background-image', 'url("' + weaponPath + '")');
            if(armor !== 'firefox') {
                $('#armor').css('background-image', 'url("' + armorPath + '")');
            }
            this.updateInventoryUI();
        },

        getItemDisplayName: function(kindString) {
            var names = {
                flask: "Potion de soin (+40 PV)",
                burger: "Burger royal (+100 PV)",
                cake: "Gâteau (+60 PV)",
                firepotion: "Potion de feu",
                sword1: "Épée en bois",
                sword2: "Épée en acier",
                axe: "Hache de guerre",
                morningstar: "Fléau d'armes",
                bluesword: "Épée magique",
                bow: "Arc de chasseur (Distance)",
                redsword: "Épée flamboyante",
                goldenbow: "Arc royal d'élite [Légendaire]",
                goldensword: "Épée ultime d'or",
                clotharmor: "Tunique en tissu",
                leatherarmor: "Armure de cuir",
                mailarmor: "Cotte de mailles",
                platearmor: "Armure de plaques",
                redarmor: "Armure de rubis",
                goldenarmor: "Armure d'or"
            };
            return names[kindString] || kindString;
        },

        updateInventoryUI: function() {
            if(!this.game || !this.game.player || !this.game.player.inventory) return;
            var scale = 2,
                inv = this.game.player.inventory,
                counts = this.game.player.inventoryCount;

            for(var i = 0; i < 6; i++) {
                var $slot = $('#inv-slot-' + i),
                    $icon = $slot.find('.inv-icon'),
                    $count = $slot.find('.inv-count'),
                    itemKind = inv[i],
                    count = counts[i] || 0;

                if(itemKind && count > 0) {
                    var kindString = Types.getKindAsString(itemKind);
                    var iconUrl = 'img/' + scale + '/item-' + kindString + '.png';
                    $slot.removeClass('empty').addClass('filled');
                    $icon.css('background-image', 'url("' + iconUrl + '")');
                    $count.text(count > 1 ? 'x' + count : '');
                    var label = this.getItemDisplayName(kindString);
                    var actionHint = Types.isHealingItem(itemKind) ? "Clic gauche: Boire/Manger | Clic droit: Jeter" : "Clic gauche: Équiper | Clic droit: Jeter";
                    $slot.attr('title', label + " — " + actionHint);
                } else {
                    $slot.removeClass('filled').addClass('empty');
                    $icon.css('background-image', 'none');
                    $count.text('');
                    $slot.attr('title', 'Emplacement ' + (i + 1) + ' (Vide)');
                }
            }
        },

        toggleInventory: function() {
            var $hub = $('#nova-hub');
            var isBagActive = $hub.hasClass('active') && $('#hub-panel-bag').hasClass('active');
            if(isBagActive) {
                $hub.removeClass('active');
                $('#achievementsbutton').removeClass('active');
            } else {
                if($('#instructions').hasClass('active')) {
                    this.toggleInstructions();
                    $('#helpbutton').removeClass('active');
                }
                if($('#achievements').hasClass('active')) {
                    this.resetPage();
                    $('#achievements').removeClass('active');
                }
                $('.hub-tab').removeClass('active');
                $('.hub-tab[data-tab="bag"]').addClass('active');
                $('.hub-panel').removeClass('active').hide();
                $('#hub-panel-bag').addClass('active').show();
                $hub.addClass('active');
                $('#achievementsbutton').addClass('active');
                if(this.game && this.game.client) {
                    this.game.client.sendHub('refresh', {});
                }
            }
        },

        hideWindows: function() {
            if($('#nova-hub').hasClass('active')) {
                $('#nova-hub').removeClass('active');
                $('#achievementsbutton').removeClass('active');
            }
            if($('#achievements').hasClass('active')) {
                this.resetPage();
                $('#achievements').removeClass('active');
                $('#achievementsbutton').removeClass('active');
            }
            if($('#instructions').hasClass('active')) {
                this.toggleInstructions();
                $('#helpbutton').removeClass('active');
            }
            if($('body').hasClass('credits')) {
                this.closeInGameScroll('credits');
            }
            if($('body').hasClass('legal')) {
                this.closeInGameScroll('legal');
            }
            if($('body').hasClass('about')) {
                this.closeInGameScroll('about');
            }
        },

        showAchievementNotification: function(id, name) {
            var $notif = $('#achievement-notification'),
                $name = $notif.find('.name'),
                $button = $('#achievementsbutton');

            $notif.removeClass().addClass('active achievement' + id);
            $name.text(name);
            if(this.game.storage.getAchievementCount() === 1) {
                this.blinkInterval = setInterval(function() {
                    $button.toggleClass('blink');
                }, 500);
            }
            setTimeout(function() {
                $notif.removeClass('active');
                $button.removeClass('blink');
            }, 5000);
        },

        displayUnlockedAchievement: function(id) {
            var $achievement = $('#achievements li.achievement' + id),
                achievement = this.game.getAchievementById(id);

            if(achievement && achievement.hidden) {
                this.setAchievementData($achievement, achievement.name, achievement.desc);
            }
            $achievement.addClass('unlocked');
        },

        unlockAchievement: function(id, name) {
            this.showAchievementNotification(id, name);
            this.displayUnlockedAchievement(id);

            var nb = parseInt($('#unlocked-achievements').text());
            $('#unlocked-achievements').text(nb + 1);
        },

        initAchievementList: function(achievements) {
            var self = this,
                $lists = $('#lists'),
                $page = $('#page-tmpl'),
                $achievement = $('#achievement-tmpl'),
                page = 0,
                count = 0,
                $p = null;

            _.each(achievements, function(achievement) {
                count++;

                var $a = $achievement.clone();
                $a.removeAttr('id');
                $a.addClass('achievement'+count);
                if(!achievement.hidden) {
                    self.setAchievementData($a, achievement.name, achievement.desc);
                }
                $a.find('.twitter').attr('href', 'https://github.com/Playerxr');
                $a.show();
                $a.find('a').click(function() {
                    var url = $(this).attr('href');

                    self.openPopup('twitter', url);
                    return false;
                });

                if((count - 1) % 4 === 0) {
                    page++;
                    $p = $page.clone();
                    $p.attr('id', 'page'+page);
                    $p.show();
                    $lists.append($p);
                }
                $p.append($a);
            });

            $('#total-achievements').text($('#achievements').find('li').length);
        },

        initUnlockedAchievements: function(ids) {
            var self = this;

            _.each(ids, function(id) {
                self.displayUnlockedAchievement(id);
            });
            $('#unlocked-achievements').text(ids.length);
        },

        setAchievementData: function($el, name, desc) {
            $el.find('.achievement-name').html(name);
            $el.find('.achievement-description').html(desc);
        },

        toggleScrollContent: function(content) {
            var currentState = $('#parchment').attr('class');

            if(this.game.started) {
                $('#parchment').removeClass().addClass(content);

                $('body').removeClass('credits legal about').toggleClass(content);

                if(!this.game.player) {
                    $('body').toggleClass('death');
                }

                if(content !== 'about') {
                    $('#helpbutton').removeClass('active');
                }
            } else {
                if(currentState !== 'animate') {
                    if(currentState === content) {
                        this.animateParchment(currentState, this.frontPage);
                    } else {
                        this.animateParchment(currentState, content);
                    }
                }
            }
        },

        closeInGameScroll: function(content) {
            $('body').removeClass(content);
            $('#parchment').removeClass(content);
            if(!this.game.player) {
                $('body').addClass('death');
            }
            if(content === 'about') {
                $('#helpbutton').removeClass('active');
            }
        },

        togglePopulationInfo: function() {
            $('#population').toggleClass('visible');
        },

        openPopup: function(type, url) {
            var h = $(window).height(),
                w = $(window).width(),
                popupHeight,
                popupWidth,
                top,
                left;

            switch(type) {
                case 'twitter':
                    popupHeight = 450;
                    popupWidth = 550;
                    break;
                case 'facebook':
                    popupHeight = 400;
                    popupWidth = 580;
                    break;
            }

            top = (h / 2) - (popupHeight / 2);
            left = (w / 2) - (popupWidth / 2);

            newwindow = window.open(url,'name','height=' + popupHeight + ',width=' + popupWidth + ',top=' + top + ',left=' + left);
            if (window.focus) {newwindow.focus()}
        },

        animateParchment: function(origin, destination) {
            var self = this,
                $parchment = $('#parchment'),
                duration = 0.5;

            this.clearValidationErrors();
            this.setPlayButtonState(true);

            if(!this.isParchmentReady) {
                $parchment.removeClass('createcharacter loadcharacter confirmation credits about legal error animate');
                $parchment.addClass(destination);
                this.isParchmentReady = true;
                this.setPlayButtonState(true);
                return;
            }
            this.isParchmentReady = false;

            $parchment.removeClass('createcharacter loadcharacter confirmation credits about legal error');
            $parchment.addClass('animate');

            setTimeout(function() {
                $parchment.removeClass('animate').addClass(destination);
                self.isParchmentReady = true;
                self.setPlayButtonState(true);
            }, duration * 1000);
        },

        animateMessages: function() {
            var $messages = $('#notifications div');

            $messages.addClass('top');
        },

        resetMessagesPosition: function() {
            var message = $('#message2').text();

            $('#notifications div').removeClass('top');
            $('#message2').text('');
            $('#message1').text(message);
        },

        showMessage: function(message) {
            var $wrapper = $('#notifications div'),
                $message = $('#notifications #message2');

            this.animateMessages();
            $message.text(message);
            if(this.messageTimer) {
                this.resetMessageTimer();
            }

            this.messageTimer = setTimeout(function() {
                    $wrapper.addClass('top');
            }, 5000);
        },

        resetMessageTimer: function() {
            clearTimeout(this.messageTimer);
        },

        resizeUi: function() {
            if(this.game) {
                if(this.game.started) {
                    this.game.resize();
                    this.initHealthBar();
                    this.initTargetHud();
                    this.initExpBar();
                    this.game.updateBars();
                } else {
                    var newScale = this.game.renderer.getScaleFactor();
                    this.game.renderer.rescale(newScale);
                }
            }
        },

        // =========================================================================
        // HUB CENTRAL UNIQUE (Marché, Guilde, Trophées, Admin) & Chat Toggle
        // =========================================================================
        initHubEvents: function() {
            var self = this;

            // Bascule Chat [Global / Guilde]
            $('#chat-mode-toggle').click(function(e) {
                e.stopPropagation();
                if(self.chatMode === 'global') {
                    self.chatMode = 'guild';
                    $(this).addClass('guild-mode').text('[Guilde]');
                    $('#chatinput').attr('placeholder', 'Message Guilde (Entrée pour envoyer)...');
                } else {
                    self.chatMode = 'global';
                    $(this).removeClass('guild-mode').text('[Global]');
                    $('#chatinput').attr('placeholder', 'Message Global (Entrée pour envoyer)...');
                }
                $('#chatinput').focus();
            });

            // Empêcher les clics dans le Hub de déplacer le joueur
            $('#nova-hub').click(function(e) {
                e.stopPropagation();
            });

            $('#hub-close-btn').click(function(e) {
                e.stopPropagation();
                $('#nova-hub').removeClass('active');
                $('#achievementsbutton').removeClass('active');
            });

            // Navigation par onglets
            $('.hub-tab').click(function(e) {
                e.stopPropagation();
                var tab = $(this).attr('data-tab');
                if(tab === 'trophies') {
                    $('#nova-hub').removeClass('active');
                    self.resetPage();
                    $('#achievements').addClass('active');
                    return;
                }
                $('.hub-tab').removeClass('active');
                $(this).addClass('active');
                $('.hub-panel').removeClass('active').hide();
                $('#hub-panel-' + tab).addClass('active').show();
                if(tab === 'map') {
                    self.updateHubMapLiveStatus();
                }
                if(self.game && self.game.client) {
                    self.game.client.sendHub('refresh', {});
                }
            });

            // Marché : Mettre en vente mon arme / mon armure
            $('#hub-sell-weapon-btn').click(function(e) {
                e.stopPropagation();
                var price = parseInt($('#hub-sell-price').val(), 10) || 100;
                if(self.game && self.game.client) {
                    self.game.client.sendHub('market_sell', { slotType: 'weapon', price: price });
                }
            });

            $('#hub-sell-armor-btn').click(function(e) {
                e.stopPropagation();
                var price = parseInt($('#hub-sell-price').val(), 10) || 100;
                if(self.game && self.game.client) {
                    self.game.client.sendHub('market_sell', { slotType: 'armor', price: price });
                }
            });

            // Guilde : Créer (100 Or)
            $('#hub-guild-create-btn').click(function(e) {
                e.stopPropagation();
                var tag = $('#hub-guild-tag').val(),
                    name = $('#hub-guild-name').val();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_create', { tag: tag, name: name });
                }
            });

            // Guilde : Inviter depuis la liste déroulante
            $('#hub-guild-invite-btn').click(function(e) {
                e.stopPropagation();
                var targetName = $('#hub-guild-invite-select').val();
                if(targetName && self.game && self.game.client) {
                    self.game.client.sendHub('guild_invite', { targetName: targetName });
                }
            });

            // Guilde : Quitter
            $('#hub-guild-leave-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_leave', {});
                }
            });

            // Guilde 3.0 : Déposer de l'Or dans la Trésorerie
            $('#hub-guild-deposit-btn').click(function(e) {
                e.stopPropagation();
                var amount = parseInt($('#hub-guild-deposit-amount').val(), 10) || 100;
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_deposit', { amount: amount });
                }
            });

            // Guilde 3.0 : Acheter le Salon Privé (50 000 Or)
            $('#hub-guild-buy-hall-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_buy_hall', {});
                }
            });

            // Guilde 3.0 : Se téléporter au Salon Privé
            $('#hub-guild-tp-hall-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_tp_hall', {});
                }
            });

            // Guilde 3.0 : Quitter le Salon Privé
            $('#hub-guild-leave-hall-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_leave_hall', {});
                }
            });

            // Guilde 3.0 : Invoquer Boss de Guilde (5 000 Or)
            $('#hub-guild-summon-boss-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_summon_boss', { bossKind: "seigneurmort" });
                }
            });

            // Guilde 3.0 : Poser un Coffre de Guilde (1 000 Or) réservé au Chef
            $('#hub-guild-spawn-chest-btn').click(function(e) {
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('guild_spawn_chest', {});
                }
            });

            // Clics Téléportation Carte & Voyages
            $(document).delegate('.hub-map-tp-btn', 'click', function(e) {
                e.stopPropagation();
                var dest = $(this).attr('data-dest');
                if(dest && self.game && self.game.client) {
                    self.game.client.sendHub('map_teleport', { destination: dest });
                    $('#nova-hub').removeClass('active');
                    $('#achievementsbutton').removeClass('active');
                }
            });

            // Bouton rapide "Sortir de la maison" sur l'onglet Carte
            $('#hub-map-exit-house-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(self.game && self.game.client) {
                    self.game.client.sendHub('map_teleport', { destination: 'exit_house' });
                    $('#nova-hub').removeClass('active');
                    $('#achievementsbutton').removeClass('active');
                }
            });

            // Sélection directe d'un contrat de chasse PNJ
            $(document).delegate('.hub-npc-quest-btn', 'click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var questId = $(this).attr('data-quest');
                if(questId && self.game && self.game.client) {
                    self.game.client.sendHub('npc_quest_start', { questId: questId });
                }
            });

            // Réglages & Personnalisation du Joystick
            $('#setting-pad-scale').bind('input change', function(e) {
                e.stopPropagation();
                self.setPadScale($(this).val());
            });

            $('.hub-preset-btn').click(function(e) {
                e.stopPropagation();
                var s = $(this).attr('data-scale');
                self.setPadScale(s);
            });

            $('#setting-pad-opacity').bind('input change', function(e) {
                e.stopPropagation();
                self.setPadOpacity($(this).val());
            });

            $('#setting-disable-touch-move').bind('change', function(e) {
                e.stopPropagation();
                self.setDisableTouchMove($(this).is(':checked'));
            });

            $('#setting-pad-reset-btn').click(function(e) {
                e.stopPropagation();
                self.setPadScale(100);
                self.setPadOpacity(90);
                self.setDisableTouchMove(false);
            });

            // Contrôles Tactiles (Joystick Virtuel + Boutons de Combat)
            this.initMobileCombatControls();

            // Outil de Diagnostic Portes & Maisons (Bouton HUD + Raccourci F9)
            $('#nova-door-diag-overlay').click(function(e) {
                e.stopPropagation();
            });
            $('#nova-door-diag-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                var isDev = Boolean(self.isAdmin || (self.game && self.game.player && self.game.player.admin === 1));
                if(!isDev) {
                    return;
                }
                if(self.game && self.game.doorDiagnostics) {
                    self.game.doorDiagnostics.toggleOverlay();
                }
            });
            $('#nova-door-diag-close-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(self.game && self.game.doorDiagnostics) {
                    self.game.doorDiagnostics.toggleOverlay(false);
                } else {
                    $('#nova-door-diag-overlay').hide();
                }
            });
            $('#nova-door-diag-clear-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(self.game && self.game.doorDiagnostics) {
                    self.game.doorDiagnostics.clear();
                }
            });
            $('#nova-door-diag-audit-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(self.game && self.game.doorDiagnostics) {
                    self.game.doorDiagnostics.auditMapDoors();
                    self.game.doorDiagnostics.renderOverlay();
                    self.game.doorDiagnostics.postToServer('manual_audit');
                }
            });
            $('#nova-door-diag-copy-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(self.game && self.game.doorDiagnostics) {
                    var jsonStr = self.game.doorDiagnostics.exportJson();
                    self.game.doorDiagnostics.postToServer('manual_export');
                    if(navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(jsonStr).catch(function() {});
                    }
                    var $btn = $(this);
                    var oldText = $btn.text();
                    $btn.text('Copié !');
                    setTimeout(function() { $btn.text(oldText); }, 1200);
                }
            });
            $(document).bind('keydown.novaDoorDiag', function(e) {
                if(e.which === 120 || e.key === 'F9') {
                    e.preventDefault();
                    var isDev = Boolean(self.isAdmin || (self.game && self.game.player && self.game.player.admin === 1));
                    if(!isDev) {
                        return; // Outil réservé aux administrateurs/développeurs activés via le panel admin
                    }
                    if(self.game && self.game.doorDiagnostics) {
                        self.game.doorDiagnostics.toggleOverlay();
                    }
                }
            });

            // Admin : Annonce serveur
            $('#hub-admin-announce-btn').click(function(e) {
                e.stopPropagation();
                var text = $('#hub-admin-announce-input').val();
                if(text && self.game && self.game.client) {
                    self.game.client.sendHub('admin_announce', { text: text });
                    $('#hub-admin-announce-input').val('');
                }
            });

            // Initialiser la grille de Spawner Admin en 1 clic (Coffre Légendaire + Monstres + 10 Boss)
            var monsters = [
                { kind: "chest", label: "🎁 Coffre Légendaire", isChest: true },
                { kind: "rat", label: "🐀 Rat" },
                { kind: "crab", label: "🦀 Crabe" },
                { kind: "bat", label: "🦇 Chauve-souris" },
                { kind: "goblin", label: "👺 Gobelin" },
                { kind: "skeleton", label: "💀 Squelette" },
                { kind: "snake", label: "🐍 Serpent" },
                { kind: "ogre", label: "👹 Ogre" },
                { kind: "skeleton2", label: "⚔️ Gd Squelette" },
                { kind: "eye", label: "👁️ Œil Maléfique" },
                { kind: "spectre", label: "👻 Spectre" },
                { kind: "wizard", label: "🧙 Sorcier Noir" },
                { kind: "deathknight", label: "🗡️ Chev. Mort" },
                { kind: "reinecrabe", label: "👑 Reine Crabe" },
                { kind: "roigobelin", label: "👑 Roi Gobelin" },
                { kind: "hydreserpent", label: "👑 Hydre" },
                { kind: "grandogre", label: "👑 Grand Ogre" },
                { kind: "colossesquelette", label: "👑 Colosse d'Os" },
                { kind: "oeilabyssal", label: "👑 Œil Abyssal" },
                { kind: "spectreancien", label: "👑 Spectre Ancien" },
                { kind: "archimage", label: "👑 Archimage" },
                { kind: "seigneurmort", label: "👑 Seign. Mort" },
                { kind: "boss", label: "👑 Roi Squelette" }
            ];
            var $grid = $('#hub-admin-spawner-grid').empty();
            _.each(monsters, function(m) {
                var $btn = $('<button type="button" class="hub-spawn-btn"/>')
                    .text(m.label)
                    .click(function(e) {
                        e.stopPropagation();
                        if(self.game && self.game.client) {
                            if(m.isChest) {
                                self.game.client.sendHub('admin_spawn_chest', {});
                            } else {
                                self.game.client.sendHub('admin_spawn', { mobKind: m.kind });
                            }
                        }
                    });
                if(m.isChest) {
                    $btn.css({ background: '#fef08a', borderColor: '#ca8a04', color: '#713f12', fontWeight: 'bold' });
                }
                $grid.append($btn);
            });
        },

        detectMobileApp: function() {
            if (typeof window === 'undefined') return false;
            if (window.Capacitor || window.IS_NOVA_MOBILE_APP === true || typeof window.NovaMobileBridge !== 'undefined') return true;
            var ua = (window.navigator && window.navigator.userAgent) ? window.navigator.userAgent : '';
            if (/NovaQuestMobile|com\.universnovastudio\.novaquest/i.test(ua)) return true;
            var search = (window.location && window.location.search) ? window.location.search : '';
            if (/[?&]mobileApp=1\b/.test(search)) return true;
            return false;
        },

        detectTouchDevice: function() {
            if (typeof window === 'undefined') return false;
            if (this.detectMobileApp()) return true;
            if (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0)) return true;
            if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
            if (this.isMobile || this.isTablet) return true;
            var ua = (window.navigator && window.navigator.userAgent) ? window.navigator.userAgent : '';
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        },

        initMobileServerConfig: function() {
            var self = this;
            var defaultUrl = 'https://quest.universnovastudio.online';
            var currentUrl = defaultUrl;
            try {
                if (window.NovaMobileBridge && typeof window.NovaMobileBridge.getServerUrl === 'function') {
                    currentUrl = window.NovaMobileBridge.getServerUrl() || defaultUrl;
                } else if (window.localStorage && localStorage.getItem('nova_mobile_server_url')) {
                    currentUrl = localStorage.getItem('nova_mobile_server_url');
                }
            } catch (e) {}

            window.NOVA_SERVER_URL = currentUrl;
            var displayHost = currentUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
            $('.mobile-server-host').text(displayHost);

            $('.mobile-server-change-btn').unbind('click').bind('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (window.NovaMobileBridge && typeof window.NovaMobileBridge.openServerDialog === 'function') {
                    window.NovaMobileBridge.openServerDialog();
                    return;
                }
                var input = window.prompt('Adresse du serveur Nova Quest (ex: https://quest.universnovastudio.online) :', currentUrl);
                if (input && String(input).trim()) {
                    var normalized = String(input).trim().replace(/\/+$/, '');
                    if (!/^https?:\/\//i.test(normalized)) {
                        normalized = 'https://' + normalized;
                    }
                    try { localStorage.setItem('nova_mobile_server_url', normalized); } catch (err) {}
                    window.NOVA_SERVER_URL = normalized;
                    $('.mobile-server-host').text(normalized.replace(/^https?:\/\//i, ''));
                    if (self.game && self.game.client) {
                        var m = normalized.match(/^(https?):\/\/([^\/:]+)(?::(\d+))?/i);
                        if (m) {
                            self.game.client.host = m[2];
                            self.game.client.port = m[3] ? parseInt(m[3], 10) : (m[1].toLowerCase() === 'https' ? 443 : 80);
                        }
                    }
                }
            });
        },

        initMobileCombatControls: function() {
            var self = this;
            this.isMobileApp = this.detectMobileApp();
            this.isTouchDevice = this.detectTouchDevice();

            self.setPadScale = function(scalePercent) {
                scalePercent = Math.max(70, Math.min(220, parseInt(scalePercent, 10) || 100));
                self.padScale = scalePercent;
                document.documentElement.style.setProperty('--pad-scale', (scalePercent / 100).toFixed(2));
                $('#setting-pad-scale').val(scalePercent);
                $('#setting-pad-scale-val').text(scalePercent + '%');
                $('#pad-quick-size').text(scalePercent + '%');
                $('.hub-preset-btn').removeClass('active');
                $('.hub-preset-btn[data-scale="' + scalePercent + '"]').addClass('active');
                try { localStorage.setItem('nova_pad_scale', scalePercent); } catch(e) {}
            };

            self.setPadOpacity = function(opacityPercent) {
                opacityPercent = Math.max(20, Math.min(100, parseInt(opacityPercent, 10) || 90));
                self.padOpacity = opacityPercent;
                document.documentElement.style.setProperty('--pad-opacity', (opacityPercent / 100).toFixed(2));
                $('#setting-pad-opacity').val(opacityPercent);
                $('#setting-pad-opacity-val').text(opacityPercent + '%');
                try { localStorage.setItem('nova_pad_opacity', opacityPercent); } catch(e) {}
            };

            self.setDisableTouchMove = function(disabled) {
                self.disableTouchMove = !!disabled;
                $('#setting-disable-touch-move').prop('checked', self.disableTouchMove);
                try { localStorage.setItem('nova_disable_touch_move', self.disableTouchMove ? 'true' : 'false'); } catch(e) {}
            };

            if(this.isMobileApp) {
                $('body').addClass('nova-mobile-app');
                window.IS_NOVA_MOBILE_APP = true;
                this.initMobileServerConfig();
            }

            // Charger préférences ou appliquer défauts (tap-to-move activé par défaut : disableTouchMove = false)
            var savedScale = parseInt(localStorage.getItem('nova_pad_scale') || '100', 10);
            var savedOpacity = parseInt(localStorage.getItem('nova_pad_opacity') || '90', 10);
            var savedTouchMove = localStorage.getItem('nova_disable_touch_move') === 'true';
            self.setPadScale(savedScale);
            self.setPadOpacity(savedOpacity);
            self.setDisableTouchMove(savedTouchMove);

            if(this.isTouchDevice) {
                $('body').addClass('touch-device');
                $('#mobile-controls').addClass('visible');
                $('#touch-controls-toggle').addClass('active');
                $('#nova-inventory').addClass('collapsed');
                $('#inventory-toggle').removeClass('active');
            } else {
                $('body').removeClass('touch-device');
                $('#mobile-controls').removeClass('visible');
                $('#touch-controls-toggle').removeClass('active');
            }

            // Si un événement tactile survient dynamiquement sur un appareil hybride/mobile, activer l'UI tactile
            $(window).one('touchstart', function() {
                if(!self.isTouchDevice) {
                    self.isTouchDevice = true;
                    $('body').addClass('touch-device');
                    $('#mobile-controls').addClass('visible');
                    $('#touch-controls-toggle').addClass('active');
                    $('#nova-inventory').addClass('collapsed');
                    $('#inventory-toggle').removeClass('active');
                }
            });

            $('#touch-controls-toggle').bind('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $('#mobile-controls').toggleClass('visible');
                $(this).toggleClass('active', $('#mobile-controls').hasClass('visible'));
            });

            // Boutons de zoom rapide +/- sur le HUD
            $('#pad-zoom-minus').bind('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                self.setPadScale((self.padScale || 115) - 15);
            });
            $('#pad-zoom-plus').bind('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                self.setPadScale((self.padScale || 115) + 15);
            });

            var stopAllDir = function() {
                if(self.game && self.game.player) {
                    self.game.player.moveUp = false;
                    self.game.player.moveDown = false;
                    self.game.player.moveLeft = false;
                    self.game.player.moveRight = false;
                }
                $('#joystick-stick').css('transform', 'translate(0px, 0px)');
            };

            // Joystick virtuel analogique fluide (sans D-pad)
            var $joyZone = $('#mobile-joystick-zone');
            var lastVibratedDir = null;
            var joyDragging = false;
            var activeTouchId = null;

            var handleJoyMove = function(clientX, clientY) {
                if(!$joyZone.length) return;
                var rect = $joyZone[0].getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;
                var dx = clientX - cx;
                var dy = clientY - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var maxR = 42;
                var clampedX = dist > maxR ? (dx / dist) * maxR : dx;
                var clampedY = dist > maxR ? (dy / dist) * maxR : dy;

                $('#joystick-stick').css('transform', 'translate(' + Math.round(clampedX) + 'px, ' + Math.round(clampedY) + 'px)');

                if(!self.game || !self.game.player || !self.game.started) return;

                var deadzone = 10;
                var up = false, down = false, left = false, right = false;
                var currentDir = null;

                if(dist >= deadzone) {
                    var deg = Math.atan2(dy, dx) * 180 / Math.PI; // -180° à +180°
                    if(deg >= -45 && deg <= 45) {
                        right = true;
                        currentDir = 'right';
                    } else if(deg > 45 && deg < 135) {
                        down = true;
                        currentDir = 'down';
                    } else if(deg <= -45 && deg > -135) {
                        up = true;
                        currentDir = 'up';
                    } else {
                        left = true;
                        currentDir = 'left';
                    }

                    if(currentDir && currentDir !== lastVibratedDir) {
                        lastVibratedDir = currentDir;
                        if(window.navigator && navigator.vibrate) {
                            try { navigator.vibrate(8); } catch(e) {}
                        }
                    }
                } else {
                    lastVibratedDir = null;
                }

                self.game.player.moveUp = up;
                self.game.player.moveDown = down;
                self.game.player.moveLeft = left;
                self.game.player.moveRight = right;
            };

            var endJoyDrag = function() {
                if(!joyDragging) return;
                joyDragging = false;
                activeTouchId = null;
                lastVibratedDir = null;
                $joyZone.removeClass('active');
                stopAllDir();
            };

            $joyZone.bind('touchstart', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var touch = e.originalEvent.changedTouches[0];
                if(!touch) return;
                joyDragging = true;
                activeTouchId = touch.identifier;
                $joyZone.addClass('active');
                handleJoyMove(touch.clientX, touch.clientY);
            });

            $(document).bind('touchmove', function(e) {
                if(!joyDragging) return;
                var touches = e.originalEvent.touches;
                for(var i = 0; i < touches.length; i++) {
                    if(touches[i].identifier === activeTouchId) {
                        e.preventDefault();
                        handleJoyMove(touches[i].clientX, touches[i].clientY);
                        break;
                    }
                }
            });

            $(document).bind('touchend touchcancel', function(e) {
                if(!joyDragging) return;
                var changed = e.originalEvent.changedTouches;
                for(var i = 0; i < changed.length; i++) {
                    if(changed[i].identifier === activeTouchId) {
                        endJoyDrag();
                        break;
                    }
                }
            });

            // Bouton d'action circulaire unique à droite (attaquer, parler aux PNJ, ramasser/ouvrir coffre)
            $('#btn-mobile-attack').bind('touchstart mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).addClass('pressed');
                if(self.game && self.game.started) {
                    if(typeof self.game.triggerAttackHaptic === 'function') {
                        self.game.triggerAttackHaptic();
                    }
                    self.game.makePlayerInteractClosest();
                }
            }).bind('touchend touchcancel mouseup mouseleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).removeClass('pressed');
            });
        },

        showHubNotice: function(text, isError) {
            var $n = $('#hub-notice');
            $n.removeClass('error');
            if(isError) $n.addClass('error');
            $n.text(text).stop(true, true).fadeIn(150);
            clearTimeout(this.hubNoticeTimer);
            this.hubNoticeTimer = setTimeout(function() {
                $n.fadeOut(300);
            }, 4000);
        },

        updateLivesUI: function(livesCount) {
            var count = (typeof livesCount === 'number') ? Math.max(0, Math.min(3, livesCount)) : 3;
            var html = '';
            for(var i = 0; i < 3; i++) {
                if(i < count) {
                    html += '<span class="life-heart active">❤️</span>';
                } else {
                    html += '<span class="life-heart lost">🖤</span>';
                }
            }
            $('#nova-lives-icons').html(html);
        },

        handleHubPacket: function(subAction, payload) {
            var self = this;
            payload = payload || {};

            if(subAction === 'lives_update') {
                this.updateLivesUI(payload.lives);
                $('#nova-lives-hud').addClass('blink-life');
                setTimeout(function() {
                    $('#nova-lives-hud').removeClass('blink-life');
                }, 1200);
                if(this.game && this.game.player) {
                    this.game.player.isDead = false;
                    $('body').removeClass('death');
                }
                return;
            }

            if(subAction === 'pong') {
                var sentAt = Number(payload && payload.t) || 0;
                if(sentAt > 0) {
                    var rtt = Math.max(1, Date.now() - sentAt);
                    if(typeof this._smoothedPing === 'number') {
                        this._smoothedPing = Math.round(this._smoothedPing * 0.65 + rtt * 0.35);
                    } else {
                        this._smoothedPing = rtt;
                    }
                    var pingMs = this._smoothedPing;
                    var $pingHud = $('#nova-ping-hud');
                    $('#nova-ping-value').text(pingMs + ' ms');
                    $pingHud.removeClass('ping-good ping-warn ping-bad');
                    if(pingMs < 80) {
                        $pingHud.addClass('ping-good');
                    } else if(pingMs < 160) {
                        $pingHud.addClass('ping-warn');
                    } else {
                        $pingHud.addClass('ping-bad');
                    }
                }
                return;
            }

            if(subAction === 'gold_update') {
                $('#hub-gold-amount').text(payload.gold);
                if(payload.reward && this.game && this.game.player) {
                    this.game.infoManager.addDamageInfo("+" + payload.reward + " Or", this.game.player.x, this.game.player.y - 28, "exp", 2500);
                }
                return;
            }

            if(subAction === 'house_rest_heal') {
                if(payload.amount && this.game && this.game.player && this.game.infoManager) {
                    this.game.infoManager.addDamageInfo("🏠 +" + payload.amount + " PV", this.game.player.x, this.game.player.y - 20, "healed", 1800);
                }
                return;
            }

            if(subAction === 'quest_update') {
                this.activeNpcQuest = payload.activeQuest || null;
                this.renderNpcQuestUI(this.activeNpcQuest);
                if(payload.message) {
                    this.showHubNotice(payload.message, false);
                    this.showMessage(payload.message);
                }
                if(payload.completedTitle && this.game && this.game.audioManager) {
                    this.game.audioManager.playSound("achievement");
                }
                return;
            }

            if(subAction === 'notice') {
                this.showHubNotice(payload.text, payload.isError);
                this.showMessage(payload.text);
                return;
            }

            if(subAction === 'announcement') {
                var $banner = $('#server-announcement');
                $('#server-announcement-text').text("[" + payload.author + "] : " + payload.text);
                $banner.stop(true, true).fadeIn(200);
                if(this.game && this.game.audioManager) {
                    this.game.audioManager.playSound("achievement");
                }
                clearTimeout(this.announceTimer);
                this.announceTimer = setTimeout(function() {
                    $banner.fadeOut(500);
                }, 7000);
                if(typeof this.addChatMessage === 'function') {
                    this.addChatMessage(payload.author || "Annonce", payload.text, 'system');
                }
                return;
            }

            if(subAction === 'guild_chat') {
                var formatted = "[" + payload.tag + "] " + payload.sender + " : " + payload.message;
                this.showMessage(formatted);
                if(this.game) {
                    var senderEntity = this.game.getEntityById(payload.senderId);
                    if(senderEntity) {
                        this.game.createBubble(payload.senderId, "[" + payload.tag + "] " + payload.message);
                        this.game.assignBubbleTo(senderEntity);
                    }
                    if(this.game.audioManager) {
                        this.game.audioManager.playSound("chat");
                    }
                }
                if(typeof this.addChatMessage === 'function') {
                    this.addChatMessage(payload.sender, payload.message, 'guild', payload.senderId, payload.tag);
                }
                return;
            }

            if(subAction === 'state') {
                this.hubState = payload;
                this.renderHubState(payload);
                if(payload.notice) {
                    this.showHubNotice(payload.notice.text, payload.notice.isError);
                    this.showMessage(payload.notice.text);
                }
            }
        },

        renderNpcQuestUI: function(activeQuest) {
            $('.hub-npc-quest-btn').removeClass('active-quest');
            if(activeQuest && activeQuest.id) {
                $('.hub-npc-quest-btn[data-quest="' + activeQuest.id + '"]').addClass('active-quest');
                $('#hub-active-quest-badge').text(
                    'En cours : ' + activeQuest.title + ' (' + (activeQuest.progress || 0) + '/' + activeQuest.targetCount + ') · +' + activeQuest.rewardGold + ' Or'
                );
            } else {
                $('#hub-active-quest-badge').text('Parlez à un PNJ ou choisissez un contrat :');
            }
        },

        updateHubMapLiveStatus: function() {
            if(!this.game || !this.game.player) return;
            var gx = this.game.player.gridX,
                gy = this.game.player.gridY;
            if(typeof gx !== 'number' || typeof gy !== 'number') return;

            var isInterior = false;
            if(this.game.renderer && typeof this.game.renderer.isHouseInteriorPosition === 'function') {
                isInterior = this.game.renderer.isHouseInteriorPosition(gx, gy);
            } else {
                isInterior = ((gx >= 115 && gy >= 60 && !(gx >= 145 && gx <= 168 && gy >= 270 && gy <= 292)) || gy >= 265);
            }

            $('#hub-map-live-coords').text('📍 Position : (' + gx + ', ' + gy + ')');
            var $envBadge = $('#hub-map-live-env');
            if(isInterior) {
                $envBadge.removeClass('outdoor').addClass('indoor').text('🏠 Intérieur de Maison (Repos +PV actif)');
                $('#hub-map-exit-house-btn').show();
            } else {
                $envBadge.removeClass('indoor').addClass('outdoor').text('🌲 Monde Extérieur');
                $('#hub-map-exit-house-btn').hide();
            }

            var regions = [
                { key: 'village', name: 'Village de Départ', x: 43, y: 210 },
                { key: 'beach', name: 'Plage du Sud', x: 110, y: 280 },
                { key: 'forest', name: 'Grande Forêt', x: 65, y: 160 },
                { key: 'desert', name: 'Désert Aride', x: 145, y: 175 },
                { key: 'lavacave', name: 'Caverne de Lave', x: 150, y: 80 },
                { key: 'castle', name: 'Château Royal', x: 155, y: 275 },
                { key: 'graveyard', name: 'Cimetière Maudit', x: 25, y: 45 },
                { key: 'bossroom', name: 'Antre des Boss Mondiaux', x: 45, y: 105 }
            ];

            var closestRegion = regions[0],
                bestDist = 999999;
            if(!isInterior) {
                _.each(regions, function(r) {
                    var d = Math.abs(gx - r.x) + Math.abs(gy - r.y);
                    if(d < bestDist) {
                        bestDist = d;
                        closestRegion = r;
                    }
                });
                $('#hub-map-live-region').text('Zone : ' + closestRegion.name);
                $('.hub-map-card').removeClass('current-region');
                $('.hub-map-card[data-dest="' + closestRegion.key + '"]').addClass('current-region');
            } else {
                $('#hub-map-live-region').text('Zone : Pièce intérieure (Utilisez ▼ SORTIE ou le bouton ci-contre)');
                $('.hub-map-card').removeClass('current-region');
            }
        },

        renderHubState: function(state) {
            var self = this;
            $('#hub-gold-amount').text(state.gold || 0);
            if(typeof state.lives === 'number') {
                this.updateLivesUI(state.lives);
            }
            if(typeof state.activeQuest !== 'undefined') {
                this.activeNpcQuest = state.activeQuest;
                this.renderNpcQuestUI(this.activeNpcQuest);
            }
            this.updateHubMapLiveStatus();

            var getRarityBadgeHtml = function(rarity, label) {
                if(!label) return '';
                var rClass = 'rarity-' + (rarity || 'common');
                return ' <span class="rarity-badge ' + rClass + '">[' + label + ']</span>';
            };

            // Afficher ou cacher totalement l'onglet Admin côté client selon is_admin = 1
            if(state.isAdmin) {
                $('#hub-tab-admin').show();
            } else {
                $('#hub-tab-admin').hide();
                if($('#hub-panel-admin').hasClass('active')) {
                    $('.hub-tab[data-tab="bag"]').click();
                }
            }

            // 0. Rendu Sac à dos (Équipement Actuel + 6 Emplacements avec Rareté)
            var $eqList = $('#hub-equipped-list').empty();
            var wKind = state.weapon || 'sword1',
                aKind = state.armor || 'clotharmor',
                wName = state.weaponName || self.getItemDisplayName(wKind),
                aName = state.armorName || self.getItemDisplayName(aKind);

            var $wRow = $('<div class="hub-item-row"/>');
            var $wInfo = $('<div class="hub-item-info"/>');
            $wInfo.append($('<div class="hub-sprite-icon"/>').css('background-image', 'url("img/2/item-' + wKind + '.png")'));
            $wInfo.append($('<div/>').html('<strong>🗡️ ' + wName + '</strong>' + getRarityBadgeHtml(state.weaponRarity, state.weaponRarityLabel) + '<br><span style="color:#5a4631;">Arme équipée</span>'));
            $wRow.append($wInfo);
            $eqList.append($wRow);

            var $aRow = $('<div class="hub-item-row"/>');
            var $aInfo = $('<div class="hub-item-info"/>');
            $aInfo.append($('<div class="hub-sprite-icon"/>').css('background-image', 'url("img/2/item-' + aKind + '.png")'));
            $aInfo.append($('<div/>').html('<strong>🛡️ ' + aName + '</strong>' + getRarityBadgeHtml(state.armorRarity, state.armorRarityLabel) + '<br><span style="color:#5a4631;">Armure équipée</span>'));
            $aRow.append($aInfo);
            $eqList.append($aRow);

            var $bagList = $('#hub-bag-slots-list').empty();
            _.each(state.inventorySlots || [], function(slotObj) {
                var $row = $('<div class="hub-item-row"/>');
                var $info = $('<div class="hub-item-info"/>');
                if(slotObj.kind) {
                    var $icon = $('<div class="hub-sprite-icon"/>').css('background-image', 'url("img/2/item-' + slotObj.kind + '.png")');
                    var countBadge = (slotObj.count > 1) ? (' <b>x' + slotObj.count + '</b>') : '';
                    var $text = $('<div/>').html('<strong>' + slotObj.name + '</strong>' + countBadge + getRarityBadgeHtml(slotObj.rarity, slotObj.rarityLabel) + '<br><small>Emplacement #' + (slotObj.slot + 1) + '</small>');
                    $info.append($icon).append($text);

                    var $btns = $('<div style="display:flex;gap:4px;"/>');
                    var actLabel = slotObj.isHealing ? '🧪 Boire' : '⚔️ Équiper';
                    var $eqBtn = $('<button type="button" class="hub-action-btn gold"/>')
                        .text(actLabel)
                        .click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('bag_equip', { slot: slotObj.slot });
                        });
                    var $dropBtn = $('<button type="button" class="hub-action-btn danger"/>')
                        .text('Jeter')
                        .click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('bag_drop', { slot: slotObj.slot });
                        });
                    $btns.append($eqBtn).append($dropBtn);
                    $row.append($info).append($btns);
                } else {
                    $info.append($('<div class="hub-sprite-icon" style="opacity:0.35;"/>'));
                    $info.append($('<div style="color:#786248;"/>').html('<em>Emplacement #' + (slotObj.slot + 1) + ' — Vide</em>'));
                    $row.append($info);
                }
                $bagList.append($row);
            });

            // 1. Rendu Boutique du jeu
            var $shopList = $('#hub-shop-list').empty();
            _.each(state.shopItems || [], function(item) {
                var $row = $('<div class="hub-item-row"/>');
                var $info = $('<div class="hub-item-info"/>');
                var $icon = $('<div class="hub-sprite-icon"/>').css('background-image', 'url("img/2/item-' + item.kind + '.png")');
                var $text = $('<div/>').html('<strong>' + item.name + '</strong>' + getRarityBadgeHtml(item.rarity, item.rarityLabel) + '<br><span style="color:#854d0e;">💰 ' + item.price + ' Or</span>');
                $info.append($icon).append($text);

                var $buyBtn = $('<button type="button" class="hub-action-btn gold"/>')
                    .text('Acheter (' + item.price + ' Or)')
                    .click(function(e) {
                        e.stopPropagation();
                        self.game.client.sendHub('shop_buy', { itemKind: item.kind });
                    });
                $row.append($info).append($buyBtn);
                $shopList.append($row);
            });

            // 2. Rendu Marché des joueurs (HDV)
            var $marketList = $('#hub-market-list').empty();
            var mItems = state.marketItems || [];
            if(mItems.length === 0) {
                $marketList.append('<div style="padding:10px;text-align:center;color:#5a4631;font-size:12px;">Aucune vente en cours. Mettez votre équipement en vente !</div>');
            } else {
                var myName = (this.game && this.game.player) ? this.game.player.name : '';
                _.each(mItems, function(m) {
                    var $row = $('<div class="hub-item-row"/>');
                    var $info = $('<div class="hub-item-info"/>');
                    var $icon = $('<div class="hub-sprite-icon"/>').css('background-image', 'url("img/2/item-' + m.item_kind + '.png")');
                    var itemName = self.getItemDisplayName(m.item_kind);
                    var $text = $('<div/>').html('<strong>' + itemName + '</strong>' + getRarityBadgeHtml(m.rarity, m.rarityLabel) + '<br><span>Vendeur: <b>' + m.seller + '</b> &bull; 💰 ' + m.price + ' Or</span>');
                    $info.append($icon).append($text);

                    var isMine = (m.seller === myName);
                    var $btn = $('<button type="button" class="hub-action-btn ' + (isMine ? '' : 'gold') + '"/>')
                        .text(isMine ? 'Retirer' : 'Acheter (' + m.price + ' Or)')
                        .click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('market_buy', { marketId: m.id });
                        });
                    $row.append($info).append($btn);
                    $marketList.append($row);
                });
            }

            // 3. Rendu Onglet Guilde 3.0 (Banque, Quête Collective, Salon Privé & Boss de Guilde)
            if(!state.guild) {
                $('#hub-no-guild-view').show();
                $('#hub-has-guild-view').hide();

                var $invList = $('#hub-guild-invites-list').empty();
                var invites = state.guildInvites || [];
                if(invites.length === 0) {
                    $invList.append('<div style="padding:10px;text-align:center;color:#5a4631;font-size:12px;">Aucune invitation reçue pour le moment.</div>');
                } else {
                    _.each(invites, function(inv) {
                        var $row = $('<div class="hub-item-row"/>');
                        $row.append('<div><strong>[' + inv.tag + '] ' + inv.name + '</strong><br><small>Invité par ' + inv.inviter + '</small></div>');
                        var $btns = $('<div style="display:flex;gap:4px;"/>');
                        var $acc = $('<button type="button" class="hub-action-btn gold">Accepter</button>').click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('guild_accept', { guildId: inv.guildId });
                        });
                        var $dec = $('<button type="button" class="hub-action-btn danger">Refuser</button>').click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('guild_decline', { guildId: inv.guildId });
                        });
                        $btns.append($acc).append($dec);
                        $row.append($btns);
                        $invList.append($row);
                    });
                }
            } else {
                $('#hub-no-guild-view').hide();
                $('#hub-has-guild-view').show();

                var g = state.guild;
                var myPlayerName = (this.game && this.game.player) ? this.game.player.name : '';
                var iAmLeader = (g.leader === myPlayerName);

                $('#hub-my-guild-tag').text('[' + g.tag + ']');
                $('#hub-my-guild-name').text(g.name);
                $('#hub-my-guild-leader').text(' (Chef : ' + g.leader + ')');

                // Trésorerie & Quête Collective
                $('#hub-guild-bank-gold').text(g.bank_gold || 0);
                var qKills = g.quest_kills || 0,
                    qTarget = g.quest_target || 1000,
                    qLevel = g.quest_level || 1,
                    qReward = 15000 * qLevel,
                    qPct = Math.min(100, Math.round((qKills / qTarget) * 100));
                $('#hub-guild-quest-label').text('⚔️ Quête Collective Niv. ' + qLevel + ' : ' + qKills + ' / ' + qTarget + ' monstres (+' + qReward + ' Or Banque)');
                $('#hub-guild-quest-bar').css('width', qPct + '%');

                // Bouton Poser un Coffre de Guilde (1 000 Or) réservé au Chef de Guilde
                if(iAmLeader) {
                    $('#hub-guild-spawn-chest-btn').show();
                } else {
                    $('#hub-guild-spawn-chest-btn').hide();
                }

                // Boutons du Salon Privé (Guild Hall) & Boss de Guilde
                if(g.has_hall === 1) {
                    $('#hub-guild-buy-hall-btn').hide();
                    if(state.inGuildHall) {
                        $('#hub-guild-tp-hall-btn').hide();
                        $('#hub-guild-leave-hall-btn').show();
                        if(iAmLeader) {
                            $('#hub-guild-summon-boss-btn').show();
                        } else {
                            $('#hub-guild-summon-boss-btn').hide();
                        }
                    } else {
                        $('#hub-guild-tp-hall-btn').show();
                        $('#hub-guild-leave-hall-btn').hide();
                        $('#hub-guild-summon-boss-btn').hide();
                    }
                } else {
                    $('#hub-guild-tp-hall-btn').hide();
                    $('#hub-guild-leave-hall-btn').hide();
                    $('#hub-guild-summon-boss-btn').hide();
                    if(iAmLeader) {
                        $('#hub-guild-buy-hall-btn').show();
                    } else {
                        $('#hub-guild-buy-hall-btn').hide();
                    }
                }

                var $memList = $('#hub-guild-members-list').empty();
                _.each(g.members || [], function(m) {
                    var $row = $('<div class="hub-item-row"/>');
                    var statusDot = m.online ? '🟢' : '⚪';
                    var roleBadge = m.isLeader ? ' 👑' : '';
                    $row.append('<div>' + statusDot + ' <strong>' + m.name + '</strong>' + roleBadge + '</div>');

                    if(iAmLeader && m.name !== myPlayerName) {
                        var $kickBtn = $('<button type="button" class="hub-action-btn danger">Exclure</button>').click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub('guild_kick', { targetName: m.name });
                        });
                        $row.append($kickBtn);
                    }
                    $memList.append($row);
                });

                // Liste déroulante des joueurs en ligne sans guilde
                var $sel = $('#hub-guild-invite-select').empty();
                var candidates = _.filter(state.onlinePlayers || [], function(p) {
                    return !p.guildId && p.name !== myPlayerName;
                });
                if(candidates.length === 0) {
                    $sel.append('<option value="">Aucun joueur disponible</option>');
                } else {
                    _.each(candidates, function(c) {
                        $sel.append($('<option/>').attr('value', c.name).text(c.name));
                    });
                }
            }

            // 4. Rendu Onglet Admin (Joueurs en ligne + Actions rapides)
            if(state.isAdmin) {
                var $adminPlayers = $('#hub-admin-players-list').empty();
                _.each(state.onlinePlayers || [], function(p) {
                    var $row = $('<div class="hub-admin-player-row"/>');
                    $row.append('<div><strong>' + p.name + '</strong> <small>(Pos: ' + p.x + ',' + p.y + ' | PV: ' + p.hp + '/' + p.maxHp + ' | 💰 ' + p.gold + ' Or)</small></div>');

                    var $btns = $('<div class="hub-admin-btns"/>');
                    var addAct = function(label, cls, actionName) {
                        var $b = $('<button type="button" class="hub-action-btn ' + cls + '"/>').text(label).click(function(e) {
                            e.stopPropagation();
                            self.game.client.sendHub(actionName, { targetName: p.name });
                        });
                        $btns.append($b);
                    };
                    addAct('[TP]', '', 'admin_tp');
                    addAct('[+500 Or]', 'gold', 'admin_gold');
                    addAct('[Donner Épée d\'Or]', 'gold', 'admin_give_goldensword');
                    addAct('[Soigner]', '', 'admin_heal');
                    addAct('[Kick]', 'danger', 'admin_kick');
                    addAct('[Ban]', 'danger', 'admin_ban');

                    $row.append($btns);
                    $adminPlayers.append($row);
                });
            }
        },

        // =========================================================================
        // COIN DE MESSAGES / HISTORIQUE DU CHAT (VISIBLE MEME SI AFK)
        // =========================================================================
        initChatLog: function() {
            var self = this;
            this.chatLogMessages = [];
            this.chatLogFilter = 'all';
            this.chatLogUnread = 0;
            this.isChatLogCollapsed = false;

            // Sur mobile/tablette tactile, replier par défaut pour dégager le joystick
            var isTouch = (typeof this.detectTouchDevice === 'function' && this.detectTouchDevice()) ||
                          (typeof this.detectMobileApp === 'function' && this.detectMobileApp());
            if(isTouch) {
                this.isChatLogCollapsed = true;
                $('#nova-chat-log-panel').addClass('collapsed');
                $('#chat-log-toggle-btn').text('+');
            }

            // Basculer Réduire / Agrandir
            $('#chat-log-toggle-btn').click(function(e) {
                e.stopPropagation();
                self.toggleChatLog();
            });

            $('.chat-log-title-bar').click(function(e) {
                e.stopPropagation();
                self.toggleChatLog();
            });

            // Filtres par onglets (Tous, Global, Guilde)
            $('.chat-log-tab').click(function(e) {
                e.stopPropagation();
                var filter = $(this).attr('data-filter') || 'all';
                self.setChatLogFilter(filter);
            });

            // Empêcher les clics dans le panneau d'historique de déclencher des déplacements du joueur
            $('#nova-chat-log-panel').click(function(e) {
                e.stopPropagation();
                self.clearChatLogUnread();
            });

            $('#nova-chat-log-messages').bind('scroll', function() {
                var el = this;
                var isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 25;
                if(isNearBottom) {
                    self.clearChatLogUnread();
                }
            });
        },

        toggleChatLog: function(forceState) {
            if(typeof forceState === 'boolean') {
                this.isChatLogCollapsed = forceState;
            } else {
                this.isChatLogCollapsed = !this.isChatLogCollapsed;
            }
            if(this.isChatLogCollapsed) {
                $('#nova-chat-log-panel').addClass('collapsed');
                $('#chat-log-toggle-btn').text('+');
            } else {
                $('#nova-chat-log-panel').removeClass('collapsed');
                $('#chat-log-toggle-btn').text('−');
                this.clearChatLogUnread();
                this.scrollChatLogToBottom();
            }
        },

        setChatLogFilter: function(filter) {
            this.chatLogFilter = filter;
            $('.chat-log-tab').removeClass('active');
            $('.chat-log-tab[data-filter="' + filter + '"]').addClass('active');

            $('#nova-chat-log-messages .chat-log-msg').each(function() {
                var msgType = $(this).attr('data-type');
                if(filter === 'all') {
                    $(this).removeClass('hidden-by-filter');
                } else if(filter === 'global') {
                    if(msgType === 'global' || msgType === 'npc' || msgType === 'system') {
                        $(this).removeClass('hidden-by-filter');
                    } else {
                        $(this).addClass('hidden-by-filter');
                    }
                } else if(filter === 'guild') {
                    if(msgType === 'guild' || msgType === 'system') {
                        $(this).removeClass('hidden-by-filter');
                    } else {
                        $(this).addClass('hidden-by-filter');
                    }
                }
            });

            this.scrollChatLogToBottom();
        },

        addChatMessage: function(author, message, channel, authorId, guildTag) {
            if(!message) return;
            channel = channel || 'global'; // 'global', 'guild', 'npc', 'system'

            var now = new Date();
            var hours = String(now.getHours());
            if(hours.length < 2) hours = '0' + hours;
            var minutes = String(now.getMinutes());
            if(minutes.length < 2) minutes = '0' + minutes;
            var timeStr = hours + ':' + minutes;

            var msgObj = {
                id: 'cmsg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                time: timeStr,
                author: author || 'Inconnu',
                message: message,
                channel: channel,
                authorId: authorId,
                guildTag: guildTag || null
            };

            this.chatLogMessages.push(msgObj);
            if(this.chatLogMessages.length > 80) {
                this.chatLogMessages.shift();
            }

            this.appendChatLogMessage(msgObj);

            if(this.isChatLogCollapsed) {
                this.incrementChatLogUnread();
            } else {
                var $container = $('#nova-chat-log-messages');
                var el = $container[0];
                if(el) {
                    var isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
                    if(isNearBottom) {
                        this.scrollChatLogToBottom();
                    } else {
                        this.incrementChatLogUnread();
                    }
                }
            }
        },

        appendChatLogMessage: function(m) {
            var $container = $('#nova-chat-log-messages');
            if($container.length === 0) return;

            // Nettoyer message d'accueil si plusieurs messages sont arrivés
            if(this.chatLogMessages.length > 1) {
                $container.find('.chat-log-msg.system:contains("Bienvenue")').remove();
            }

            var $row = $('<div class="chat-log-msg ' + m.channel + '" data-type="' + m.channel + '"/>');
            $row.append($('<span class="chat-log-time"/>').text(m.time));

            var tagText = '[Global]';
            if(m.channel === 'guild') {
                tagText = m.guildTag ? ('[' + m.guildTag + ']') : '[Guilde]';
            } else if(m.channel === 'npc') {
                tagText = '[PNJ]';
            } else if(m.channel === 'system') {
                tagText = '[Système]';
            }
            $row.append($('<span class="chat-log-tag ' + m.channel + '"/>').text(tagText));

            if(m.author && m.channel !== 'system') {
                $row.append($('<span class="chat-log-author"/>').text(m.author));
            }

            $row.append($('<span class="chat-log-text"/>').text(m.message));

            // Respecter le filtre actuel
            if(this.chatLogFilter === 'global' && (m.channel !== 'global' && m.channel !== 'npc' && m.channel !== 'system')) {
                $row.addClass('hidden-by-filter');
            } else if(this.chatLogFilter === 'guild' && (m.channel !== 'guild' && m.channel !== 'system')) {
                $row.addClass('hidden-by-filter');
            }

            $container.append($row);

            // Limiter les nœuds DOM à 80
            var $children = $container.children();
            if($children.length > 80) {
                $children.slice(0, $children.length - 80).remove();
            }
        },

        scrollChatLogToBottom: function() {
            var $container = $('#nova-chat-log-messages');
            if($container.length && $container[0]) {
                $container[0].scrollTop = $container[0].scrollHeight;
            }
        },

        incrementChatLogUnread: function() {
            this.chatLogUnread = (this.chatLogUnread || 0) + 1;
            var $badge = $('#chat-log-unread-badge');
            $badge.text(this.chatLogUnread > 99 ? '99+' : this.chatLogUnread).show();
        },

        clearChatLogUnread: function() {
            this.chatLogUnread = 0;
            $('#chat-log-unread-badge').text('0').hide();
        }
    });

    return App;
});
