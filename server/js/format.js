var Class = require('./lib/class').Class;
var Types = require('../../shared/js/gametypes');

var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || 9007199254740991;

function integer(value, min, max) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function text(value, max, allowEmpty) {
    return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
}

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// Every Hub action has an explicit payload. Reject unexpected keys as well as bad types.
var hubSchemas = {
    refresh: {},
    bag_equip: { slot: 'slot' },
    bag_drop: { slot: 'slot' },
    shop_buy: { itemKind: 'kind' },
    market_sell: { slotType: 'equipment', price: 'price' },
    market_buy: { marketId: 'id' },
    guild_create: { tag: 'tag', name: 'guildName' },
    guild_deposit: { amount: 'id' },
    guild_buy_hall: {},
    guild_tp_hall: {},
    guild_leave_hall: {},
    guild_summon_boss: { bossKind: 'optionalKind' },
    guild_spawn_chest: {},
    guild_invite: { targetName: 'name' },
    guild_accept: { guildId: 'id' },
    guild_decline: { guildId: 'id' },
    guild_leave: {},
    guild_kick: { targetName: 'name' },
    guild_chat: { message: 'chat' },
    admin_tp: { targetName: 'name' },
    admin_gold: { targetName: 'name' },
    admin_give_goldensword: { targetName: 'name' },
    admin_heal: { targetName: 'name' },
    admin_kick: { targetName: 'name' },
    admin_ban: { targetName: 'name' },
    admin_spawn: { mobKind: 'kind' },
    admin_spawn_chest: {},
    admin_announce: { text: 'announcement' }
};

function hubValue(value, type) {
    switch (type) {
    case 'slot': return integer(value, 0, 5);
    case 'id': return integer(value, 1, MAX_SAFE_INTEGER);
    case 'price': return integer(value, 1, 999999);
    case 'equipment': return value === 'weapon' || value === 'armor';
    case 'kind': return text(value, 40) && /^[a-z0-9]+$/.test(value);
    case 'optionalKind': return value === undefined || hubValue(value, 'kind');
    case 'name': return text(value, 12);
    case 'tag': return text(value, 4) && value.trim().length >= 2;
    case 'guildName': return text(value, 20) && value.trim().length >= 3;
    case 'chat': return text(value, 60);
    case 'announcement': return text(value, 120);
    default: return false;
    }
}

function checkHub(action, payload) {
    if (!Object.prototype.hasOwnProperty.call(hubSchemas, action) || !plainObject(payload)) return false;
    var schema = hubSchemas[action];
    if (!Object.keys(payload).every(function (key) { return Object.prototype.hasOwnProperty.call(schema, key); })) return false;
    return Object.keys(schema).every(function (key) { return hubValue(payload[key], schema[key]); });
}

var FormatChecker = Class.extend({
    init: function () {
        this.formats = [];
        this.formats[Types.Messages.MOVE] = ['n', 'n'];
        this.formats[Types.Messages.LOOTMOVE] = ['n', 'n', 'n'];
        this.formats[Types.Messages.AGGRO] = ['n'];
        this.formats[Types.Messages.ATTACK] = ['n'];
        this.formats[Types.Messages.HIT] = ['n'];
        this.formats[Types.Messages.HURT] = ['n'];
        this.formats[Types.Messages.CHAT] = ['s'];
        this.formats[Types.Messages.LOOT] = ['n'];
        this.formats[Types.Messages.TELEPORT] = ['n', 'n'];
        this.formats[Types.Messages.ZONE] = [];
        this.formats[Types.Messages.OPEN] = ['n'];
        this.formats[Types.Messages.CHECK] = ['n'];
    },

    check: function (msg) {
        if (!Array.isArray(msg) || !integer(msg[0], 0, 255)) return false;
        var type = msg[0], message = msg.slice(1), format = this.formats[type];
        if (type === Types.Messages.CREATE || type === Types.Messages.LOGIN) {
            var validLength = type === Types.Messages.CREATE ? (message.length === 2 || message.length === 3) : message.length === 2;
            return validLength && text(message[0], 64) && text(message[1], 256) &&
                (message.length === 2 || text(message[2], 254, true));
        }
        if (type === Types.Messages.GOOGLE_LOGIN) {
            return (message.length === 1 || message.length === 2) &&
                text(message[0], 4096) &&
                (message.length === 1 || text(message[1], 128, true));
        }
        if (type === Types.Messages.HUB) return message.length === 2 && typeof message[0] === 'string' && checkHub(message[0], message[1]);
        if (type === Types.Messages.INVENTORY) {
            return message.length === 3 && ['use', 'eat', 'armor', 'avatar', 'drop', 'empty'].indexOf(message[0]) !== -1 &&
                integer(message[1], 0, 5) && integer(message[2], 1, 999999);
        }
        if (type === Types.Messages.ACHIEVEMENT) {
            return message.length === 2 && integer(message[0], 0, 255) && message[1] === 'found';
        }
        if (format) {
            return message.length === format.length && message.every(function (value, index) {
                return format[index] === 'n' ? integer(value, 0, MAX_SAFE_INTEGER) : text(value, 1024, true);
            });
        }
        if (type === Types.Messages.WHO) {
            return message.length > 0 && message.length <= 512 && message.every(function (value) { return integer(value, 0, MAX_SAFE_INTEGER); });
        }
        if (type === Types.Messages.GUILD) {
            var action = message[0], guild = Types.Messages.GUILDACTION;
            if (action === guild.CREATE) return message.length === 2 && text(message[1], 20);
            if (action === guild.INVITE) return message.length === 2 && text(message[1], 12);
            if (action === guild.JOIN) return message.length === 3 && integer(message[1], 1, MAX_SAFE_INTEGER) && typeof message[2] === 'boolean';
            if (action === guild.LEAVE) return message.length === 1;
            if (action === guild.TALK) return message.length === 2 && text(message[1], 60);
        }
        return false;
    }
});

var checker = new FormatChecker();
exports.check = checker.check.bind(checker);
exports.checkHub = checkHub;
