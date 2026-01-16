/* eslint-disable no-restricted-syntax */
const { hash } = require('starknet');
const { castArray } = require('lodash');

const NAMED_TUPLE_DELIMITER = ': ';
const ARGUMENTS_DELIMITER = ', ';

const isNamedTuple = function (type) {
  return type.includes(NAMED_TUPLE_DELIMITER);
};

const isTuple = function (type) {
  return type[0] === '(' && type[type.length - 1] === ')';
};

// Can't use String.split since ':' also can be inside type
// Ex: x : (y : felt, z: SomeStruct)
const parseNamedTuple = function (namedTuple) {
  const index = namedTuple.indexOf(NAMED_TUPLE_DELIMITER);
  const name = namedTuple.substring(0, index);
  const type = namedTuple.substring(name.length + NAMED_TUPLE_DELIMITER.length);
  return { name, type };
};

// Returns types of tuple
const extractMemberTypes = function (s) {
  // Replace all top-level tuples with '#'
  const specialSymbol = '#';
  let i = 0;
  let tmp = '';
  const replacedSubStrings = [];
  while (i < s.length) {
    if (s[i] === '(') {
      let counter = 1;
      const openningBracket = i;
      // Move to next element after '('
      i += 1;
      // As invariant we assume that cairo compiler checks
      // that num of '(' === num of ')' so we will terminate
      // before i > s.length
      while (counter) {
        if (s[i] === ')') {
          counter -= 1;
        }
        if (s[i] === '(') {
          counter += 1;
        }
        i += 1;
      }
      replacedSubStrings.push(s.substring(openningBracket, i));
      // replace tuple with special symbol
      tmp += specialSymbol;
      // Move index back on last ')'
      i -= 1;
    } else {
      tmp += s[i];
    }
    i += 1;
  }
  let specialSymbolCounter = 0;
  // Now can split as all tuples replaced with '#'
  return tmp.split(ARGUMENTS_DELIMITER).map((type) => {
    // if type contains '#' then replace it with replaced substring
    if (type.includes(specialSymbol)) {
      specialSymbolCounter += 1;
      return type.replace(specialSymbol, replacedSubStrings[specialSymbolCounter]);
    }
    return type;
  });
};

/**
 * Uses the numbers in the `raw` array to generate a tuple/struct of the provided `type`.
 *
 * @param raw array of `felt` instances (numbers) used as material for generating the complex type
 * @param rawIndex current position within the `raw` array
 * @param type type to extract from `raw`, beginning at `rawIndex`
 * @param abi the ABI from which types are taken
 * @returns an object consisting of the next unused index and the generated tuple/struct itself
 */
const generateComplexOutput = function (raw, _rawIndex, type, abi) {
  let rawIndex = _rawIndex;
  if (type === 'felt') {
    return {
      generatedComplex: raw[rawIndex],
      newRawIndex: rawIndex + 1
    };
  }
  let generatedComplex = null;
  if (isTuple(type)) {
    const members = extractMemberTypes(type.slice(1, -1));
    if (isNamedTuple(type)) {
      generatedComplex = {};
      members.forEach((member) => {
        const memberSpec = parseNamedTuple(member);
        const ret = generateComplexOutput(raw, rawIndex, memberSpec.type, abi);
        generatedComplex[memberSpec.name] = ret.generatedComplex;
        rawIndex = ret.newRawIndex;
      });
    } else {
      generatedComplex = [];
      members.forEach((member) => {
        const ret = generateComplexOutput(raw, rawIndex, member, abi);
        generatedComplex.push(ret.generatedComplex);
        rawIndex = ret.newRawIndex;
      });
    }
  } else {
    // struct
    if (!(type in abi)) throw new Error(`Type ${type} not present in ABI.`);
    generatedComplex = {};
    const struct = abi[type];
    for (const member of struct.members) {
      const ret = generateComplexOutput(raw, rawIndex, member.type, abi);
      generatedComplex[member.name] = ret.generatedComplex;
      rawIndex = ret.newRawIndex;
    }
  }
  return {
    generatedComplex,
    newRawIndex: rawIndex
  };
};

