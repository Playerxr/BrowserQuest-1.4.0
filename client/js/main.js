
define(['jquery', 'app', 'entrypoint'], function($, App, EntryPoint) {
    window.$ = $;
    window.jQuery = $;
    var app, game;

    var initApp = function() {
        $(document).ready(function() {
            app = new App();
            window.app = app;
            app.center();

            if(Detect.isWindows()) {
                // Workaround for graphical glitches on text
                $('body').addClass('windows');
            }

            if(Detect.isOpera()) {
                // Fix for no pointer events
                $('body').addClass('opera');
            }

            if(Detect.isFirefoxAndroid()) {
                // Remove chat placeholder
                $('#chatinput').removeAttr('placeholder');
            }

            $('body').click(function(event) {
                if($('#parchment').hasClass('credits')) {
                    app.toggleScrollContent('credits');
                }

                if($('#parchment').hasClass('legal')) {
                    app.toggleScrollContent('legal');
                }

                if($('#parchment').hasClass('about')) {
                    app.toggleScrollContent('about');
                }
            });

            $('.barbutton').click(function() {
                $(this).toggleClass('active');
            });

            $('#chatbutton').click(function() {
                if($('#chatbutton').hasClass('active')) {
                    app.showChat();
                } else {
                    app.hideChat();
                }
            });

            $('#helpbutton').click(function() {
                if($('body').hasClass('about')) {
                    app.closeInGameScroll('about');
                }
                app.toggleInstructions();
            });

            $('#achievementsbutton').click(function() {
                app.toggleAchievements();
                if(app.blinkInterval) {
                    clearInterval(app.blinkInterval);
                }
                $(this).removeClass('blink');
            });

            $('#instructions').click(function() {
                app.hideWindows();
            });

            $('#playercount').click(function() {
                app.togglePopulationInfo();
            });

            $('#population').click(function() {
                app.togglePopulationInfo();
            });

            $('.clickable').click(function(event) {
                event.stopPropagation();
            });

            $('#toggle-credits').click(function() {
                app.toggleScrollContent('credits');
            });

            $('#toggle-legal').click(function() {
                app.toggleScrollContent('legal');
                if(game.renderer.mobile) {
                    if($('#parchment').hasClass('legal')) {
                        $(this).text('Fermer');
                    } else {
                        $(this).text('Confidentialité');
                    }
                };
            });

            $('#create-new').click(function(e) {
                e.preventDefault();
                app.setPlayButtonState(true);
                app.clearValidationErrors();
                app.animateParchment('loadcharacter', 'createcharacter');
            });

            $('#continue').click(function(e) {
                e.preventDefault();
                app.storage.clear();
                app.setPlayButtonState(true);
                app.clearValidationErrors();
                app.animateParchment('confirmation', 'createcharacter');
                $('body').removeClass('returning');
            });

            $('#cancel').click(function(e) {
                e.preventDefault();
                app.setPlayButtonState(true);
                app.clearValidationErrors();
                app.animateParchment('confirmation', 'loadcharacter');
            });

            $('#back-to-login').click(function(e) {
                e.preventDefault();
                app.setPlayButtonState(true);
                app.clearValidationErrors();
                app.animateParchment('createcharacter', 'loadcharacter');
            });

            $('.ribbon').click(function() {
                app.toggleScrollContent('about');
            });

            $('#nameinput').bind("keyup", function() {
                app.toggleButton();
            });
            $('#pwinput').bind("keyup", function() {
                app.toggleButton();
            });
            $('#pwinput2').bind("keyup", function() {
                app.toggleButton();
            });
            $('#emailinput').bind("keyup", function() {
                app.toggleButton();
            });

            $('#previous').click(function() {
                var $achievements = $('#achievements');

                if(app.currentPage === 1) {
                    return false;
                } else {
                    app.currentPage -= 1;
                    $achievements.removeClass().addClass('active page' + app.currentPage);
                }
            });

            $('#next').click(function() {
                var $achievements = $('#achievements'),
                    $lists = $('#lists'),
                    nbPages = $lists.children('ul').length;

                if(app.currentPage === nbPages) {
                    return false;
                } else {
                    app.currentPage += 1;
                    $achievements.removeClass().addClass('active page' + app.currentPage);
                }
            });

            $('#notifications div').bind(TRANSITIONEND, app.resetMessagesPosition.bind(app));

            $('.close').click(function() {
                app.hideWindows();
            });

            $('.twitter').click(function() {
                var url = $(this).attr('href');

               app.openPopup('twitter', url);
               return false;
            });

            $('.facebook').click(function() {
                var url = $(this).attr('href');

               app.openPopup('facebook', url);
               return false;
            });

            var data = app.storage.data;
            if(data.hasAlreadyPlayed) {
                if(data.player.name && data.player.name !== "") {
                    $('#playername').html(data.player.name);
                    $('#playerimage').attr('src', data.player.image);
                }
            }

            var lastPlayTap = 0;
            var onPlaySubmit = function(event) {
                if(event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                var now = Date.now();
                if(now - lastPlayTap < 300) {
                    return false;
                }
                lastPlayTap = now;
                app.tryStartingGame();
                return false;
            };

            $('.play, .play span, .play div, .play .button, .play button, .play-btn').click(onPlaySubmit);

            $('#createcharacter form, #loadcharacter form').submit(onPlaySubmit);

            document.addEventListener("touchstart", function() {},false);

            $('#resize-check').bind("transitionend", app.resizeUi.bind(app));
            $('#resize-check').bind("webkitTransitionEnd", app.resizeUi.bind(app));
            $('#resize-check').bind("oTransitionEnd", app.resizeUi.bind(app));

            log.info("App initialized.");

            initGame();
        });
    };

    var initGame = function() {
        require(['game'], function(Game) {

            var canvas = document.getElementById("entities"),
                background = document.getElementById("background"),
                foreground = document.getElementById("foreground"),
                input = document.getElementById("chatinput");

            game = new Game(app);
            window.game = game;
            game.setup('#bubbles', canvas, background, foreground, input);
            game.setStorage(app.storage);
            app.setGame(game);

            game.loadMap();

            game.onGameStart(function() {
                app.initEquipmentIcons();
                var entry = new EntryPoint();
				entry.execute(game);
            });

            game.onDisconnect(function(message) {
                $('#death').find('p').html(message+"<em>Veuillez recharger la page.</em>");
                $('#respawn').hide();
            });

            game.onPlayerDeath(function() {
                if($('body').hasClass('credits')) {
                    $('body').removeClass('credits');
                }
                $('body').addClass('death');
            });

            game.onPlayerEquipmentChange(function() {
                app.initEquipmentIcons();
            });

            game.onPlayerInvincible(function() {
                $('#hitpoints').toggleClass('invincible');
            });

            game.onNbPlayersChange(function(worldPlayers, totalPlayers) {
                var setWorldPlayersString = function(string) {
                        $("#instance-population").find("span:nth-child(2)").text(string);
                        $("#playercount").find("span:nth-child(2)").text(string);
                    },
                    setTotalPlayersString = function(string) {
                        $("#world-population").find("span:nth-child(2)").text(string);
                    };

                $("#playercount").find("span.count").text(worldPlayers);

                $("#instance-population").find("span").text(worldPlayers);
                if(worldPlayers == 1) {
                    setWorldPlayersString("joueur");
                } else {
                    setWorldPlayersString("joueurs");
                }

                $("#world-population").find("span").text(totalPlayers);
                if(totalPlayers == 1) {
                    setTotalPlayersString("joueur");
                } else {
                    setTotalPlayersString("joueurs");
                }
            });
            					
            game.onGuildPopulationChange( function(guildName, guildPopulation) {
				var setGuildPlayersString = function(string) {
					$("#guild-population").find("span:nth-child(2)").text(string);
				};
				$('#guild-population').addClass("visible");
                $("#guild-population").find("span").text(guildPopulation);
				$('#guild-name').text(guildName);
                if(guildPopulation == 1) {
                    setGuildPlayersString("joueur");
                } else {
                    setGuildPlayersString("joueurs");
                }
			});

            game.onAchievementUnlock(function(id, name, description) {
                app.unlockAchievement(id, name);
            });

            game.onNotification(function(message) {
				app.showMessage(message);
            });

            app.initHealthBar();
            app.initTargetHud();
            app.initExpBar();
            $('#nameinput').val('');
            $('#pwinput').val('');
            $('#pwinput2').val('');
            $('#emailinput').val('');
            $('#chatbox').val('');

            var isPadActiveOnMobile = function() {
                var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || game.renderer.mobile || game.renderer.tablet || (app && (app.isMobile || app.isTablet));
                return isTouch && $('#mobile-controls').hasClass('visible') && (!app || app.disableTouchMove !== false);
            };

            if(game.renderer.mobile || game.renderer.tablet) {
                $('#foreground').bind('touchstart', function(event) {
                    // Si le joystick virtuel est actif, le clic au sol est désactivé sur mobile (contrôle 100% au Pad)
                    if(isPadActiveOnMobile()) {
                        app.hideWindows();
                        return false;
                    }
                    app.center();
                    app.setMouseCoordinates(event.originalEvent.touches[0]);
                    game.click();
                    app.hideWindows();
                });
            } else {
                $('#foreground').click(function(event) {
                    if(isPadActiveOnMobile()) {
                        app.hideWindows();
                        return false;
                    }
                    app.center();
                    app.setMouseCoordinates(event);
                     if(game && !app.dropDialogPopuped) {
                	    game.pvpFlag = event.shiftKey;
                	    game.click();
                	}
                   app.hideWindows();
                });
            }

            $('body').unbind('click');
            $('body').click(function(event) {
                var hasClosedParchment = false;

                if($('#parchment').hasClass('credits')) {
                    if(game.started) {
                        app.closeInGameScroll('credits');
                        hasClosedParchment = true;
                    } else {
                        app.toggleScrollContent('credits');
                    }
                }

                if($('#parchment').hasClass('legal')) {
                    if(game.started) {
                        app.closeInGameScroll('legal');
                        hasClosedParchment = true;
                    } else {
                        app.toggleScrollContent('legal');
                    }
                }

                if($('#parchment').hasClass('about')) {
                    if(game.started) {
                        app.closeInGameScroll('about');
                        hasClosedParchment = true;
                    } else {
                        app.toggleScrollContent('about');
                    }
                }

                if(game.started && !game.renderer.mobile && game.player && !hasClosedParchment) {
                    if(isPadActiveOnMobile()) {
                        return;
                    }
                    game.click();
                }
            });

            $('#respawn').click(function(event) {
                game.audioManager.playSound("revive");
                game.respawn();
                $('body').removeClass('death');
            });

            $(document).mousemove(function(event) {
                app.setMouseCoordinates(event);
                if(game.started) {
            	    game.pvpFlag = event.shiftKey;
                  game.movecursor();
                }
            });

            $(document).keyup(function(e) {
                var key = e.which;
                
                if (game.started && !$('#chatbox').hasClass('active'))
                {
                    switch(key) {
                        case Types.Keys.LEFT:
                        case Types.Keys.A:
                        case Types.Keys.Q:
                        case Types.Keys.KEYPAD_4:
                            game.player.moveLeft = false;
                            game.player.disableKeyboardNpcTalk = false;
                            break;
                        case Types.Keys.RIGHT:
                        case Types.Keys.D:
                        case Types.Keys.KEYPAD_6:
                            game.player.moveRight = false;
                            game.player.disableKeyboardNpcTalk = false;
                            break;
                        case Types.Keys.UP:
                        case Types.Keys.W:
                        case Types.Keys.Z:
                        case Types.Keys.KEYPAD_8:
                            game.player.moveUp = false;
                            game.player.disableKeyboardNpcTalk = false;
                            break;
                        case Types.Keys.DOWN:
                        case Types.Keys.S:
                        case Types.Keys.KEYPAD_2:
                            game.player.moveDown = false;
                            game.player.disableKeyboardNpcTalk = false;
                            break;
                        default:
                            break;
                    }
                }
            });

            $(document).keydown(function(e) {
                var key = e.which,
                    $chat = $('#chatinput');

                if($('#nameinput:focus').size() > 0 || $('#loginnameinput:focus').size() > 0 || $('#pwinput:focus').size() > 0 || $('#loginpwinput:focus').size() > 0 || $('#nova-hub input:focus').size() > 0) {
                    return;
                }

                if(key === Types.Keys.ENTER) {
                    if($('#chatbox').hasClass('active')) {
                        app.hideChat();
                    } else {
                        app.showChat();
                    }
                }
                else if(key === 16)
                    game.pvpFlag = true;
                if (game.started && !$('#chatbox').hasClass('active')) {
                    pos = {
                        x: game.player.gridX,
                        y: game.player.gridY
                    };
                    switch(key) {
                        case Types.Keys.LEFT:
                        case Types.Keys.A:
                        case Types.Keys.Q:
                        case Types.Keys.KEYPAD_4:
                            game.player.moveLeft = true;
                            break;
                        case Types.Keys.RIGHT:
                        case Types.Keys.D:
                        case Types.Keys.KEYPAD_6:
                            game.player.moveRight = true;
                            break;
                        case Types.Keys.UP:
                        case Types.Keys.W:
                        case Types.Keys.Z:
                        case Types.Keys.KEYPAD_8:
                            game.player.moveUp = true;
                            break;
                        case Types.Keys.DOWN:
                        case Types.Keys.S:
                        case Types.Keys.KEYPAD_2:
                            game.player.moveDown = true;
                            break;
                        case Types.Keys.SPACE:
                            game.makePlayerAttackClosest();
                            break;
                        case Types.Keys.I:
                            $('#achievementsbutton').click();
                            break;
                        case Types.Keys.B:
                            app.toggleInventory();
                            break;
                        case Types.Keys.KEY_1:
                            game.useInventoryItem(0);
                            break;
                        case Types.Keys.KEY_2:
                            game.useInventoryItem(1);
                            break;
                        case Types.Keys.KEY_3:
                            game.useInventoryItem(2);
                            break;
                        case Types.Keys.KEY_4:
                            game.useInventoryItem(3);
                            break;
                        case Types.Keys.KEY_5:
                            game.useInventoryItem(4);
                            break;
                        case Types.Keys.KEY_6:
                            game.useInventoryItem(5);
                            break;
                        case Types.Keys.H:
                            $('#helpbutton').click();
                            break;
                        case Types.Keys.M:
                            $('#mutebutton').click();
                            break;
                        case Types.Keys.P:
                            $('#playercount').click();
                            break;
                        default:
                            break;
                    }
                }
            });

             $(document).keyup(function(e) {
            	var key = e.which;

                if(key === 16)
                    game.pvpFlag = false;
            });

           var submitChatInput = function() {
                var $chat = $('#chatinput'),
                    placeholder = $chat.attr("placeholder") || '',
                    val = String($chat.val() || '').trim();

                if(val !== '' && val !== placeholder) {
                    if(game.player) {
                        game.say(val);
                    }
                }
                $chat.val('');
                app.hideChat();
                $('#foreground').focus();
                return false;
           };

           $('#chatinput').keydown(function(e) {
                var key = e.which;

                if(key === 13) {
                    return submitChatInput();
                }

                if(key === 27) {
                    $('#chatinput').val('');
                    app.hideChat();
                    return false;
                }
            });

            $('#chat-send-btn').bind('click touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                submitChatInput();
            });

            $('#chatinput').focus(function(e) {
                var placeholder = $(this).attr("placeholder");
                if ($(this).val() === placeholder) {
                    $(this).val('');
                }
            });

            $('#nameinput').focusin(function() {
                $('#name-tooltip').addClass('visible');
            });

            $('#nameinput').focusout(function() {
                $('#name-tooltip').removeClass('visible');
            });

            $('#nameinput').keypress(function(event) {
                $('#name-tooltip').removeClass('visible');
            });

            $('#mutebutton').click(function() {
                game.audioManager.toggle();
            });

            $(document).bind("keydown", function(e) {
                var key = e.which,
                    $chat = $('#chatinput');

                if(key === 13) { // Enter
                    if(game.started) {
                        $chat.focus();
                        return false;
                    } else {
                        if(app.loginFormActive() || app.createNewCharacterFormActive()) {
                            $('input').blur();      // exit keyboard on mobile
                            app.tryStartingGame();
                            return false;           // prevent form submit
                        }
                    }
                }

                if($('#chatinput:focus').size() == 0 && $('#nameinput:focus').size() == 0) {
                    if(key === 27) { // ESC
                        app.hideWindows();
                        _.each(game.player.attackers, function(attacker) {
                            attacker.stop();
                        });
                        return false;
                    }
                }
            });

            // Gestion de l'inventaire Nova Quest (6 emplacements)
            $('#inventory-toggle').click(function(e) {
                e.stopPropagation();
                app.toggleInventory();
            });

            $('#nova-inventory').click(function(e) {
                e.stopPropagation();
            });

            $('.inv-slot').click(function(e) {
                e.stopPropagation();
                var slot = parseInt($(this).attr('data-slot'), 10);
                if(game && game.started && !isNaN(slot)) {
                    game.useInventoryItem(slot);
                }
            });

            $('.inv-slot').bind('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var slot = parseInt($(this).attr('data-slot'), 10);
                if(game && game.started && !isNaN(slot)) {
                    game.dropInventoryItem(slot);
                }
                return false;
            });

            $('.inv-drop-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                var slot = parseInt($(this).closest('.inv-slot').attr('data-slot'), 10);
                if(game && game.started && !isNaN(slot)) {
                    game.dropInventoryItem(slot);
                }
                return false;
            });

             $('#healthbar').click(function(e) {
                var hb = $('#healthbar'),
                    hp = $('#hitpoints'),
                    hpg = $('#hpguide');

                var hbp = hb.position(),
                    hpp = hp.position();

                if((e.offsetX >= hpp.left) && (e.offsetX < hb.width())) {
                    if(hpg.css('display') === 'none') {
                        hpg.css('display', 'block');

                        setInterval(function () {
                            if(((game.player.hitPoints / game.player.maxHitPoints) <= game.hpGuide) && 
                               (game.healShortCut >= 0) && 
                               Types.isHealingItem(game.player.inventory[game.healShortCut]) &&
                               (game.player.inventoryCount[game.healShortCut] > 0)
                              ) {
                                game.eat(game.healShortCut);
                            }
                        }, 100);
                    }
                    hpg.css('left', e.offsetX + 'px');

                    game.hpGuide = (e.offsetX - hpp.left) / (hb.width()- hpp.left);
                }

                return false;
            });
           if(game.renderer.tablet) {
                $('body').addClass('tablet');
            }
        });
    };

    initApp();
});
