import { isArray } from 'util';

export type ConfigObj = { [s: string]: ConfigPropType };
export type ConfigPropType = number | boolean | string | object;

export function detectRemovals(
  newObject: ConfigObj,
  oldObject: ConfigObj,
  pathSoFar: string[] = []
): string[][] {
  let dotPaths: string[][] = [];
  Object.keys(oldObject).forEach((k) => {
    if (newObject.hasOwnProperty(k)) {
      if (isArray(oldObject[k])) {
        const arrayFromOld = <Array<ConfigPropType>>oldObject[k];
        const arrayFromNew = <Array<ConfigPropType>>newObject[k];

        for (let i = 0; i < arrayFromOld.length; i++) {
          if (
            !arrayFromNew.some((item) => {
              return item.toString() === arrayFromOld[i].toString();
            })
          ) {
            dotPaths.push([...pathSoFar, k, `${i}`]);
          }
        }
      } else if (typeof oldObject[k] === 'object') {
        dotPaths = dotPaths.concat(
          detectRemovals(newObject[k] as ConfigObj, oldObject[k] as ConfigObj, [
            ...pathSoFar,
            k,
          ])
        );
      }
    } else {
      dotPaths.push([...pathSoFar, k]);
    }
  });

  return dotPaths;
}

export type LiteralUpdate = { dotPath: string[]; value: ConfigPropType };
export function detectLiteralChanges(
  newObject: ConfigObj,
  oldObject: ConfigObj,
  pathSoFar: string[] = []
): LiteralUpdate[] {
  let updates: LiteralUpdate[] = [];
  Object.keys(newObject).forEach((k) => {
    if (oldObject.hasOwnProperty(k)) {
      if (typeof newObject[k] === typeof oldObject[k]) {
        switch (typeof newObject[k]) {
          case 'string':
          case 'number': {
            if (newObject[k] !== oldObject[k]) {
              updates.push({ dotPath: [...pathSoFar, k], value: newObject[k] });
            }
            break;
          }
          case 'object': {
            if (!isArray(newObject[k])) {
              updates = updates.concat(
                detectLiteralChanges(
                  newObject[k] as ConfigObj,
                  oldObject[k] as ConfigObj,
                  [...pathSoFar, k]
                )
              );
            }
            break;
          }
        }
      } else if (typeof newObject[k] !== 'object') {
        updates.push({ dotPath: [...pathSoFar, k], value: newObject[k] });
      }
    }
  });
  return updates;
}

export function updateLiteralsByDotPath(
  target: ConfigObj,
  updates: LiteralUpdate[]
): void {
  updates.forEach((update) => {
    if (target.hasOwnProperty(update.dotPath[0])) {
      if (
        typeof target[update.dotPath[0]] === 'object' &&
        !isArray(target[update.dotPath[0]])
      ) {
        updateLiteralsByDotPath(
          target[update.dotPath[0]] as ConfigObj,
          [update].map((x) => {
            x.dotPath = x.dotPath.slice(1);
            return x;
          })
        );
      } else if (update.dotPath.length === 1) {
        target[update.dotPath[0]] = update.value;
      }
    }
  });
}

export function removePropsByDotPath(
  target: ConfigObj,
  dotPaths: string[][]
): void {
  const arraysAtRootLevel: { [key: string]: any[] } = {};
  dotPaths.forEach((path) => {
    if (target.hasOwnProperty(path[0])) {
      if (isArray(target[path[0]])) {
        if (path.length > 1) {
          const targetArray = (<Array<number | string>>target[path[0]]).slice(
            0
          );
          if (!arraysAtRootLevel.hasOwnProperty(path[0])) {
            Object.assign(arraysAtRootLevel, {
              [path[0]]: targetArray,
            });
          }
          const valueToRemove = path[1].toString();
          arraysAtRootLevel[path[0]] = targetArray.filter(
            (val) => val.toString() !== valueToRemove
          );
        } else {
          delete target[path[0]];
        }
      } else if (typeof target[path[0]] === 'object') {
        if (path.length === 1) {
          delete target[path[0]];
        } else {
          removePropsByDotPath(<ConfigObj>target[path[0]], [path.slice(1)]);
        }
      } else {
        delete target[path[0]];
      }
    }
  });
  for (let key in arraysAtRootLevel) {
    Object.assign(target, {
      [key]: arraysAtRootLevel[key],
    });
  }
}

export function syncObjectsWithPreference(
  preferred: ConfigObj,
  secondary: ConfigObj
): ConfigObj {
  const result = {};

  /** sync objects */
  Object.keys(preferred).forEach((k) => {
    /** if property is literal, prefer value from card */
    if (['string', 'number', 'boolean'].indexOf(typeof preferred[k]) !== -1) {
      Object.assign(result, {
        [k]: preferred[k],
      });
    } else if (Array.isArray(preferred[k])) {
      /** if property is array */
      /** include every unique item from both config sources */
      let resultPropArr: ConfigPropType[] = [];
      if (secondary.hasOwnProperty(k)) {
        [
          preferred[k] as Array<ConfigPropType>,
          secondary[k] as Array<ConfigPropType>,
        ].forEach((array) => {
          array.forEach((x) => {
            if (!resultPropArr.some((y) => y.toString() === x.toString())) {
              resultPropArr.push(x);
            }
          });
        });
      } else {
        resultPropArr = preferred[k] as ConfigPropType[];
      }
      Object.assign(result, {
        [k]: resultPropArr,
      });
    } else if (typeof preferred[k] === 'object') {
      let resultPropObj = preferred[k];
      /** recursively sync object... */
      if (secondary.hasOwnProperty(k)) {
        resultPropObj = syncObjectsWithPreference(
          preferred[k] as ConfigObj,
          secondary[k] as ConfigObj
        );
      }
      Object.assign(result, {
        [k]: resultPropObj,
      });
    }
  });

  /** TODO: add new props from secondary */
  Object.keys(secondary).forEach((k) => {
    if (!preferred.hasOwnProperty(k)) {
      Object.assign(result, {
        [k]: secondary[k],
      });
    }
  });

  return result;
}

export function IsJsonString(str: string) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}
