import { Document, Model, Schema } from "mongoose";

const env = process.env;
const fs = require("fs");
const path = require("path");
const request = require("request");
const mongoose = require("mongoose");
const WORK_DIR = `/tmp/${env.jobId}`;
const ZIP_FILE = `${WORK_DIR}/out.zip`;

export class TDMDataObject {
    private _name: string;
    private _data: any;

    constructor(name: string, data: any) {
        this._name = name;
        this._data = data;
    }

    get name(): string {
        return this._name;
    }

    get data(): any {
        return this._data;
    }
}

function prepareWorkDirectory() {
    return new Promise(((resolve, reject) => {
        if (fs.existsSync(WORK_DIR)) {
            fs.readdir(WORK_DIR, (err: Error, files: string[]) => {
                if (err) {
                    console.log("Failed to prepare working directory");
                    reject(err);
                }
                for (const file of files) {
                    fs.unlinkSync(path.join(WORK_DIR, file));
                }
                resolve();
            });
        } else {
            fs.mkdir(WORK_DIR, (err: Error) => {
                if (err) {
                    console.log("Failed to create working directory");
                    reject(err);
                }
                resolve();
            });
        }
    }));
}


function download(options: any, dest: String) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const sendReq = request.post(options);
        console.log(`Downloading artifacts file from: ${options.url}`);

        // verify response code
        sendReq.on("response", (response: any) => {
            if (response.statusCode !== 200) {
                reject(new Error(`There was a failure downloading the artifacts from ${options.url}. Response status was ${response.statusCode}.`));
            }
            sendReq.pipe(file);
        });

        file.on("finish", () => file.close());
        // after finish and closing the stream we can resolve promise
        file.on("close", () => resolve());

        // check for request errors
        sendReq.on("error", (err: Error) => {
            fs.unlink(dest);
            reject(err);
        });

        file.on("error", (err: Error) => { // Handle errors
            fs.unlink(dest);
            reject(err);
        });
    });
}

function unzip(file: string, outDir: string) {
    return new Promise((resolve, reject) => {
        console.log(`Unzipping artifacts file ${file}`);
        const extract = require("extract-zip");
        extract(file, {dir: outDir},
            (err: Error) => {
                err ? reject(err) : resolve();
            });
    });
}

function readArtifactsFile(file: string) {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(file, "utf8", (err: Error, data: string) => {
            err ? reject(err) : resolve(data);
        });
    });
}

function getAllArtifactsFiles(dir: string) {
    const dirCont = fs.readdirSync(dir);
    return dirCont.filter((f: string) => /.*\.(xml|csv)/gi.test(f));
}

function parseData(data: string, filename: string): Promise<TDMDataObject[]> {
    return new Promise(((resolve, reject) => {
        const retArray: TDMDataObject[] = [];
        if (/.xml/gi.test(filename)) {
            const parseString = require("xml2js").parseString;
            parseString(data, (err: Error, result: any) => {
                if (err) {
                    console.error(`Failed to parse data from XML file ${filename}`);
                    reject(err);
                }
                const content: string[] = result.TABLES;
                const name: string = Object.keys(content)[0];
                for (const obj of (<any>content)[name]) {
                    retArray.push(new TDMDataObject(name, obj));
                }
                resolve(retArray);
            });
        } else if (/.csv/gi.test(filename)) {
            const csv = require("csvtojson");
            csv().fromString(data).then((dataArray: any) => {
                const tableName = filename.slice(0, -4);
                for (const obj of dataArray) {
                    retArray.push(new TDMDataObject(tableName, obj));
                }
                resolve(retArray);
            })
                .catch((err: Error) => {
                    console.error(`Failed to parse data from CSV file ${filename}`);
                    reject(err);
                });

        }
    }));
}

