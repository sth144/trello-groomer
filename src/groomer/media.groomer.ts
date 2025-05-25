import { BoardController } from '../controller/board.controller';
import { BoardModel } from '../model/board.model';
import { logger } from '../lib/logger';
import { List } from '../lib/list.interface';
import { existsSync } from 'fs';
import { join } from 'path';
const secrets = require('../../config/key.json');
const boards = require('../../config/boards.json');

enum MediaBoardLists {
  inbox = 'inbox',
  backlog_books = 'books',
  backlog_music = 'music',
  backlog_movies = 'movies',
  backlog_tv = 'tv',
  backlog_games = 'games',
  backlog_food = 'food',
  in_progress = 'progress',
  done = 'done',
  backburner = 'backburner',
}

export class MediaBoardModel extends BoardModel {
  lists: {
    [MediaBoardLists.inbox]: List;
    [MediaBoardLists.backlog_books]: List;
    [MediaBoardLists.backlog_music]: List;
    [MediaBoardLists.backlog_movies]: List;
    [MediaBoardLists.backlog_tv]: List;
    [MediaBoardLists.in_progress]: List;
    [MediaBoardLists.done]: List;
    [MediaBoardLists.backburner]: List;
  } = {
    [MediaBoardLists.inbox]: new List(),
    [MediaBoardLists.backlog_books]: new List(),
    [MediaBoardLists.backlog_music]: new List(),
    [MediaBoardLists.backlog_movies]: new List(),
    [MediaBoardLists.backlog_tv]: new List(),
    [MediaBoardLists.in_progress]: new List(),
    [MediaBoardLists.done]: new List(),
    [MediaBoardLists.backburner]: new List(),
  };

  constructor(id: string) {
    super();
    this._id = id;
  }
}

export const MediaGroomer = function () {
  let start: Date;

  let mediaModel: MediaBoardModel;
  let mediaController: BoardController<MediaBoardModel>;

  const initialize = async () => {
    start = new Date();
    logger.info('Started ' + start.toString());

    logger.info('Building model');
    mediaModel = new MediaBoardModel(boards.media.id);

    logger.info('Initializing controllers');
    mediaController = new BoardController<MediaBoardModel>(mediaModel, {
      key: secrets.key,
      token: secrets.token,
    });

    await mediaController.wakeUp();
  };

  const groom = async () => {
    logger.info('Grooming (Media)');

    delete require.cache;

    logger.info('Syncing Audible library with board');

    const { spawn } = require('child_process');
    const subprocess = spawn('python3', ['get_library.py'], {
      cwd: './py/audible',
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

    const allCardsOnBoard = mediaModel
      .getAllCards()
      .sort((a, b) => b.name.localeCompare(a.name));

    /** remove duplicates */
    for (let i = 0; i < allCardsOnBoard.length; i++) {
      if (i < allCardsOnBoard.length - 1) {
        if (allCardsOnBoard[i].name === allCardsOnBoard[i + 1].name) {
          mediaController.deleteCardByID(allCardsOnBoard[i].id);
        }
      }
    }

    const audibleLibraryOutputPath = join(process.cwd(), 'cache/audible.json');

    if (existsSync(audibleLibraryOutputPath)) {
      if (
        require.hasOwnProperty('cache') &&
        require.cache.hasOwnProperty(audibleLibraryOutputPath)
      ) {
        delete require.cache[audibleLibraryOutputPath];
      }
      const audibleLibraryInfo = require(audibleLibraryOutputPath);

      logger.info('Audible data retrieved');

      const allCardTitlesOnBoard = mediaModel
        .getAllCardNames()
        .map((x) => x.toLowerCase());

      const bookLabel = mediaModel.getLabels()['Books'];
      const inboxListId = (<Record<MediaBoardLists, { id: string }>>(
        mediaModel.getLists()
      ))[MediaBoardLists.inbox].id;

      [audibleLibraryInfo.library, audibleLibraryInfo.wishlist].forEach(
        (collection) => {
          collection.forEach(async (item: string) => {
            const itemLowerCase = item.toLowerCase();

            if (
              !allCardTitlesOnBoard.includes(itemLowerCase) &&
              !allCardTitlesOnBoard.some((title) =>
                title.includes(itemLowerCase)
              ) &&
              !allCardTitlesOnBoard.some((title) =>
                itemLowerCase.includes(title)
              )
            ) {
              await mediaController.addCard(
                {
                  name: item,
                  idLabels: bookLabel,
                },
                inboxListId
              );
            }
          });
        }
      );
    }
  };

  return {
    run: async () => {
      await initialize();
      await groom();
    },
  };
};
