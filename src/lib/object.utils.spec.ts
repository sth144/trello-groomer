import { 
    detectRemovals, detectLiteralChanges, ConfigObj, 
    removePropsByDotPath, syncObjectsWithPreference,
    LiteralUpdate, updateLiteralsByDotPath
} from "./object.utils";
import { assert } from "chai";

describe("Object utils", () => {
    let before: any, after: any;    
    describe("detectRemovals", () => {
        beforeEach(() => {
            before = cloneObj(exampleObj1);
            after = cloneObj(before);
            delete after["rootNum"];
            delete after["level1"]["level1Num"];
            delete after["level1"]["level2"]["level2Str"];
            delete after["level1"]["level2"]["level3"]["level3Num"];
            delete after["level1"]["level2"]["level3"]["level4"]["level5"]["level5Str"];
            after["rootArr"] = after["rootArr"].slice(1);
            after["level1"]["level2"]["level3"]["level3Arr"] = 
                after["level1"]["level2"]["level3"]["level3Arr"].slice(0,2);

        });
        it("should detect property removed from object root", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "rootNum";
            }));
        });
        it("should detect property removed from object nested 1 level in", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "level1"
                    && r[1] === "level1Num";
            }));
        });
        it("should detect property removed from object nested 2 levels in", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "level1"
                    && r[1] === "level2"
                    && r[2] === "level2Str";
            }));        
        });
        it("should detect property removed from object nested 3 levels in", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "level1"
                    && r[1] === "level2"
                    && r[2] === "level3"
                    && r[3] === "level3Num";
            }));        
        });
        it("should detect property removed from object nested 5 levels in", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "level1"
                    && r[1] === "level2"
                    && r[2] === "level3"
                    && r[3] === "level4"
                    && r[4] === "level5"
                    && r[5] === "level5Str";
            }));        
        });
        it("should detect element removed from array property at object root", () => {
            const result = detectRemovals(after, before);
            console.log(result);
            assert.isTrue(result.some((r) => {
                return r[0] === "rootArr"
                    && r[1] === before["rootArr"][0].toString();
            }));        
        });
        it("should detect element removed from array property nested 3 levels in", () => {
            const result = detectRemovals(after, before);
            assert.isTrue(result.some((r) => {
                return r[0] === "level1"
                    && r[1] === "level2"
                    && r[2] === "level3"
                    && r[3] === "level3Arr"
                    && r[4] === before["level1"]["level2"]["level3"]["level3Arr"][2].toString();
            }));        
        });
    });

    describe("detectLiteralChanges", () => {
        let before: any, after: any, detected: LiteralUpdate[];
        beforeEach(() => {
            before = cloneObj(exampleObj1);
            after = cloneObj(exampleObj1);

            after["rootStr"] = "NEW_STRING_ROOT";
            after["level1"]["level1Str"] = "NEW_STRING_1";
            after["level1"]["level2"]["level2Num"] = 100;
            after["level1"]["level2"]["level3"]["level3Str"] = "NEW_STRING_3";
            after["level1"]["level2"]["level3"]["level4"]["level4Num"] = 200;
            after["level1"]["level2"]["level3"]["level4"]["level5"]["level5Str"]
                = "NEW_STRING_5";
            after["level1"]["level2"]["level2Arr"] = ["x", "y", "z"];
            detected = detectLiteralChanges(after, before);
        });
        it("should detect all literal changes, and no other changes (to objects "
            + "or arrays)", () => {
            assert.equal(detected.length, 6);
        });
        it("should detect string updated at root of object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 1 
                    && x.dotPath[0] === "rootStr"
                    && x.value === "NEW_STRING_ROOT";
            }));
        });
        it("should detect updated string nested 1 level into object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 2
                    && x.dotPath[0] === "level1"
                    && x.dotPath[1] === "level1Str"
                    && x.value === "NEW_STRING_1";
            }));
        });
        it("should detect updated number nested 2 levels into object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 3
                    && x.dotPath[0] === "level1"
                    && x.dotPath[1] === "level2"
                    && x.dotPath[2] === "level2Num"
                    && x.value === 100;
            }));
        });
        it("should detect updated string nested 3 levels into object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 4
                    && x.dotPath[0] === "level1"
                    && x.dotPath[1] === "level2"
                    && x.dotPath[2] === "level3"
                    && x.dotPath[3] === "level3Str"
                    && x.value === "NEW_STRING_3";
            }));
        });
        it("should detect updated num nested 4 levels into object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 5
                    && x.dotPath[0] === "level1"
                    && x.dotPath[1] === "level2"
                    && x.dotPath[2] === "level3"
                    && x.dotPath[3] === "level4"
                    && x.dotPath[4] === "level4Num"
                    && x.value === 200;
            }));
        });
        it("should detect updated string nested 5 levels into object", () => {
            assert.isTrue(detected.some(x => {
                return x.dotPath.length === 6
                    && x.dotPath[0] === "level1"
                    && x.dotPath[1] === "level2"
                    && x.dotPath[2] === "level3"
                    && x.dotPath[3] === "level4"
                    && x.dotPath[4] === "level5"
                    && x.dotPath[5] === "level5Str"
                    && x.value === "NEW_STRING_5";
            }));
        });
    });
    
    describe("updateLiteralsByDotPath", () => {
        let before: any, after: any;
        beforeEach(() => {
            before = cloneObj(exampleObj1);
            after = cloneObj(before);
            updateLiteralsByDotPath(after, [
                {
                    dotPath: ["rootStr"],
                    value: "NEW_ROOT_STR"
                }, 
                {
                    dotPath: ["level1", "level2", "level3", "level3Num"],
                    value: 999
                }
            ]);
        });
        it("should update string at root of object", () => {
            assert.isTrue(before["rootStr"] === exampleObj1["rootStr"]);
            assert.isTrue(after["rootStr"] === "NEW_ROOT_STR");
        });
        it("should update number nested 3 levels into object", () => {
            assert.isTrue(before["level1"]["level2"]["level3"]["level3Num"] 
                === exampleObj1["level1"]["level2"]["level3"]["level3Num"]);
            assert.isTrue(after["level1"]["level2"]["level3"]["level3Num"] 
                === 999);
        });
    }); 

    describe("removePropsByDotPath", () => {
        let before: any, after: any;
        beforeEach(() => {
            before = cloneObj(exampleObj1);
            after = cloneObj(before);
            removePropsByDotPath(after, [
                ["rootStr"],
                ["level1", "level2", "level3", "level3Num"],
                // remove value (not index) where it appears
                ["rootArr", "2"],   
                // remove value (not index) 12 where it appears
                ["level1", "level2", "level3", "level3Arr", "12"], 
                ["level1", "level2", "level2Arr"]
            ]);
        });
        it("should remove property from object root", () => {
            assert.isTrue(before.hasOwnProperty("rootStr"));
            assert.isFalse(after.hasOwnProperty("rootStr"));
        });
        it("should remove property nested 3 levels in", () => {
            assert.isTrue(before["level1"]["level2"]["level3"].hasOwnProperty("level3Num"));
            assert.isFalse(after["level1"]["level2"]["level3"].hasOwnProperty("level3Num"));
        });
        it("should remove element from array at object root", () => {
            assert.isTrue(after["rootArr"].includes(before["rootArr"][0]));
            assert.isFalse(after["rootArr"].includes(before["rootArr"][1]));
        });
        it("should remove element from array nested 3 levels in", () => {
            assert.isTrue(after["level1"]["level2"]["level3"]["level3Arr"].includes(
                before["level1"]["level2"]["level3"]["level3Arr"][0]));
            assert.isFalse(after["level1"]["level2"]["level3"]["level3Arr"].includes(
                before["level1"]["level2"]["level3"]["level3Arr"][2]
            ));
        });
        it("should allow deletion of entire array (nested 2 levels in)", () => {
            assert.isTrue(before["level1"]["level2"].hasOwnProperty("level2Arr"));
            assert.isFalse(after["level1"]["level2"].hasOwnProperty("level2Arr"));
        });
    });
    
    describe("syncObjectsWithPreference", () => {
        let primary: ConfigObj, secondary: ConfigObj, merged: ConfigObj;
        beforeEach(() => {
            primary = cloneObj(exampleObj1);
            secondary = cloneObj(exampleObj2);
            merged = syncObjectsWithPreference(primary, secondary);
        });
        it("should create an object which is the union of both inputs", () => {
            function hasAllPropsFrom(checkObj: ConfigObj, againstObj: ConfigObj): boolean {
                let result = true;
                for (let prop in againstObj) {
                    if (!checkObj.hasOwnProperty(prop)) {
                        result = false;
                    } else if (typeof againstObj[prop] === "object" && !Array.isArray(againstObj[prop])) {
                        if (!hasAllPropsFrom(checkObj[prop] as ConfigObj, againstObj[prop] as ConfigObj)) {
                            result = false;
                        }
                    }
                }
                return result;
            }        
            assert.isTrue(hasAllPropsFrom(merged, primary));
            assert.isTrue(hasAllPropsFrom(merged, secondary));
        });
        it("should merge arrays", () => {
            function allArraysInObjReflectSource(checkObj: ConfigObj, againstObj: ConfigObj): boolean {
                let result = true;
                for (let prop in againstObj) {
                    if (Array.isArray(againstObj[prop])) {
                        const checkArray = <Array<unknown>>checkObj[prop],
                            againstArray = <Array<unknown>>againstObj[prop];
                        if (againstArray.some((x) => checkArray.indexOf(x) === -1)) {
                            result = false;
                        }
                    } else if (typeof againstObj[prop] === "object") {
                        if (!allArraysInObjReflectSource(checkObj[prop] as ConfigObj, 
                            againstObj[prop] as ConfigObj)) {
                            result = false;
                        }
                    }
                }
                return result;
            }
            assert.isTrue(allArraysInObjReflectSource(merged, primary));
            assert.isTrue(allArraysInObjReflectSource(merged, secondary));
        });
        it("should use primary object's properties when a property is defined on both inputs", () => {
            function reflectsAllLiteralsFromSource(checkObj: ConfigObj, againstObj: ConfigObj): boolean {
                let result = true;
                for (let prop in againstObj) {
                    if (typeof againstObj[prop] === "object") {
                        if (!Array.isArray(againstObj[prop])) {
                            if (!reflectsAllLiteralsFromSource(checkObj[prop] as ConfigObj, againstObj[prop] as ConfigObj)) {
                                result = false;
                            }
                        }
                    } else {
                        if (checkObj[prop] !== againstObj[prop]) {
                            result = false;
                        }
                    }
                }
                return result;
            }
            assert.isTrue(reflectsAllLiteralsFromSource(merged, primary));

        });
    });
});

