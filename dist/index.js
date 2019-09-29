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
var _this = this;
Object.defineProperty(exports, "__esModule", { value: true });
var todo_board_model_1 = require("./todo.board.model");
var board_controller_1 = require("./board.controller");
var secrets = require("../key.json");
var model = new todo_board_model_1.ToDoBoardModel("cK9nA9nR");
var controller = new board_controller_1.BoardController(model, {
    key: secrets.key,
    token: secrets.token
});
controller.isAlive.then(function () { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: 
            // const express = require("express");
            // const app = express();
            // app.get("/", (req: any, res: any) => {
            //     res.send("HELLO");
            // });
            // app.listen(4500, () => console.log("LISTENING"));
            /** order is important here */
            return [4 /*yield*/, controller.moveCardsFromToIf([
                    model.lists.inbox.id,
                    model.lists.backlog.id,
                    model.lists.month.id,
                    model.lists.week.id,
                    model.lists.day.id
                ], model.lists.done.id, cardIsComplete)];
            case 1:
                // const express = require("express");
                // const app = express();
                // app.get("/", (req: any, res: any) => {
                //     res.send("HELLO");
                // });
                // app.listen(4500, () => console.log("LISTENING"));
                /** order is important here */
                _a.sent();
                return [4 /*yield*/, controller.moveCardsFromToIf([
                        model.lists.inbox.id,
                        model.lists.backlog.id,
                        model.lists.month.id,
                        model.lists.week.id,
                    ], model.lists.day.id, cardDueToday)];
            case 2:
                _a.sent();
                return [4 /*yield*/, controller.moveCardsFromToIf([
                        model.lists.month.id,
                    ], model.lists.week.id, cardDueThisWeek)];
            case 3:
                _a.sent();
                return [4 /*yield*/, controller.moveCardsFromToIf([
                        model.lists.inbox.id,
                        model.lists.backlog.id,
                    ], model.lists.month.id, cardDueThisMonth)];
            case 4:
                _a.sent();
                return [4 /*yield*/, controller.moveCardsFromToIf([
                        model.lists.inbox.id
                    ], model.lists.backlog.id, cardHasDueDate)];
            case 5:
                _a.sent();
                return [4 /*yield*/, controller.updateTaskDependencies()];
            case 6:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
var cardIsComplete = function (card) {
    if (card.dueComplete) {
        return true;
    }
    return false;
};
var cardDueToday = function (card) {
    if (cardHasDueDate(card)) {
        var dueDate = new Date(card.due);
        var today = new Date();
        var tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        return (+dueDate < +tomorrow);
    }
    return false;
};
var cardDueThisWeek = function (card) {
    if (cardHasDueDate(card)) {
        var dueDate = new Date(card.due);
        var today = new Date();
        var nextSunday = getNextWeekDay(today, Weekday.Sunday);
        return (+dueDate <= +nextSunday);
    }
    return false;
};
var cardDueThisMonth = function (card) {
    if (cardHasDueDate(card)) {
        var dueDate = new Date(card.due);
        var today = new Date();
        var firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        return (+dueDate < +firstOfNextMonth);
    }
    return false;
};
var cardHasDueDate = function (card) {
    if (card.due === null || card.due === undefined)
        return false;
    return true;
};
var Weekday;
(function (Weekday) {
    Weekday[Weekday["Sunday"] = 0] = "Sunday";
    Weekday[Weekday["Monday"] = 1] = "Monday";
    Weekday[Weekday["Tuesday"] = 2] = "Tuesday";
    Weekday[Weekday["Wednesday"] = 3] = "Wednesday";
    Weekday[Weekday["Thursday"] = 4] = "Thursday";
    Weekday[Weekday["Friday"] = 5] = "Friday";
    Weekday[Weekday["Saturday"] = 6] = "Saturday";
})(Weekday || (Weekday = {}));
function getNextWeekDay(date, dayOfWeek) {
    var resultDate = new Date(date.getTime());
    resultDate.setDate(date.getDate() + (7 + dayOfWeek - date.getDay()) % 7);
    return resultDate;
}
//# sourceMappingURL=index.js.map