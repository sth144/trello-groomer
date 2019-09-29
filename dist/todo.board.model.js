"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var trello_interface_1 = require("./trello.interface");
var ToDoBoardModel = /** @class */ (function (_super) {
    __extends(ToDoBoardModel, _super);
    function ToDoBoardModel(_id) {
        var _this = _super.call(this) || this;
        _this.lists = {
            inbox: new trello_interface_1.List(),
            backlog: new trello_interface_1.List(),
            month: new trello_interface_1.List(),
            week: new trello_interface_1.List(),
            day: new trello_interface_1.List(),
            done: new trello_interface_1.List(),
            history: new trello_interface_1.List()
        };
        _this.id = _id;
        return _this;
    }
    return ToDoBoardModel;
}(trello_interface_1.BoardModel));
exports.ToDoBoardModel = ToDoBoardModel;
//# sourceMappingURL=todo.board.model.js.map