function getData(dir: string): Promise<TDMDataObject[]> {
    return new Promise(((resolve, reject) => {
        const artifactFiles = getAllArtifactsFiles(dir);
        console.log(`Artifact files count: ${artifactFiles.length}`);
        if (artifactFiles.length === 0) {
            reject(new Error(`No artifacts files found in ${dir}!`));
        }
        let resultData: TDMDataObject[] = [];
        const allPromises: Promise<any>[] = [];
        for (const file of artifactFiles) {
            console.log(`Processing file ${file}`);
            allPromises.push(readArtifactsFile(dir + "/" + file)
                .then((data: string) => {
                    return parseData(data, file).then((resData) => {
                        resultData = resultData.concat(resData);
                    });
                })
                .catch((err: Error) => {
                    reject(err);
                })
            );
        }
        Promise.all(allPromises).then(() => {
            resolve(resultData);
        });
    }));
}

function createSchema(dataObj: TDMDataObject): Schema {
    console.log(`Creating schema for ${dataObj.name}`);
    const schema = new mongoose.Schema();
    for (const field in dataObj.data) {
        schema.add({
            [field]: mongoose.Schema.Types.String
        });
    }
    return schema;
}

export function processData(data: TDMDataObject[]): Map<string, Set<TDMDataObject>> {
    const resultMap = new Map<string, Set<TDMDataObject>>();
    for (const obj of data) {
        const item = resultMap.get(obj.name);
        if (item) {
            item.add(obj);
        } else {
            const set = new Set<TDMDataObject>();
            set.add(obj);
            resultMap.set(obj.name, set);
        }
    }
    return resultMap;
}

function insertToMongo(data: TDMDataObject[]): Promise<number> {
    return new Promise(((resolve, reject) => {

        mongoose.connect(`mongodb://${env.mongoUser}:${env.mongoPassword}@${env.mongoHost}/${env.mongoDbName}?authSource=${env.mongoAuthDb}`, {useNewUrlParser: true});
        const db = mongoose.connection;

        db.on("error", (err: Error) => reject(err));
        db.once("open", () => {
            console.log("Successfully connected to MongoDB");
            const dataMap: Map<string, Set<TDMDataObject>> = processData(data);
            const allPromises: Promise<any>[] = [];
            let insertedCount = 0;
            for (const key of dataMap.keys()) {
                const dataSet = (<Set<TDMDataObject>>dataMap.get(key));
                // grab the first record that will serve as a schema definition for others
                const first = dataSet.values().next().value;
                const model: Model<any> = new mongoose.model(key, createSchema(first));
                for (const record of dataSet) {
                    const dbRecord: Document = new model(record.data);
                    allPromises.push(dbRecord.save()
                        .then(() => {
                            insertedCount++;
                            console.log("1 record inserted successfully.");
                        })
                        .catch((err: Error) => {
                            console.log(err);
                        })
                    );
                }
            }
            Promise.all(allPromises).then(() => {
                mongoose.disconnect();
                resolve(insertedCount);
            });
        });
    }));
}

export function init() {
    console.log("TDM Mongo Generator REST Action starting...");
    console.log("===========================================");
    console.log("Using environment variables:");
    console.log("tdmUrl:", env.tdmUrl);
    console.log("jobId:", env.jobId);
    console.log("mongoHost:", env.mongoHost);
    console.log("mongoUser:", env.mongoUser);
    console.log("mongoPassword:", env.mongoPassword ? "***" : "undefined");
    console.log("mongoDbName:", env.mongoDbName);
    console.log("mongoAuthDb:", env.mongoAuthDb);
    console.log("===========================================");

    const options = {
        url: `${env.tdmUrl}/TDMJobService/api/ca/v1/jobs/${env.jobId}/actions/downloadArtifact/`,
        headers: {
            Authorization: `Bearer ${env.token}`
        },
        rejectUnauthorized: false,
        requestCert: true,
        agent: false
    };

    prepareWorkDirectory()
        .then(() => {
            return download(options, ZIP_FILE);
        })
        .then(() => {
            return unzip(ZIP_FILE, WORK_DIR);
        })
        .then(() => {
            return getData(WORK_DIR);
        })
        .then((resultData: TDMDataObject[]) => {
            return insertToMongo(resultData);
        })
        .then((count: number) => {
            console.log("===========================================");
            console.log(`Succesfully inserted ${count} record.`);
            console.log("Exiting...");
            process.exit(0);
        })
        .catch((err: Error) => {
            console.error(err);
            console.log("Exiting...");
            process.exit(1);
        });
}

require("make-runnable/custom")({
    printOutputFrame: false
});