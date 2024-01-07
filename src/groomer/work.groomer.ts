import { BoardModel } from "../model/board.model";
import { List } from "../lib/list.interface";
import { BoardController } from "../controller/board.controller";
import { logger } from "../lib/logger";
import {
  cardIsComplete,
  cardDueToday,
  cardDueThisWeek,
  cardHasDueDate,
  wasMovedFromToListFilterFactory,
  Not,
} from "../lib/card.filters";
import { join } from "path";
import { existsSync } from "fs";
import { parseAutoDueConfig } from "../lib/parse.utils";
const secrets = require("../../config/key.json");
const boards = require("../../config/boards.json");

export class WorkBoardModel extends BoardModel {
  lists: {
    inbox: List;
    backlog: List;
    week: List;
    day: List;
    done: List;
    pinned: List;
    backburner: List;
  } = {
    inbox: new List(),
    backlog: new List(),
    week: new List(),
    day: new List(),
    done: new List(),
    pinned: new List(),
    backburner: new List(),
  };
  constructor(id: string) {
    super();
    this._id = id;
  }
}

export const WorkGroomer = function () {
  let start: Date;

  let workModel: WorkBoardModel;
  let workController: BoardController<WorkBoardModel>;

  const initialize = async () => {
    start = new Date();
    logger.info("Started " + start.toString());

    logger.info("Building model");
    workModel = new WorkBoardModel(boards.work.id);

    logger.info("Initializing controllers");
    workController = new BoardController<WorkBoardModel>(workModel, {
      key: secrets.key,
      token: secrets.token,
    });

    await workController.wakeUp();
  };

  const groom = async () => {
    logger.info("Grooming (Work)");

    delete require.cache;

    /** assign due dates to cards without due dates */
    const autoDueConfigPath = join(
      process.cwd(),
      "config/auto-due.config.json"
    );
    if (existsSync(autoDueConfigPath)) {
      const autoDueConfig = parseAutoDueConfig(autoDueConfigPath) as {
        [s: string]: number;
      };

      logger.info("Updating due dates based on manual list movements");

      await workController.assignDueDatesIf(
        workModel.lists.backlog.id,
        autoDueConfig.backlog,
        wasMovedFromToListFilterFactory(workModel.lists.backlog.id, [
          workModel.lists.week.id,
          workModel.lists.day.id,
        ]),
        7 /** one week of random stagger (unique on per card basis, not per call to assignDueDatesIf */
      );
      await workController.assignDueDatesIf(
        workModel.lists.week.id,
        autoDueConfig.week,
        wasMovedFromToListFilterFactory(workModel.lists.week.id, [
          workModel.lists.day.id,
        ])
      );

      await workController.assignDueDatesIf(
        workModel.lists.day.id,
        autoDueConfig.day,
        Not(cardHasDueDate)
      );
      await workController.assignDueDatesIf(
        workModel.lists.week.id,
        autoDueConfig.week,
        Not(cardHasDueDate)
      );
      await workController.assignDueDatesIf(
        workModel.lists.backlog.id,
        autoDueConfig.backlog,
        Not(cardHasDueDate)
      );

      const autoLabelConfigPath = join(
        process.cwd(),
        "config/auto-label.config.json"
      );
      if (existsSync(autoLabelConfigPath)) {
        const autoLabelConfig = require(autoLabelConfigPath);

        Object.keys(autoLabelConfig).forEach(async (labelName) => {
          await workController.addLabelToCardsInListIfTextContains(
            labelName,
            autoLabelConfig[labelName]
          );
        });
      }
    }

    logger.info("Updating list placements");

    await workController.moveCardsFromToIf(
      [
        workModel.lists.inbox.id,
        workModel.lists.backlog.id,
        workModel.lists.week.id,
        workModel.lists.day.id,
      ],
      workModel.lists.done.id,
      cardIsComplete
    );

    /** move cards due today to Today */
    await workController.moveCardsFromToIf(
      [
        workModel.lists.inbox.id,
        workModel.lists.backlog.id,
        workModel.lists.week.id,
      ],
      workModel.lists.day.id,
      cardDueToday
    );

    /** move cards due this week to Week */
    await workController.moveCardsFromToIf(
      [workModel.lists.inbox.id, workModel.lists.backlog.id],
      workModel.lists.week.id,
      cardDueThisWeek
    );

    /** move all cards in inbox with due date to backlog */
    await workController.moveCardsFromToIf(
      [workModel.lists.inbox.id],
      workModel.lists.backlog.id,
      cardHasDueDate
    );

    logger.info("Marking appropriate items done");

    await workController.markCardsInListDone(workModel.lists.done.id);
  };

  return {
    run: async () => {
      await initialize();
      await groom();
    },
  };
};
