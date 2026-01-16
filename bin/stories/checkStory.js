#!/usr/bin/env node
require('dotenv').config({ silent: true });
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { existsSync } = require('fs');

const logger = console;
const done = function (error) {
  if (error) logger.error(error);
  logger.info('done');
  process.exit();
};

const argv = yargs(hideBin(process.argv))
  .option('file', {
    type: 'string',
    demand: true
  })
  .check((args) => {
    if (!existsSync(args.file)) throw new Error(`Specified file does not exist: ${args.file}`);
    return true;
  })
  .parse();

const usedPaths = [];

const getPossibleBranches = (allPaths, currentAddress, priorObjectives = []) => {
  const pathId = currentAddress[currentAddress.length - 1];
  usedPaths.push(pathId);

  const path = allPaths.find((p) => p._id === pathId);
  if (path) {
    if (!path.content) console.error(`${pathId} is missing content!`);

    const currentObjectives = [...priorObjectives, ...(path.objectives || [])];

    let branches = [];
    if (path.linkedPaths && path.linkedPaths.length > 0) {
      if (!path.prompt) console.error(`${pathId} is missing prompt!`);
      path.linkedPaths.forEach((lp) => {
        if (!lp.text) console.error(`${pathId} has a LinkedPath with no text!`);
        if (lp.path) {
          branches = [
            ...branches,
            ...getPossibleBranches(
              allPaths,
              [...currentAddress, lp.path],
              currentObjectives
            )
          ];
        } else {
          console.error(`${pathId} has a LinkedPath with no path!`);
        }
      });
    } else {
      branches.push({
        address: currentAddress,
        objectives: currentObjectives
      });
    }
    return branches;
  }

  console.error(`${pathId} is missing!`);
  return [];
};

const main = async function ({ file }) {
  const data = require(`${__dirname}/../${file}`); // eslint-disable-line

  ['_id', 'book', 'image', 'title', 'type', 'availableOn', 'paths'].forEach((req) => {
    if (!data[req]) console.error(`${req} is required!`);
  });

  const pathsWithRoot = [
    ...data.paths,
    {
      _id: 'root',
      linkedPaths: data.linkedPaths,
      content: data.content,
      prompt: data.prompt,
      objectives: data.objectives,
    }
  ];

  // build and check all branch paths
  const branches = getPossibleBranches(pathsWithRoot, ['root']);
  branches.forEach(({ address, objectives }) => {
    if (address.length !== 3) {
      console.warn(`${address.join('.')} has length of ${address.length}.`);
    }
    if (objectives.length === 0) {
      console.warn(`${address.join('.')} has no objectives.`);
    }
  });

  data.paths.forEach((path) => {
    if (!usedPaths.includes(path._id)) {
      console.error(`${path._id} is unreachable!`);
    }
  });

  // TODO (enhancement): check that when trait/path requirements are applied
};

main(argv)
  .then(() => done())
  .catch(done);
