import { BoardModel } from '../model/board.model';
import { List } from '../lib/list.interface';
import { BoardController } from '../controller/board.controller';
import { logger } from '../lib/logger';
import {
  cardIsComplete,
  cardDueToday,
  cardDueThisWeek,
  cardHasDueDate,
  wasMovedFromToListFilterFactory,
  Not,
} from '../lib/card.filters';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { parseAutoDueConfig } from '../lib/parse.utils';
const secrets = require('../../config/key.json');
const boards = require('../../config/boards.json');

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
    logger.info('Started ' + start.toString());

    logger.info('Building model');
    workModel = new WorkBoardModel(boards.work.id);

    logger.info('Initializing controllers');
    workController = new BoardController<WorkBoardModel>(workModel, {
      key: secrets.key,
      token: secrets.token,
    });

    await workController.wakeUp();
  };

  const groom = async () => {
    logger.info('Grooming (Work)');

    delete require.cache;

    /** assign due dates to cards without due dates */
    const autoDueConfigPath = join(
      process.cwd(),
      'config/auto-due.config.json'
    );
    if (existsSync(autoDueConfigPath)) {
      const autoDueConfig = parseAutoDueConfig(autoDueConfigPath) as {
        [s: string]: number;
      };

      logger.info('Updating due dates based on manual list movements');

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

      const addedLabels = new Promise(async (res) => {
        /** work keyword conflicts with a lot of irrelevant card titles */
        const allLabels = workController.AllLabelNames.filter(
          (x) => x !== 'Work'
        );
        for (let labelName of allLabels) {
          await workController.addLabelToCardsIfTextContains(labelName, [
            labelName,
          ]);
        }
      });
      const autoLabelConfigPath = join(
        process.cwd(),
        'config/auto-label.config.work.json'
      );
      if (existsSync(autoLabelConfigPath)) {
        const autoLabelConfig = require(autoLabelConfigPath);

        Object.keys(autoLabelConfig).forEach(async (labelName) => {
          await workController.addLabelToCardsIfTextContains(
            labelName,
            autoLabelConfig[labelName]
          );
        });
      }
    }

    // simple machine learning model to come up with auto-label mappings
    logger.info(
      'Adding labels to unlabeled cards according to machine learning model'
    );

    const { spawn } = require('child_process');
    const subprocess = spawn('python3', ['label.py', 'work'], {
      cwd: './py/model',
    });
    subprocess.stdout.on('data', (data: string) => {
      logger.info(data.toString());
    });
    subprocess.stderr.on('data', (err: string) => {
      logger.info(err.toString());
    });
    const closed = new Promise<void>((res) => {
      subprocess.on('close', () => {
        res();
      });
    });
    await closed;

    logger.info(`Cache contents: ${readdirSync('./cache')}`);

    const labelModelOutputPath = join(
      process.cwd(),
      'cache/label.model-output.work.json'
    );

    if (existsSync(labelModelOutputPath)) {
      if (
        require.hasOwnProperty('cache') &&
        require.cache.hasOwnProperty(labelModelOutputPath)
      ) {
        delete require.cache[labelModelOutputPath];
      }
      const labelsFromModel = require(labelModelOutputPath);

      logger.info('Labels from ML model:');
      logger.info(JSON.stringify(labelsFromModel));

      for (const labelName in labelsFromModel) {
        const cardNames = labelsFromModel[labelName];
        await workController.addLabelToCardsIfTextContains(
          labelName,
          cardNames
        );
      }
    }

    logger.info('Updating list placements');

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

    logger.info('Marking appropriate items done');

    await workController.markCardsInListDone(workModel.lists.done.id);

    logger.info(
      'dump JSON data for card labels to train machine learning model'
    );
    workController.dump('work');
  };

  return {
    run: async () => {
      await initialize();
      await groom();
    },
  };
};
