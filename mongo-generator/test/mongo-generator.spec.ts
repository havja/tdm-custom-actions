import { processData, TDMDataObject } from "../src/mongo-generator";
import { expect } from "chai";
import "mocha";

describe("Tests for mongo-generator", () => {

    it("test process data", () => {
        const obj1: TDMDataObject = new TDMDataObject("test1", []);
        const obj2: TDMDataObject = new TDMDataObject("test2", []);
        const obj3: TDMDataObject = new TDMDataObject("test2", []);
        const objects: TDMDataObject[] = [obj1, obj2, obj3];
        const result = processData(objects);
        expect(result.size).to.equal(2);
        for (const key of result.keys()) {
            const dataSet = (<Set<TDMDataObject>>result.get(key));
            if (key === "test2") {
                expect(dataSet.size).to.equal(2);
            } else {
                expect(dataSet.size).to.equal(1);
            }
        }
    });
});