/**
 * Adapts the string resulting from a Starknet CLI function call or server purpose of adapting event
 * This is done according to the actual output type specifed by the called function.
 *
 * @param rawResult the actual result in the form of an unparsed string
 * @param outputSpecs array of starknet types in the expected function output
 * @param abi the ABI of the contract whose function was called
 */
const adaptOutput = function (rawResult, outputSpecs, abi) {
  const splitStr = rawResult.split(' ');
  const result = [];
  splitStr.forEach((num) => {
    const parsed = num[0] === '-' ? BigInt(num.substring(1)) * BigInt(-1) : BigInt(num);
    result.push(`0x${parsed.toString(16)}`);
  });
  let resultIndex = 0;
  let lastSpec = { type: null, name: null };
  const adapted = {};
  for (const outputSpec of outputSpecs) {
    const currentValue = result[resultIndex];
    if (outputSpec.type === 'felt') {
      adapted[outputSpec.name] = currentValue;
      resultIndex += 1;
    } else if (outputSpec.type.endsWith('*')) {
      // Assuming lastSpec refers to the array size argument; not checking its name - done during compilation
      if (lastSpec.type !== 'felt') {
        const msg = `Array size argument (felt) must appear right before ${outputSpec.name} (${outputSpec.type}).`;
        throw new Error(msg);
      }
      // Remove * from the spec type
      const outputSpecArrayElementType = outputSpec.type.slice(0, -1);
      const arrLength = Number(adapted[lastSpec.name]);
      const structArray = [];
      // Iterate over the struct array, starting at index, starting at `resultIndex`
      for (let i = 0; i < arrLength; i += 1) {
        // Generate a struct with each element of the array and push it to `structArray`
        const ret = generateComplexOutput(result, resultIndex, outputSpecArrayElementType, abi);
        structArray.push(ret.generatedComplex);
        // Next index is the proper raw index returned from generating the struct, which accounts for nested structs
        resultIndex = ret.newRawIndex;
      }
      // New resultIndex is the raw index generated from the last struct
      adapted[outputSpec.name] = structArray;
    } else {
      const ret = generateComplexOutput(result, resultIndex, outputSpec.type, abi);
      adapted[outputSpec.name] = ret.generatedComplex;
      resultIndex = ret.newRawIndex;
    }
    lastSpec = outputSpec;
  }
  return adapted;
};

/**
 * Extract events from the ABI.
 * @param abi the path where ABI is stored on disk.
 * @returns an object mapping ABI entry names with their values.
 */
const extractEventSpecifications = function (abi) {
  const events = {};
  for (const abiEntryName in abi) {
    if (abi[abiEntryName].type === 'event') {
      const event = abi[abiEntryName];
      const encodedEventName = hash.getSelectorFromName(event.name);
      events[encodedEventName] = event;
    }
  }
  return events;
};

/**
 * Reads ABI and converts it to an object for lookup by name.
 * @param abiPath the path where ABI is stored on disk
 * @returns an object mapping ABI entry names with their values
 */
function readAbi(abiArray) {
  const abi = {};
  for (const abiEntry of abiArray) {
    if (!abiEntry.name) {
      const msg = `Abi entry has no name: ${abiEntry}`;
      throw new Error(msg);
    }
    abi[abiEntry.name] = abiEntry;
  }
  return abi;
}

class StarknetContract {
  constructor({ name, abi }) {
    this.abi = readAbi(abi);
    this.name = name;
    this.eventsSpecifications = extractEventSpecifications(this.abi);
  }

  /**
   * Decode the events to a structured object with parameter names.
   * @param events as received from the server.
   * @returns structured object with parameter names.
   */
  decodeEvents(events) {
    const decodedEvents = [];
    castArray(events).forEach((event) => {
      const rawEventData = event.data.map(BigInt).join(' ');
      // encoded event name guaranteed to be at index 0
      const eventSpecification = this.eventsSpecifications[event.keys[0]];
      if (!eventSpecification) {
        const msg = `Event "${event.keys[0]}" doesn't exist in ${this.name}.`;
        throw new Error(msg);
      }
      const adapted = adaptOutput(rawEventData, eventSpecification.data, this.abi);
      decodedEvents.push({ ...event, name: eventSpecification.name, data: adapted, rawEventData: event.data });
    });
    return decodedEvents;
  }
}

module.exports = StarknetContract;
