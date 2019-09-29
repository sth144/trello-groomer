"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var CheckItem = /** @class */ (function () {
    function CheckItem() {
        this.id = "";
        this.idChecklist = "";
        this.name = "";
        this.state = "";
    }
    return CheckItem;
}());
exports.CheckItem = CheckItem;
var Checklist = /** @class */ (function () {
    function Checklist() {
        this.id = "";
        this.name = "";
        this.idCard = "";
        this.checkItems = [];
    }
    return Checklist;
}());
exports.Checklist = Checklist;
var List = /** @class */ (function () {
    function List() {
        this.id = "";
        this.name = "";
        this.cards = [];
    }
    List.prototype.getCardIds = function () {
        return Object.keys(this.cards);
    };
    List.prototype.getCardNames = function () {
        return this.getCards().map(function (x) { return x.name; });
    };
    List.prototype.getCards = function () {
        return this.cards;
    };
    return List;
}());
exports.List = List;
var BoardModel = /** @class */ (function () {
    function BoardModel() {
        this.id = "";
        /** lists indexed by name, not id */
        this.lists = {};
        this.checkLists = {};
    }
    BoardModel.prototype.getAllCards = function () {
        var allCards = [];
        for (var listName in this.lists) {
            allCards = allCards.concat.apply(allCards, this.lists[listName].getCards());
        }
        return allCards;
    };
    BoardModel.prototype.getAllCardNames = function () {
        var allNames = [];
        for (var listName in this.lists) {
            allNames = allNames.concat.apply(allNames, this.lists[listName].getCardNames());
        }
        return allNames;
    };
    BoardModel.prototype.getCardById = function (id) {
        for (var _i = 0, _a = this.getListsAsArray(); _i < _a.length; _i++) {
            var list = _a[_i];
            for (var _b = 0, _c = list.cards; _b < _c.length; _b++) {
                var card = _c[_b];
                if (card.id === id) {
                    return card;
                }
            }
        }
    };
    BoardModel.prototype.getListById = function (id) {
        for (var _i = 0, _a = this.getListsAsArray(); _i < _a.length; _i++) {
            var list = _a[_i];
            if (list.id === id) {
                return list;
            }
        }
    };
    BoardModel.prototype.getListIds = function () {
        return this.getListsAsArray().map(function (x) { return x.id; });
    };
    BoardModel.prototype.getListNames = function () {
        return Object.keys(this.lists);
    };
    BoardModel.prototype.getLists = function () {
        return this.lists;
    };
    BoardModel.prototype.getListsAsArray = function () {
        var result = [];
        for (var _i = 0, _a = this.getListNames(); _i < _a.length; _i++) {
            var name_1 = _a[_i];
            result.push(this.lists[name_1]);
        }
        return result;
    };
    BoardModel.prototype.getChecklistIds = function () {
        return Object.keys(this.checkLists);
    };
    BoardModel.prototype.getChecklists = function () {
        return this.checkLists;
    };
    BoardModel.prototype.getChecklistsAsArray = function () {
        var result = [];
        for (var _i = 0, _a = this.getChecklistIds(); _i < _a.length; _i++) {
            var id = _a[_i];
            result.push(this.checkLists[id]);
        }
        return result;
    };
    BoardModel.prototype.getAllChecklistItems = function () {
        var result = [];
        for (var _i = 0, _a = this.getChecklistsAsArray(); _i < _a.length; _i++) {
            var checklist = _a[_i];
            result = result.concat(checklist.checkItems);
        }
        return result;
    };
    return BoardModel;
}());
exports.BoardModel = BoardModel;
//# sourceMappingURL=trello.interface.js.map