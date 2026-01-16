const { createSVGWindow } = require('svgdom');
const { Asteroid } = require('@influenceth/sdk');
const datauri = require('datauri');
const Svg = require('svg.js');
const sharp = require('sharp');
const fontData = require('../../../assets/Jura');
const icons = require('./icons');

const ASSETS_PATH = '../../../assets';
const VALID_TYPES = ['png', 'svg'];

const outputCard = async function (canvas, fileType) {
  if (fileType === 'svg') return canvas.svg(); // `data:image/svg+xml;base64,${Buffer.from().toString('base64')}`;
  if (fileType === 'png') return sharp(Buffer.from(canvas.svg())).png().toBuffer();

  throw new Error(`Invalid type provided. VALID_TYPES: ${VALID_TYPES}`);
};

const generateCard = async function ({ asteroidDoc, fileType }) {
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

  // Pre-process data we need
  const spectralType = Asteroid.Entity.getSpectralType(asteroidDoc);
  const size = Asteroid.Entity.getSize(asteroidDoc).toLowerCase();
  const isScanned = asteroidDoc.Celestial?.scanStatus >= 2;
  const { radius } = asteroidDoc.Celestial;

  // Setup rarity
  let rarity = 'Unscanned';
  let rarityColor = '#bbbbbb';

  if (isScanned) {
    const rarityColors = {
      Common: '#bbbbbb',
      Uncommon: '#69ebf4',
      Rare: '#4f90ff',
      Superior: '#884fff',
      Exceptional: '#ff984f',
      Incomparable: '#ffd94f'
    };

    rarity = Asteroid.Entity.getRarity(asteroidDoc);
    rarityColor = rarityColors[rarity];
  }

  const imageData = await datauri(`${__dirname}/${ASSETS_PATH}/images/asteroids/${spectralType[0]}-${size}.png`);
  canvas.image(imageData).size(900, 1200);

  // Holo background
  if (rarity === 'Incomparable') {
    const holoData = await datauri(`${__dirname}/${ASSETS_PATH}/images/holo-layer.png`);
    canvas.image(holoData)
      .size(900, 1200)
      .style({
        'mix-blend-mode': 'multiply',
        opacity: '0.6'
      });
  }

  // Logo
  const logoData = await datauri(`${__dirname}/${ASSETS_PATH}/images/logo.png`);
  canvas.image(logoData).size(90, 90).x(80).y(65);

  // Name
  const name = asteroidDoc.Name?.name || Asteroid.Entity.getBaseName(asteroidDoc);
  canvas.text(name)
    .x(835).y(25)
    .font({ family: 'Jura', size: 50, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Rarity
  canvas.text(rarity)
    .x(835).y(85)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', rarityColor);

  // Spectral type
  canvas.text(`${spectralType}-type`)
    .x(835).y(135)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Subjective size
  canvas.text(size.toUpperCase())
    .x(835).y(950)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Radius
  canvas.text(`Radius - ${radius.toFixed(3)} km`)
    .x(835).y(1000)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Surface area
  const area = Asteroid.getSurfaceArea(0, radius);
  canvas.text(`Area - ${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`)
    .x(835).y(1050)
    .font({ family: 'Jura', size: 40, weight: 100, anchor: 'end' })
    .style('fill', 'white');

  // Bonuses
  if (isScanned) {
    const bonusColors = ['#bbbbbb', '#69ebf4', '#4f90ff', '#884fff'];
    const bonusElement = canvas.group();
    let bonusShiftX = 0;
    let bonusShiftY = 0;
    let bonusCount = 0;

    Asteroid.Entity.getBonuses(asteroidDoc).forEach((b) => {
      bonusShiftX = (bonusCount % 3) * 90;
      bonusShiftY = bonusCount / 3 >= 1 ? -90 : 0;
      bonusCount += 1;
      const color = bonusColors[b.level] || '#884fff';

      bonusElement.circle(70)
        .cx(bonusShiftX).cy(bonusShiftY)
        .fill('none')
        .stroke(color);

      bonusElement.path(icons[b.type])
        .cx(bonusShiftX).cy(bonusShiftY)
        .scale(1.75)
        .style('fill', color);
    });
    bonusElement.x(130).y(1090);
  }

  return outputCard(canvas, fileType);
};

module.exports = { generateCard };
