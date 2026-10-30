define(['character'], function(Character) {

    var NpcTalk = {
        "guard": [
            "Halte là, voyageur !",
            "Pas besoin de voir vos papiers...",
            "Vous n'êtes pas le brigand que nous recherchons.",
            "Circulez, circulez..."
        ],

        "king": [
            "Salutations, je suis le Roi !",
            "Je dirige ce royaume",
            "Comme un chef",
            "Je parle à mes sujets",
            "Comme un chef",
            "Je porte une couronne d'or",
            "Comme un chef",
            "Je ne fais rien de la journée",
            "Comme un chef",
            "Maintenant laissez-moi tranquille",
            "Comme un chef"
        ],

        "villagegirl": [
            "Bonjour, aventurier !",
            "Comment trouvez-vous Nova Quest ?",
            "Tout se passe en temps réel dans votre navigateur ! C'est fou, non ?",
            "Cette édition est développée par UNIVERS NOVA STUDIO.",
            "Utilisez votre inventaire en bas de l'écran et le chat pour parler aux autres joueurs !",
            'Découvrez l\'éditeur sur <a target="_blank" href="https://github.com/Playerxr">github.com/Playerxr</a> !'
        ],

        "villager": [
            "Salut l'étranger ! Aimez-vous la poésie ?",
            "Les roses sont rouges, les violettes sont bleues...",
            "J'aime chasser les rats, et vous aussi tant mieux...",
            "Les rats sont vaincus, que faire maintenant ?",
            "À vrai dire, je n'en sais rien franchement.",
            "Peut-être que la forêt saurait vous tenter...",
            "ou alors un bon ragoût de rat à mijoter."
        ],

        "agent": [
            "N'essayez pas de plier l'épée.",
            "C'est impossible.",
            "Essayez plutôt de réaliser la vérité...",
            "Il n'y a pas d'épée."
        ],

        "rick": [
            "Nous ne sommes pas étrangers à l'aventure",
            "Vous connaissez les règles, et moi aussi",
            "Un engagement total, voilà ce à quoi je pense",
            "Je veux juste vous dire ce que je ressens",
            "Je ne vous abandonnerai jamais !",
            "Je ne vous laisserai jamais tomber !",
            "Je ne partirai jamais en courant sans vous !"
        ],

        "scientist": [{
			"text": [//default
				"Salutations.",
				"Je suis l'alchimiste qui a créé ces deux potions.",
				"La potion rouge restaurera vos points de vie ou ira dans votre sac...",
				"La potion orange vous transformera en renard de feu invincible...",
				"Mais son effet ne dure qu'un court instant.",
				"Alors faites-en bon usage !",
				"Maintenant, excusez-moi, je dois retourner à mes expériences..."
			]},
			{"condition": function(game){return (game.player.invincible);},
			 "text": [
				"N'avez-vous donc pas écouté ce que j'ai dit ?!!",
				"La fameuse potion de feu ne dure que quelques secondes !",
				"Ne les gaspillez pas à bavarder avec moi…"
			]},
			{"condition": function(game){return ((game.player.getSpriteName() == "firefox")
											&& !(game.player.invincible));},
			 "text": [
				"Ha ha ha, *name*",
				"Tout ce qui brille n'est pas or…",
				"-soupir-",
				"Pensiez-vous vraiment pouvoir me tromper avec ce déguisement ?",
				"C'est moi qui ai conçu cette potion.",
				"N'espérez pas effrayer les monstres avec cette tenue,",
				"Ils vous attaqueront peu importe votre apparence !"
			]}
			
		],

        "nyan": [
            "nyan nyan nyan nyan nyan",
            "nyan nyan nyan nyan nyan nyan nyan",
            "nyan nyan nyan nyan nyan nyan",
            "nyan nyan nyan nyan nyan nyan nyan nyan"
        ],

        "beachnpc": [
            "Ne faites pas attention à moi, je suis en vacances.",
            "Mais je dois avouer...",
            "Ces crabes géants sont vraiment agaçants.",
            "Pourriez-vous m'en débarrasser s'il vous plaît ?"
        ],

        "forestnpc": [
            "Les bois sont sombres et pleins de gobelins...",
            "Gardez toujours une potion dans votre inventaire !"
        ],

        "desertnpc": [
            "On ne s'aventure pas simplement dans ces montagnes...",
            "Un ancien seigneur mort-vivant régnerait en ces lieux.",
            "Personne ne sait exactement à quoi il ressemble...",
            "...car aucun survivant n'est revenu pour le raconter.",
            "Il n'est pas trop tard pour faire demi-tour, jeune héros."
        ],

        "lavanpc": [
            "La chaleur du volcan est étouffante...",
            "Seuls les guerriers les mieux équipés survivent ici."
        ],

        "priest": [
            "Oh, bonjour jeune aventurier.",
            "La sagesse est primordiale, laissez-moi vous donner quelques conseils.",
            "Vous êtes libre d'explorer ce monde comme bon vous semble,",
            "mais prenez garde aux nombreux ennemis qui vous attendent.",
            "Vous trouverez des armes et armures en terrassant des monstres.",
            "Plus l'ennemi est puissant, plus la récompense sera grande.",
            "Vos objets trouvés peuvent être stockés dans votre inventaire (touche B).",
            "Cliquez sur l'icône de trophée en bas à droite pour voir vos Hauts Faits.",
            "Profitez bien des nombreuses surprises de Nova Quest !",
            "Adieu, jeune ami."
        ],

        "sorcerer": [
            "Ah... J'avais prédit votre venue.",
            "Alors ? Comment trouvez-vous mon nouveau bâton ?",
            "Plutôt impressionnant, n'est-ce pas ?",
            "Où je l'ai trouvé, demandez-vous ?",
            "Je comprends. C'est facile d'être envieux.",
            "En réalité, je l'ai forgé moi-même grâce à ma magie.",
            "Mais laissez-moi vous confier un secret...",
            "Il existe de nombreux trésors cachés dans ce monde.",
            "Certains sont bien plus puissants que d'autres.",
            "Pour les dénicher, l'exploration est la clé.",
            "Bonne chance !"
        ],

        "octocat": [
            "Bienvenue dans Nova Quest !",
            "Un jeu propulsé par UNIVERS NOVA STUDIO.",
            'Retrouvez l\'éditeur sur <a target="_blank" href="https://github.com/Playerxr">github.com/Playerxr</a>'
        ],

        "coder": [
            "Salut ! Saviez-vous que vous pouvez aussi jouer à Nova Quest entre amis ?",
            "C'est toute la magie du HTML5 et des WebSockets par UNIVERS NOVA STUDIO !",
            "Amusez-vous bien !"
        ],

        "othernpc": [
            "Bienvenue sur les terres de Nova Quest !",
            "Que la fortune sourie à votre lame."
        ]
    };

    var Npc = Character.extend({
        init: function(id, kind) {
            this._super(id, kind, 1);
            this.itemKind = Types.getKindAsString(this.kind);
            if(typeof NpcTalk[this.itemKind][0] === 'string'){
				this.discourse = -1;
				this.talkCount = NpcTalk[this.itemKind].length;
			}
			else{
				this.discourse = 0;
				this.talkCount = NpcTalk[this.itemKind][this.discourse]["text"].length;
			}
            this.talkIndex = 0;
        },
        
        selectTalk: function(game){
			var change = false;
			if(this.discourse != -1){
				var found = false;
				for(var i = 1; !found && i<NpcTalk[this.itemKind].length; i++){
					if(NpcTalk[this.itemKind][i]["condition"](game)){
						if(this.discourse != i){
							change = true;
							this.discourse = i;
							this.talkCount = NpcTalk[this.itemKind][this.discourse]["text"].length;
						}
						found = true;
					}
				}
				if(!found){
					if(this.discourse != 0){
						change = true;
						this.discourse = 0;
						this.talkCount = NpcTalk[this.itemKind][this.discourse]["text"].length;
					}
				}
			}
			return change;
		},

        talk: function(game) {
            var msg = "";

            if(this.selectTalk(game) || (this.talkIndex > this.talkCount) ){
                this.talkIndex = 0;
            }
            if(this.talkIndex < this.talkCount) {
				if(this.discourse == -1){
					msg = NpcTalk[this.itemKind][this.talkIndex];
				}
				else{
					msg = NpcTalk[this.itemKind][this.discourse]["text"][this.talkIndex];
				}
            }
            if(this.talkIndex === 0 && game && game.client && typeof game.client.sendHub === 'function') {
                game.client.sendHub('npc_quest_interact', { npcKind: this.itemKind });
            }
            this.talkIndex += 1;

            return msg.replace('*name*',game.player.name);
        }
    });

    return Npc;
});