const exampleObj1 = {
    rootNum: 0,
    rootStr: "a",
    rootArr: [1, 2, 3],
    level1: {
        level1Num: 1,
        level1Str: "b",
        level1Arr: [4, 5, 6],
        level2: {
            level2Num: 2,
            level2Str: "c",
            level2Arr: [7, 8, 9],
            level3: {
                level3Num: 3,
                level3Str: "d",
                level3Arr: [10, 11, 12],
                level4: {
                    level4Num: 4,
                    level4Str: "e",
                    level4Arr: [13, 14, 15],
                    level5: {
                        level5Num: 5,
                        level5Str: "f",
                        level5Arr: [16, 17, 18],
                    }
                }
            },
            extraPropObj1: 1
        }
    },
    extraPropObj1: 1
}

const exampleObj2 = {
    rootNum: 6,
    rootStr: "g",
    rootArr: [19, 20, 21],
    level1: {
        level1Num: 7,
        level1Str: "h",
        level1Arr: [22, 23, 24],
        level2: {
            level2Num: 8,
            level2Str: "i",
            level2Arr: [25, 26, 27],
            level3: {
                level3Num: 9,
                level3Str: "j",
                level3Arr: [28, 29, 30],
                level4: {
                    level4Num: 10,
                    level4Str: "k",
                    level4Arr: [31, 32, 33],
                    level5: {
                        level5Num: 11,
                        level5Str: "l",
                        level5Arr: [34, 35, 36],
                    }
                }
            },
            extraPropObj2: 2
        }
    },
    extraPropObj2: 2
}

