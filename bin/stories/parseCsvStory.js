const { readFileSync } = require('fs');
const { findIndex, get, isEmpty, pick } = require('lodash');
const { parse } = require('csv-parse/sync'); // eslint-disable-line
const { unflatten } = require('flat'); // eslint-disable-line
const { compact } = require('lodash');
const { Crewmate } = require('@influenceth/sdk');
const { Types: { ObjectId } } = require('mongoose');
const StoryModel = require('../models/Story');

const logger = console;
const inputFile = process.argv[2];

const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const objectivesToTraits = function (traits) {
  if (isEmpty(traits)) return [];
  return compact(traits).reduce((acc, trait) => {
    const index = findIndex(Crewmate.TRAITS, ({ name }) => name === trait);
    if (index < 0) throw new Error(`Unable to find trait for ${trait}`);
    acc.push(index + 1);
    return acc;
  }, []);
};

const crewClassesToValues = function (crewClasses) {
  if (isEmpty(crewClasses)) return [];
  return crewClasses.reduce((acc, crewClass) => {
    const index = findIndex(Crewmate.CLASSES, (name) => name === crewClass);
    if (index < 0) throw new Error(`Unable to find class for ${crewClass}`);
    acc.push(index + 1);
    return acc;
  }, []);
};

const parseFile = async function (inFile) {
  const fileData = readFileSync(inFile);
  const options = {
    cast(value, { header }) {
      if (header) return value;
      if (isEmpty(value)) return undefined;
      return value.replace(/“|”/g, '"');
    },
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    on_record(record) {
      return unflatten(record);
    }
  };
  const rows = parse(fileData, options);

  let pathId0;
  let curPath0;
  const doc = rows.reduce((acc, row) => {
    const pathId1 = ObjectId();

    // Story root level attributes
    if (row.title) acc.set('title', row.title);
    if (row.content) acc.set('content', row.content);
    if (row.prompt) acc.set('prompt', row.prompt);

    // Only add a new l0 path when the we come accross a new linkedpath
    if (get(row, 'linkedPaths[0].text')) {
      pathId0 = ObjectId();
      Object.assign(row.linkedPaths[0], { path: pathId0 });
      acc.linkedPaths.push(row.linkedPaths[0]);

      if (get(row, 'paths[0].requiredTraits')) {
        const allOf = objectivesToTraits(get(row, 'paths[0].requiredTraits.allOf') || []);
        const anyOf = objectivesToTraits(get(row, 'paths[0].requiredTraits.anyOf') || []);
        Object.assign(row.paths[0].requiredTraits, { allOf, anyOf });
      }

      if (get(row, 'paths[0].requiredCrewClasses')) {
        const allOf = crewClassesToValues(get(row, 'paths[0].requiredCrewClasses.allOf') || []);
        const anyOf = crewClassesToValues(get(row, 'paths[0].requiredCrewClasses.anyOf') || []);
        Object.assign(row.paths[0].requiredCrewClasses, { allOf, anyOf });
      }

      if (get(row, 'paths[0].requiredPathHistory')) {
        const allOf = get(row, 'paths[0].requiredPathHistory.allOf', '').split(',').map((p) => p.trim());
        const anyOf = get(row, 'paths[0].requiredPathHistory.anyOf', '').split(',').map((p) => p.trim());
        Object.assign(row.paths[0].requiredPathHistory, { allOf, anyOf });
      }

      Object.assign(row.paths[0], { _id: pathId0 });
      Object.assign(row.paths[0].linkedPaths[0], { path: pathId1 });
      Object.assign(row.paths[1], { _id: pathId1, objectives: objectivesToTraits(row.paths[1].objectives) });

      curPath0 = acc.addPath(row.paths[0]);
      acc.addPath(row.paths[1]);
    } else if (get(row, 'paths[0].linkedPaths[0].text')) {
      Object.assign(row.paths[0].linkedPaths[0], { path: pathId1 });
      Object.assign(row.paths[1], { _id: pathId1, objectives: objectivesToTraits(row.paths[1].objectives) });

      curPath0.linkedPaths.push(row.paths[0].linkedPaths[0]);
      acc.addPath(row.paths[1]);
    }
    return acc;
  }, new StoryModel());
  return doc;
};

const main = async function (file) {
  const doc = await parseFile(file);
  logger.info(JSON.stringify(pick(doc.toObject(), ['linkedPaths', 'paths'])));
};

main(inputFile)
  .then(() => done())
  .catch(done);
