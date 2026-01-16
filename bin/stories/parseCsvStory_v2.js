const { readFileSync } = require('fs');
const { castArray, findIndex, get, isEmpty, pick } = require('lodash');
const { parse } = require('csv-parse/sync'); // eslint-disable-line
const { unflatten } = require('flat'); // eslint-disable-line
const { compact, last } = require('lodash');
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
  return castArray(crewClasses).reduce((acc, crewClass) => {
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

  let prevRow = {};
  const pathCache = [];
  const story = new StoryModel();

  const doc = rows.reduce((acc, row) => {
    // Story root level attributes
    if (row.title) acc.set('title', row.title);
    if (row.content) acc.set('content', row.content);
    if (row.prompt) acc.set('prompt', row.prompt);

    // story level linked paths
    if (get(row, 'linkedPaths[0].text') !== get(prevRow, 'linkedPaths[0].text')) {
      acc.linkedPaths.push({ text: get(row, 'linkedPaths[0].text'), path: ObjectId() });
      pathCache[0] = acc.addPath({
        _id: last(acc.linkedPaths).path,
        content: get(row, 'paths[0].content'),
        prompt: get(row, 'paths[0].prompt'),
        classObjective: crewClassesToValues(row.paths[0].classObjective)[0],
        objectives: objectivesToTraits(row.paths[0].objectives)
      });
    }

    if (get(row, 'paths[0].linkedPaths[0].text') !== get(prevRow, 'paths[0].linkedPaths[0].text')) {
      pathCache[0].linkedPaths.push({
        path: ObjectId(),
        text: get(row, 'paths[0].linkedPaths[0].text')
      });

      // handle level 1 paths
      pathCache[1] = acc.addPath({
        _id: last(pathCache[0].linkedPaths).path,
        content: get(row, 'paths[1].content'),
        prompt: get(row, 'paths[1].prompt'),
        objectives: objectivesToTraits(row.paths[1].objectives),
        // image: 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/page3-4.jpg',
        // imageCenter: '65% 43%'
      });
    }

    if (get(row, 'paths[1].linkedPaths[0].text') !== get(prevRow, 'paths[1].linkedPaths[0].text')) {
      pathCache[1].linkedPaths.push({
        path: ObjectId(),
        text: get(row, 'paths[1].linkedPaths[0].text')
      });

      pathCache[2] = acc.addPath({
        _id: last(pathCache[1].linkedPaths).path,
        content: get(row, 'paths[2].content'),
        prompt: get(row, 'paths[2].prompt'),
        objectives: objectivesToTraits(row.paths[2].objectives),
        // image: 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/page3-4.jpg',
        // imageCenter: '65% 43%'
      });
    }

    if (get(row, 'paths[2].linkedPaths[0].text') !== get(prevRow, 'paths[2].linkedPaths[0].text')) {
      pathCache[2].linkedPaths.push({
        path: ObjectId(),
        text: get(row, 'paths[2].linkedPaths[0].text')
      });

      pathCache[3] = acc.addPath({
        _id: last(pathCache[2].linkedPaths).path,
        content: get(row, 'paths[3].content'),
        prompt: get(row, 'paths[3].prompt'),
        objectives: objectivesToTraits(row.paths[3].objectives),
        // image: 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/page5.jpg',
        // imageCenter: '35% 75%'
      });
    }

    if (get(row, 'paths[3].linkedPaths[0].text') !== get(prevRow, 'paths[3].linkedPaths[0].text')) {
      pathCache[3].linkedPaths.push({
        path: ObjectId(),
        text: get(row, 'paths[3].linkedPaths[0].text')
      });

      pathCache[4] = acc.addPath({
        _id: last(pathCache[3].linkedPaths).path,
        content: get(row, 'paths[4].content'),
        prompt: get(row, 'paths[4].prompt'),
        objectives: objectivesToTraits(row.paths[4].objectives),
        // image: 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/page5.jpg',
        // imageCenter: '35% 75%'
      });
    }

    prevRow = row;
    return acc;
  }, story);
  return doc;
};

const main = async function (file) {
  const doc = (await parseFile(file)).toObject();
  // doc.image = 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/main.jpg';
  // doc.imageCenter = '40% 55%';
  // doc.completionImage = 'https://res.cloudinary.com/influenceth/books/_/stories/62c6eb794874c10628d8b2a9/page5.jpg';
  logger.info(JSON.stringify(doc, null, 2));
};

main(inputFile)
  .then(() => done())
  .catch(done);