function cloneObj(obj: object): ConfigObj {
    return JSON.parse(JSON.stringify(obj));
}

function createRandomObj(allowNMoreLevels: number = 10): ConfigObj {
    const result = { };
    const numProps = Math.floor(Math.random() * 10);
    for (let i = 0; i < numProps; i++) {
        const propName = Math.random().toString(36).substring(2,10);
        const whichType = Math.floor(Math.random() * 4);
        enum PropType {
            NUMBER,
            STRING,
            ARRAY,
            OBJECT
        }
        switch (whichType) {
            case PropType.NUMBER: {
                Object.assign(result, {
                    [propName]: Math.random()
                });
                break;
            }
            case PropType.STRING: {
                Object.assign(result, {
                    [propName]: Math.random().toString(36).substring(2,10)
                });
                break;
            }
            case PropType.ARRAY: {
                const arr: any[] = [];
                const arrLen = Math.floor(Math.random() * 10);
                for (let i = 0; i < arrLen; i++) {
                    if (coinFlip() && allowNMoreLevels > 0) {
                        arr.push(createRandomObj(0))
                    } else {
                        if (coinFlip()) {
                            arr.push(Math.random());
                        } else {
                            arr.push(Math.random().toString().substring(2,10))
                        }
                    }
                }
                Object.assign(result, {
                    [propName]: arr
                });
                break;
            }
            case PropType.OBJECT: {
                if (allowNMoreLevels > 0) {
                    Object.assign(result, {
                        [propName]: createRandomObj(allowNMoreLevels-1)
                    });
                }
                break;
            }
        }
    }
    return result;
}

function coinFlip(): boolean {
    return Math.random() > 0.5;
}