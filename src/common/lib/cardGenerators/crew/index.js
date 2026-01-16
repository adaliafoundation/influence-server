const { createSVGWindow } = require('svgdom');
const datauri = require('datauri');
const DatauriParser = require('datauri/parser');
const sharp = require('sharp');
const { Crewmate } = require('@influenceth/sdk');
const Svg = require('svg.js');
const fontData = require('../../../assets/Jura');
const assetList = require('../crewmate/assets');

const ASSETS_PATH = '../../../assets';
const VALID_TYPES = ['png', 'svg'];

const outputCard = async function (canvas, fileType) {
  if (fileType === 'svg') return canvas.svg(); // `data:image/svg+xml;base64,${Buffer.from().toString('base64')}`;
  if (fileType === 'png') return sharp(Buffer.from(canvas.svg())).png().toBuffer();

  throw new Error(`Invalid type provided. VALID_TYPES: ${VALID_TYPES}`);
};

/**
 * Generates a crew card
 * @param crewmate The crewmate object
 * @param crew The crew object
 */
const generateCard = async function ({ crewmate, crew, fileType }) {
  const layers = [];
  const itemsPath = `${__dirname}/${ASSETS_PATH}/images/crewmates`;

  let gender;
  let body = 0;
  let face;
  let hair;
  let hairColor;
  let clothes;
  let head;
  let item;
  let collection = 0;
  let crewClass = 0;
  let title;
  let crewmateName;

  if (crewmate) {
    const appearance = Crewmate.Entity.unpackAppearance(crewmate);
    ({ gender, body, face, hair, hairColor, clothes, head, item } = appearance);
    ({ coll: collection, class: crewClass, title } = crewmate.Crewmate);
    crewmateName = crewmate?.Name?.name || `Crewmate #${crewmate.id}`;
  }
  const crewName = crew.Name?.name || `Crew #${crew.id}`;

  // Handle Arvad Citizens and Specialists and Adalians
  if ([1, 2, 4].includes(collection)) {
    // Handle drones first, they need to be in the background
    if ([2, 3, 4, 5].includes(item)) layers.push({ input: `${itemsPath}/item/item${item}.png` });

    // Bodies including facial features if present
    if (assetList.body[`body${body}_feature${face}`]) {
      layers.push({ input: `${itemsPath}/body/body${body}_feature${face}.png` });
    } else {
      layers.push({ input: `${itemsPath}/body/body${body}.png` });
    }

    // Outfits optionally based on bodies
    if (assetList.outfit[`outfit${clothes}_body${body}`]) {
      layers.push({ input: `${itemsPath}/outfit/outfit${clothes}_body${body}.png` });
    } else {
      layers.push({ input: `${itemsPath}/outfit/outfit${clothes}.png` });
    }

    // Glow on outfit if present
    if (assetList.item[`item${item}_outfit${clothes}_sex${gender}`]) {
      layers.push({
        input: `${itemsPath}/item/item${item}_outfit${clothes}_sex${gender}.png`
      });
    }

    // Hair and hair color, optionally based on body
    if (head !== 5) { // Hide hair when helmet is on
      if (assetList.hair[`hair${hair}_hairColor${hairColor}_body${body}`]) {
        layers.push({
          input: `${itemsPath}/hair/hair${hair}_hairColor${hairColor}_body${body}.png`
        });
      } else if (assetList.hair[`hair${hair}_hairColor${hairColor}`]) {
        layers.push({ input: `${itemsPath}/hair/hair${hair}_hairColor${hairColor}.png` });
      }
    }

    // Facial features
    if (![4, 5].includes(head)) { // Hide beards when helmet or mask is on
      if (assetList.feature[`feature${face}_hairColor${hairColor}_body${body}`]) {
        layers.push({ input: `${itemsPath}/feature/feature${face}_hairColor${hairColor}_body${body}.png` });
      }
    }

    // Add in head piece
    if (assetList.headPiece[`headPiece${head}_hair${hair}_body${body}`]) {
      layers.push({ input: `${itemsPath}/headPiece/headPiece${head}_hair${hair}_body${body}.png` });
    } else if (assetList.headPiece[`headPiece${head}_hair${hair}_sex${gender}`]) {
      layers.push({ input: `${itemsPath}/headPiece/headPiece${head}_hair${hair}_sex${gender}.png` });
    } else if (assetList.headPiece[`headPiece${head}_hair${hair}`]) {
      layers.push({ input: `${itemsPath}/headPiece/headPiece${head}_hair${hair}.png` });
    } else if (assetList.headPiece[`headPiece${head}_body${body}`]) {
      layers.push({ input: `${itemsPath}/headPiece/headPiece${head}_body${body}.png` });
    } else if (assetList.headPiece[`headPiece${head}`]) {
      layers.push({ input: `${itemsPath}/headPiece/headPiece${head}.png` });
    }
  }

  // Handle Arvad Leadership
  if (collection === 3) {
    layers.push({ input: `${itemsPath}/leadership/${title}.png` });
  }

  // Apply texture and composite
  layers.push({ input: `${itemsPath}/texture.png`, blend: 'soft-light' });
  const image = await sharp(`${itemsPath}/class/class${crewClass}.png`).composite(layers).toBuffer();

  const parser = new DatauriParser();
  const imageData = parser.format('.png', image).content;

  // Begin SVG processing by creating a window with a document and an svg root node
  const window = createSVGWindow();
  const SVG = Svg(window);
  const { document } = window;
  const canvas = SVG(document.documentElement).size(900, 1200);

  // Start from base image generated based on crew attributes
  canvas.image(imageData).size(900, 1200);

  // Build up the SVG text elements
  const style = canvas.element('style');
  const fontface = `@font-face { font-family: 'Jura'; src: url(data:font/truetype;charset=utf-8;base64,${fontData}) `
    + 'format(\'truetype\'); font-weight: normal; font-style: normal; }';
  style.words(fontface);

  // Logo
  const logoData = await datauri(`${__dirname}/${ASSETS_PATH}/images/logo.png`);
  canvas.image(logoData).size(90, 90).x(80).y(65);

  // Gradient for bottom text and collection stamp
  const gradientData = await datauri(`${itemsPath}/../gradient.png`);
  canvas.image(gradientData).size(900, 274).x(0).y(926);

  // Custom name
  canvas.text(crewName)
    .x(835).y(25)
    .font({ family: 'Jura', size: 50, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Captained by
  if (crewmateName) {
    canvas.text(`Led by ${crewmateName}`)
      .x(835).y(85)
      .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
      .style('fill', '#bbbbbb');
  }

  // Number of crewmates
  canvas.text('Crewed by:')
    .x(835).y(1000)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  const descriptor = crew.Crew.roster.length === 1 ? 'crewmate' : 'crewmates';
  canvas.text(`${crew.Crew.roster.length} ${descriptor}`)
    .x(835).y(1050)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', '#bbbbbb');

  // Border
  const borderData = await datauri(`${itemsPath}/../border.png`);
  canvas.image(borderData).size(900, 1200).x(0).y(0);

  return outputCard(canvas, fileType);
};

module.exports = { generateCard };
