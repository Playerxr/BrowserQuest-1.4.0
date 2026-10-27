
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

            if(localStorage && localStorage.data) {
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

        startGoogleGame: function(idToken, preferredName) {
            var self = this;
            self.setPlayButtonState(false);
            $('.google-auth-btn').addClass('loading');
            $('#google-login-btn .google-text').text("Connexion en cours...");
            $('#google-signup-btn .google-text').text("Connexion en cours...");

            var cleanPreferred = String(preferredName || '').replace(/[^a-zA-Z0-9_\-\u00C0-\u017F]/g, '').trim().substr(0, 12);

            var resetBtns = function() {
                $('.google-auth-btn').removeClass('loading').prop('disabled', false);
                $('#google-login-btn .google-text').text("Se connecter avec Google");
                $('#google-signup-btn .google-text').text("Créer avec Google");
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

            var resetGoogleBtns = function() {
                $('.google-auth-btn').removeClass('loading').prop('disabled', false);
                $('#google-login-btn .google-text').text("Se connecter avec Google");
                $('#google-signup-btn .google-text').text("Créer avec Google");
                self.setPlayButtonState(true);
            };

            var clearPendingFlags = function() {
                try { sessionStorage.removeItem('nova_google_pending'); } catch(e) {}
                try { localStorage.removeItem('nova_google_pending'); } catch(e) {}
            };

            var setPendingFlags = function() {
                try { sessionStorage.setItem('nova_google_pending', '1'); } catch(e) {}
                try { localStorage.setItem('nova_google_pending', '1'); } catch(e) {}
            };

            var hasPendingFlags = function() {
                var p1 = false, p2 = false;
                try { p1 = sessionStorage.getItem('nova_google_pending') === '1'; } catch(e) {}
                try { p2 = localStorage.getItem('nova_google_pending') === '1'; } catch(e) {}
                return p1 || p2;
            };

            var triggerGoogleAuth = function(forceRedirect) {
                if(!window.firebase || !firebase.auth) {
                    self.showGoogleAlert("Firebase non initialisé sur cette page. Rechargez le jeu.");
                    return;
                }

                self.clearValidationErrors();
                $('#google-alert-banner').hide().empty();

                var $btns = $('.google-auth-btn');
                $btns.addClass('loading');
                $btns.find('.google-text').text("Connexion en cours...");
                self.setPlayButtonState(false);

                // Timeout de sécurité 30s
                var safetyTimer = setTimeout(function() {
                    resetGoogleBtns();
                    self.showGoogleAlert("Le délai d'attente Google a expiré. Utilisez le lien de connexion directe.");
                }, 30000);

                var handleSuccessUser = function(user) {
                    clearTimeout(safetyTimer);
                    clearPendingFlags();
                    return user.getIdToken(true).then(function(idToken) {
                        var prefName = (self.getUsernameField && self.getUsernameField().length) ? self.getUsernameField().val() : '';
                        self.startGoogleGame(idToken, prefName || user.displayName);
                    }).catch(function(tokenErr) {
                        resetGoogleBtns();
                        self.showGoogleAlert("Impossible d'obtenir le jeton d'authentification Google.");
                    });
                };

                // Si déjà connecté avec Firebase dans cette session, réutiliser directement le compte
                var currentUser = firebase.auth().currentUser;
                if(currentUser) {
                    handleSuccessUser(currentUser).catch(function() {
                        firebase.auth().signOut().then(function() {
                            resetGoogleBtns();
                        });
                    });
                    return;
                }

                var provider = new firebase.auth.GoogleAuthProvider();
                // Même configuration épurée que dans openrp-main pour éviter les blocages de popup

                var isMobileDevice = !self.isDesktop || (window.innerWidth <= 768) || (typeof Detect !== 'undefined' && Detect.isMobile && Detect.isMobile());

                // Sur mobile ou si l'utilisateur a cliqué sur le lien direct, utiliser immédiatement la redirection
                if(forceRedirect || isMobileDevice) {
                    $btns.find('.google-text').text("Redirection Google...");
                    setPendingFlags();
                    clearTimeout(safetyTimer);
                    firebase.auth().signInWithRedirect(provider);
                    return;
                }

                // Sur desktop, essayer en popup avec fallback automatique
                firebase.auth().signInWithPopup(provider).then(function(result) {
                    return handleSuccessUser(result.user);
                }).catch(function(error) {
                    clearTimeout(safetyTimer);
                    resetGoogleBtns();
                    if(!error) return;

                    console.error("[Google Auth Error]", error);

                    // Si popup bloqué ou fermé automatiquement : fallback immédiat en redirection
                    if(error.code === 'auth/popup-blocked' ||
                       error.code === 'auth/cancelled-popup-request' ||
                       (error.code === 'auth/popup-closed-by-user' && error.message && error.message.indexOf('blocked') !== -1)) {
                        $btns.addClass('loading');
                        $btns.find('.google-text').text("Redirection Google...");
                        setPendingFlags();
                        firebase.auth().signInWithRedirect(provider);
                        return;
                    }

                    if(error.code === 'auth/popup-closed-by-user') {
                        self.showGoogleAlert("Connexion annulée. Vous pouvez aussi cliquer sur 'Connexion Google directe' ci-dessous.");
                        return;
                    }

                    var msg = "Connexion Google : ";
                    if(error.code === 'auth/unauthorized-domain') {
                        msg += "Ce domaine n'est pas autorisé dans Firebase Console.";
                    } else if(error.code === 'auth/operation-not-allowed') {
                        msg += "Le mode Google n'est pas activé dans Firebase Console.";
                    } else {
                        msg += (error.message || error.code);
                    }
                    self.showGoogleAlert(msg);
                });
            };

            if(window.firebase && firebase.auth) {
                // 1. Détection du retour d'une redirection éventuelle
                try {
                    firebase.auth().getRedirectResult().then(function(result) {
                        if(result && result.user) {
                            clearPendingFlags();
                            result.user.getIdToken(true).then(function(idToken) {
                                var prefName = (self.getUsernameField && self.getUsernameField().length) ? self.getUsernameField().val() : '';
                                self.startGoogleGame(idToken, prefName || result.user.displayName);
                            });
                        }
                    }).catch(function(err) {
                        clearPendingFlags();
                        if(err && err.code && err.code !== 'auth/credential-already-in-use') {
                            self.showGoogleAlert("Erreur de redirection Google : " + (err.message || err.code));
                        }
                    });
                } catch(e) {}

                // 2. Écouteur centralisé d'état d'authentification
                try {
                    firebase.auth().onAuthStateChanged(function(user) {
                        if(user) {
                            if(hasPendingFlags() && (!self.game || !self.game.started)) {
                                clearPendingFlags();
                                user.getIdToken(true).then(function(idToken) {
                                    var prefName = (self.getUsernameField && self.getUsernameField().length) ? self.getUsernameField().val() : '';
                                    self.startGoogleGame(idToken, prefName || user.displayName);
                                });
                            }
                        }
                    });
                } catch(e) {}
            }

            $(document).on('click', '.google-auth-btn', function(e) {
                e.preventDefault();
                var $btn = $(this);
                if($btn.hasClass('loading') || self.starting) return;
                triggerGoogleAuth(false);
            });

            $(document).on('click', '.google-redirect-btn', function(e) {
                e.preventDefault();
                triggerGoogleAuth(true);
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
        
        setPlayButtonState: function(enabled) {
            var self = this;
            var $playButton = this.getPlayButton();

            if(enabled) {
                this.starting = false;
                this.$play.removeClass('loading');
                if(this.playButtonRestoreText) {
                    $playButton.text(this.playButtonRestoreText);
                }
            } else {
                // Loading state
                this.starting = true;
                this.$play.addClass('loading');
                this.playButtonRestoreText = $playButton.text();
                $playButton.text('Chargement...');
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
            var scale = this.game.renderer.getScaleFactor(),
                healthMaxWidth = $("#healthbar").width() - (12 * scale);

            this.game.onPlayerHealthChange(function(hp, maxHp) {
                var barWidth = Math.round((healthMaxWidth / maxHp) * (hp > 0 ? hp : 0));
                $("#hitpoints").css('width', barWidth + "px");
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
            $('#nova-inventory').toggleClass('collapsed');
            $('#inventory-toggle').toggleClass('active');
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
                self.setPadScale(130);
                self.setPadOpacity(95);
                self.setDisableTouchMove(true);
            });

            // Contrôles Tactiles (Joystick Virtuel + Boutons de Combat)
            this.initMobileCombatControls();

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

        initMobileCombatControls: function() {
            var self = this;

            self.setPadScale = function(scalePercent) {
                scalePercent = Math.max(70, Math.min(220, parseInt(scalePercent, 10) || 130));
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
                opacityPercent = Math.max(20, Math.min(100, parseInt(opacityPercent, 10) || 95));
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

            // Charger préférences ou appliquer défauts
            var savedScale = parseInt(localStorage.getItem('nova_pad_scale') || '130', 10);
            var savedOpacity = parseInt(localStorage.getItem('nova_pad_opacity') || '95', 10);
            var savedTouchMove = localStorage.getItem('nova_disable_touch_move') !== 'false';
            self.setPadScale(savedScale);
            self.setPadOpacity(savedOpacity);
            self.setDisableTouchMove(savedTouchMove);

            var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || this.isMobile || this.isTablet || ($(window).width() <= 1024);
            if(isTouchDevice) {
                $('#mobile-controls').addClass('visible');
                $('#touch-controls-toggle').addClass('active');
            }

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
                self.setPadScale((self.padScale || 130) - 15);
            });
            $('#pad-zoom-plus').bind('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                self.setPadScale((self.padScale || 130) + 15);
            });

            var stopAllDir = function() {
                if(self.game && self.game.player) {
                    self.game.player.moveUp = false;
                    self.game.player.moveDown = false;
                    self.game.player.moveLeft = false;
                    self.game.player.moveRight = false;
                }
                $('.dpad-btn').removeClass('pressed');
                $('#joystick-stick').css('transform', 'translate(0px, 0px)');
            };

            var setDirState = function(dir, pressed) {
                if(!self.game || !self.game.player || !self.game.started) return;
                if(dir === 'up') self.game.player.moveUp = pressed;
                if(dir === 'down') self.game.player.moveDown = pressed;
                if(dir === 'left') self.game.player.moveLeft = pressed;
                if(dir === 'right') self.game.player.moveRight = pressed;
            };

            $('.dpad-btn').bind('touchstart mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var dir = $(this).attr('data-dir');
                $(this).addClass('pressed');
                setDirState(dir, true);
            });

            $('.dpad-btn').bind('touchend touchcancel mouseup mouseleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var dir = $(this).attr('data-dir');
                $(this).removeClass('pressed');
                setDirState(dir, false);
            });

            // Glissement analogique fluide et ergonomique sur le joystick mobile
            var $joyZone = $('#mobile-joystick-zone');
            var lastVibratedDir = null;
            var joyDragging = false;
            var activeTouchId = null;

            var handleJoyMove = function(clientX, clientY) {
                if(!self.game || !self.game.player || !self.game.started) return;
                var rect = $joyZone[0].getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;
                var dx = clientX - cx;
                var dy = clientY - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var maxR = 38; // Rayon de mouvement étendu et souple
                var clampedX = dist > maxR ? (dx / dist) * maxR : dx;
                var clampedY = dist > maxR ? (dy / dist) * maxR : dy;

                $('#joystick-stick').css('transform', 'translate(' + Math.round(clampedX) + 'px, ' + Math.round(clampedY) + 'px)');

                var deadzone = 8;
                var up = false, down = false, left = false, right = false;
                var currentDir = null;

                if(dist >= deadzone) {
                    // Calcul d'angle précis (secteurs de 90° sans conflit ni blocage diagonal)
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

                $('.dpad-up').toggleClass('pressed', up);
                $('.dpad-down').toggleClass('pressed', down);
                $('.dpad-left').toggleClass('pressed', left);
                $('.dpad-right').toggleClass('pressed', right);
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

            // Boutons d'action de combat à droite
            $('#btn-mobile-attack').bind('touchstart mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).addClass('pressed');
                if(self.game && self.game.started) {
                    self.game.makePlayerAttackClosest();
                }
            }).bind('touchend touchcancel mouseup mouseleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).removeClass('pressed');
            });

            $('#btn-mobile-loot').bind('touchstart mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).addClass('pressed');
                if(self.game && self.game.started) {
                    self.game.makePlayerInteractClosest();
                }
            }).bind('touchend touchcancel mouseup mouseleave', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).removeClass('pressed');
            });

            $('#btn-mobile-heal').bind('touchstart mousedown', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).addClass('pressed');
                if(self.game && self.game.started) {
                    self.game.useFirstHealingItem();
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

            if(subAction === 'gold_update') {
                $('#hub-gold-amount').text(payload.gold);
                if(payload.reward && this.game && this.game.player) {
                    this.game.infoManager.addDamageInfo("+" + payload.reward + " Or", this.game.player.x, this.game.player.y - 28, "exp", 2500);
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

        renderHubState: function(state) {
            var self = this;
            $('#hub-gold-amount').text(state.gold || 0);
            if(typeof state.lives === 'number') {
                this.updateLivesUI(state.lives);
            }

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
        }
    });

    return App;
});
