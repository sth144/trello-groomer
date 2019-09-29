"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var trello_interface_1 = require("./trello.interface");
var rxjs_1 = require("rxjs");
var operators_1 = require("rxjs/operators");
var request = require("request");
var BoardController = /** @class */ (function () {
    function BoardController(boardModel, secrets) {
        this.boardModel = boardModel;
        this.secrets = secrets;
        this.isAlive$ = new rxjs_1.ReplaySubject(1);
        this.isAlive = this.isAlive$.pipe(operators_1.first()).toPromise();
        this.buildModel();
    }
    BoardController.prototype.addCard = function (opts) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.asyncPost("/cards?idList=" + this.boardModel.lists.inbox.id, opts)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    // TODO: pass in args to determine behavior
    BoardController.prototype.updateTaskDependencies = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, checklists, _i, _b, checklistId, _c, _d, checklistItem, alreadyExists, _e, _f, name_1, parentCard, added, replacedCheckItem, _g, _h, card, attachments, _j, attachments_1, attachment, info, parsed, _k, info_1, item, split, prop, val, _l, _m, checklistItem, splitCheckItemName, _o, _p, card;
            return __generator(this, function (_q) {
                switch (_q.label) {
                    case 0:
                        checklists = this.boardModel.getChecklists();
                        _i = 0, _b = Object.keys(checklists);
                        _q.label = 1;
                    case 1:
                        if (!(_i < _b.length)) return [3 /*break*/, 9];
                        checklistId = _b[_i];
                        if (!(checklists[checklistId].name === "Test")) return [3 /*break*/, 8];
                        _c = 0, _d = checklists[checklistId].checkItems;
                        _q.label = 2;
                    case 2:
                        if (!(_c < _d.length)) return [3 /*break*/, 8];
                        checklistItem = _d[_c];
                        alreadyExists = false;
                        for (_e = 0, _f = this.boardModel.getAllCardNames(); _e < _f.length; _e++) {
                            name_1 = _f[_e];
                            if (checklistItem.name.indexOf(name_1) !== -1) {
                                alreadyExists = true;
                            }
                        }
                        if (!(!alreadyExists && checklistItem.state !== "complete")) return [3 /*break*/, 7];
                        parentCard = this.boardModel.getCardById(checklists[checklistId].idCard);
                        return [4 /*yield*/, this.addCard({
                                name: checklistItem.name,
                                due: parentCard.due,
                                idLabels: parentCard.idLabels
                            })];
                    case 3:
                        added = _q.sent();
                        /** change name of checklist item to include link */
                        return [4 /*yield*/, this.asyncDelete("/checklists/" + checklistId + "/checkItems/" + checklistItem.id + "/")];
                    case 4:
                        /** change name of checklist item to include link */
                        _q.sent();
                        return [4 /*yield*/, this.asyncPost("/checklists/" + checklistId + "/checkItems/", {
                                name: checklistItem.name.split("https://")[0] + " " + added.shortUrl
                            })];
                    case 5:
                        replacedCheckItem = _q.sent();
                        /** link added card to parent */
                        return [4 /*yield*/, this.asyncPost("/cards/" + added.id + "/attachments", {
                                name: "parent:" + parentCard.id + "|checklistId:" + checklistId + "|checkItemId:" + replacedCheckItem.id,
                                url: parentCard.shortUrl
                            })];
                    case 6:
                        /** link added card to parent */
                        _q.sent();
                        _q.label = 7;
                    case 7:
                        _c++;
                        return [3 /*break*/, 2];
                    case 8:
                        _i++;
                        return [3 /*break*/, 1];
                    case 9:
                        _g = 0, _h = this.boardModel.getAllCards();
                        _q.label = 10;
                    case 10:
                        if (!(_g < _h.length)) return [3 /*break*/, 13];
                        card = _h[_g];
                        if (!(card.dueComplete && card.badges.attachments > 0)) return [3 /*break*/, 12];
                        return [4 /*yield*/, this.asyncGet("/cards/" + card.id + "/attachments")];
                    case 11:
                        attachments = _q.sent();
                        for (_j = 0, attachments_1 = attachments; _j < attachments_1.length; _j++) {
                            attachment = attachments_1[_j];
                            if (attachment.name.indexOf("parent") !== -1) {
                                info = attachment.name.split("|");
                                parsed = {};
                                for (_k = 0, info_1 = info; _k < info_1.length; _k++) {
                                    item = info_1[_k];
                                    split = item.split(":");
                                    prop = split[0];
                                    val = split[1];
                                    Object.assign(parsed, (_a = {}, _a[prop] = val, _a));
                                }
                                if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")) {
                                    this.asyncPut("/cards/" + parsed.parent + "/checkItem/" + parsed.checkItemId + "?"
                                        + "state=complete").catch(function (err) {
                                        console.log(err);
                                    });
                                }
                            }
                        }
                        _q.label = 12;
                    case 12:
                        _g++;
                        return [3 /*break*/, 10];
                    case 13:
                        _l = 0, _m = this.boardModel.getAllChecklistItems();
                        _q.label = 14;
                    case 14:
                        if (!(_l < _m.length)) return [3 /*break*/, 19];
                        checklistItem = _m[_l];
                        if (!(checklistItem.state === "complete")) return [3 /*break*/, 18];
                        splitCheckItemName = checklistItem.name.split(" https://");
                        if (!(splitCheckItemName.length > 1)) return [3 /*break*/, 18];
                        _o = 0, _p = this.boardModel.getAllCards();
                        _q.label = 15;
                    case 15:
                        if (!(_o < _p.length)) return [3 /*break*/, 18];
                        card = _p[_o];
                        if (!(checklistItem.name.indexOf(card.shortUrl) !== -1)) return [3 /*break*/, 17];
                        return [4 /*yield*/, this.asyncPut("/cards/" + card.id + "?dueComplete=true")];
                    case 16:
                        _q.sent();
                        _q.label = 17;
                    case 17:
                        _o++;
                        return [3 /*break*/, 15];
                    case 18:
                        _l++;
                        return [3 /*break*/, 14];
                    case 19: return [2 /*return*/];
                }
            });
        });
    };
    BoardController.prototype.moveCardsFromToIf = function (fromListIds, toListId, filter) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, fromListIds_1, fromListId, from, fromListCards, _a, fromListCards_1, card;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _i = 0, fromListIds_1 = fromListIds;
                        _b.label = 1;
                    case 1:
                        if (!(_i < fromListIds_1.length)) return [3 /*break*/, 6];
                        fromListId = fromListIds_1[_i];
                        from = this.boardModel.getListById(fromListId);
                        fromListCards = from.getCards();
                        _a = 0, fromListCards_1 = fromListCards;
                        _b.label = 2;
                    case 2:
                        if (!(_a < fromListCards_1.length)) return [3 /*break*/, 5];
                        card = fromListCards_1[_a];
                        if (!filter(card)) return [3 /*break*/, 4];
                        // TODO: this should be encapsulated in a moveCard operation
                        return [4 /*yield*/, this.asyncPut("/cards/" + card.id + "?idList=" + toListId + "&pos=top")];
                    case 3:
                        // TODO: this should be encapsulated in a moveCard operation
                        _b.sent();
                        /** update local model */
                        [fromListId, toListId].forEach(function (id) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        _a = this.boardModel.getListById(id);
                                        return [4 /*yield*/, this.asyncGet("/lists/" + id + "/cards")];
                                    case 1:
                                        _a.cards = _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        _b.label = 4;
                    case 4:
                        _a++;
                        return [3 /*break*/, 2];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    BoardController.prototype.buildModel = function () {
        return __awaiter(this, void 0, void 0, function () {
            var listsOnBoard, _i, listsOnBoard_1, responseList, _a, _b, listNameToFetch, _c, checklistsOnBoard, _d, checklistsOnBoard_1, responseChecklist, _e, _f, responseCheckItem, newCheckItem;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, this.asyncGet("/board/" + this.boardModel.id + "/lists")];
                    case 1:
                        listsOnBoard = _g.sent();
                        _i = 0, listsOnBoard_1 = listsOnBoard;
                        _g.label = 2;
                    case 2:
                        if (!(_i < listsOnBoard_1.length)) return [3 /*break*/, 7];
                        responseList = listsOnBoard_1[_i];
                        _a = 0, _b = this.boardModel.getListNames();
                        _g.label = 3;
                    case 3:
                        if (!(_a < _b.length)) return [3 /*break*/, 6];
                        listNameToFetch = _b[_a];
                        if (!(responseList.name.toLowerCase().indexOf(listNameToFetch) !== -1)) return [3 /*break*/, 5];
                        Object.assign(this.boardModel.lists[listNameToFetch], {
                            id: responseList.id,
                            name: responseList.name,
                            cards: []
                        });
                        _c = this.boardModel.lists[listNameToFetch];
                        return [4 /*yield*/, this.asyncGet("/lists/" + responseList.id + "/cards")];
                    case 4:
                        _c.cards
                            = _g.sent();
                        _g.label = 5;
                    case 5:
                        _a++;
                        return [3 /*break*/, 3];
                    case 6:
                        _i++;
                        return [3 /*break*/, 2];
                    case 7:
                        ;
                        return [4 /*yield*/, this.asyncGet("/boards/" + this.boardModel.id + "/checklists")];
                    case 8:
                        checklistsOnBoard = _g.sent();
                        for (_d = 0, checklistsOnBoard_1 = checklistsOnBoard; _d < checklistsOnBoard_1.length; _d++) {
                            responseChecklist = checklistsOnBoard_1[_d];
                            this.boardModel.checkLists[responseChecklist.id] = new trello_interface_1.Checklist();
                            Object.assign(this.boardModel.checkLists[responseChecklist.id], {
                                id: responseChecklist.id,
                                name: responseChecklist.name,
                                idCard: responseChecklist.idCard,
                            });
                            for (_e = 0, _f = responseChecklist.checkItems; _e < _f.length; _e++) {
                                responseCheckItem = _f[_e];
                                newCheckItem = new trello_interface_1.CheckItem();
                                Object.assign(newCheckItem, {
                                    id: responseCheckItem.id,
                                    idChecklist: responseCheckItem.idChecklist,
                                    name: responseCheckItem.name,
                                    state: responseCheckItem.state
                                });
                                this.boardModel.checkLists[responseChecklist.id].checkItems.push(newCheckItem);
                            }
                        }
                        this.isAlive$.next(true);
                        return [2 /*return*/];
                }
            });
        });
    };
    BoardController.prototype.asyncGet = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        request({
                            method: "GET",
                            uri: _this.getLongUrl(url),
                        }, function (err, response, body) {
                            resolve(JSON.parse(body));
                        });
                    })];
            });
        });
    };
    BoardController.prototype.asyncPut = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        request({
                            method: "PUT",
                            uri: _this.getLongUrl(url)
                        }, function (err, response, body) {
                            resolve(JSON.parse(body));
                        });
                    })];
            });
        });
    };
    BoardController.prototype.asyncPost = function (url, opts) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var params = "";
                        for (var _i = 0, _a = Object.keys(opts); _i < _a.length; _i++) {
                            var prop = _a[_i];
                            params = params.concat("&" + prop + "=" + opts[prop]);
                        }
                        var uri = "" + _this.getLongUrl(url) + params;
                        request({
                            method: "POST",
                            uri: uri
                        }, function (err, response, body) {
                            resolve(JSON.parse(body));
                        });
                    })];
            });
        });
    };
    BoardController.prototype.asyncDelete = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        request({
                            method: "DELETE",
                            uri: _this.getLongUrl(url)
                        }, function (err, response, body) {
                            resolve(JSON.parse(body));
                        });
                    })];
            });
        });
    };
    BoardController.prototype.getLongUrl = function (url) {
        var end = "key=" + this.secrets.key + "&token=" + this.secrets.token;
        if (url.indexOf("?") === -1) {
            end = "?".concat(end);
        }
        else {
            end = "&".concat(end);
        }
        return "https://api.trello.com/1" + url + end;
    };
    return BoardController;
}());
exports.BoardController = BoardController;
//# sourceMappingURL=board.controller.js.map