
define(['item'], function(Item) {

    var Items = {

        Sword2: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.SWORD2, "weapon");
                this.lootMessage = "Vous ramassez une épée en acier";
            },
        }),

        Axe: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.AXE, "weapon");
                this.lootMessage = "Vous ramassez une hache";
            },
        }),

        RedSword: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.REDSWORD, "weapon");
                this.lootMessage = "Vous ramassez une épée flamboyante";
            },
        }),

        BlueSword: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.BLUESWORD, "weapon");
                this.lootMessage = "Vous ramassez une épée magique";
            },
        }),

        GoldenSword: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.GOLDENSWORD, "weapon");
                this.lootMessage = "Vous ramassez l'épée ultime";
            },
        }),

        MorningStar: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.MORNINGSTAR, "weapon");
                this.lootMessage = "Vous ramassez un fléau d'armes";
            },
        }),

        LeatherArmor: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.LEATHERARMOR, "armor");
                this.lootMessage = "Vous équipez une armure de cuir";
            },
        }),

        MailArmor: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.MAILARMOR, "armor");
                this.lootMessage = "Vous équipez une cotte de mailles";
            },
        }),

        PlateArmor: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.PLATEARMOR, "armor");
                this.lootMessage = "Vous équipez une armure de plaques";
            },
        }),

        RedArmor: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.REDARMOR, "armor");
                this.lootMessage = "Vous équipez une armure de rubis";
            },
        }),

        GoldenArmor: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.GOLDENARMOR, "armor");
                this.lootMessage = "Vous équipez une armure d'or";
            },
        }),

        Flask: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.FLASK, "object");
                this.lootMessage = "Vous ramassez une potion de soin (+40 PV)";
            },
        }),

        Cake: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.CAKE, "object");
                this.lootMessage = "Vous ramassez un gâteau (+60 PV)";
            },
        }),

        Burger: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.BURGER, "object");
                this.lootMessage = "Vous ramassez un burger royal (+100 PV)";
            },
        }),

        FirePotion: Item.extend({
            init: function(id) {
                this._super(id, Types.Entities.FIREPOTION, "object");
                this.lootMessage = "Vous ressentez la puissance ardente de Nova !";
            },

            onLoot: function(player) {
                player.startInvincibility();
            },
        }),
    };

    return Items;
});
