const { createSVGWindow } = require('svgdom');
const datauri = require('datauri');
const sharp = require('sharp');
const { Ship } = require('@influenceth/sdk');
const Svg = require('svg.js');
const fontData = require('../../../assets/Jura');

const ASSETS_PATH = '../../../assets';
const VALID_TYPES = ['png', 'svg'];

const outputCard = async function (canvas, fileType) {
  if (fileType === 'svg') return canvas.svg(); // `data:image/svg+xml;base64,${Buffer.from().toString('base64')}`;
  if (fileType === 'png') return sharp(Buffer.from(canvas.svg())).png().toBuffer();

  throw new Error(`Invalid type provided. VALID_TYPES: ${VALID_TYPES}`);
};

/**
 * Generates a ship card
 * @param ship The ship object
 */
const generateCard = async function ({ ship, fileType }) {
  // returns a window with a document and an svg root node
  const window = createSVGWindow();
  const SVG = Svg(window);
  const { document } = window;

  // create svg.js instance
  const canvas = SVG(document.documentElement).size(900, 1200);
  const style = canvas.element('style');
  const fontface = `@font-face { font-family: 'Jura'; src: url(data:font/truetype;charset=utf-8;base64,${fontData}) `
  + 'format(\'truetype\'); font-weight: normal; font-style: normal; }';
  style.words(fontface);

  const itemsPath = `${__dirname}/${ASSETS_PATH}/images/ships`;
  const imageData = await datauri(`${itemsPath}/${ship.Ship.shipType}_${ship.Ship.variant}.png`);
  canvas.image(imageData).size(900, 1200);

  // Logo
  const logoData = await datauri(`${__dirname}/${ASSETS_PATH}/images/logo.png`);
  canvas.image(logoData).size(90, 90).x(80).y(65);

  // Gradient for bottom text and collection stamp
  const gradientData = await datauri(`${itemsPath}/../gradient.png`);
  canvas.image(gradientData).size(900, 274).x(0).y(926);

  // Custom name
  const name = ship.Name?.name || `Ship #${ship.id}`;
  canvas.text(name)
    .x(835).y(25)
    .font({ family: 'Jura', size: 50, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  canvas.text(Ship.Entity.getType(ship).name)
    .x(835).y(1000)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  canvas.text(Ship.Entity.getVariant(ship).name)
    .x(835).y(1050)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', '#bbbbbb');

  // Border
  const borderData = await datauri(`${itemsPath}/../border.png`);
  canvas.image(borderData).size(900, 1200).x(0).y(0);

  return outputCard(canvas, fileType);
};

module.exports = { generateCard };
