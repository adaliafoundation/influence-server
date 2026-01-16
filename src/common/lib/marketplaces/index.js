const OpenSea = require('./OpenSea');
const Unframed = require('./Unframed');

const updateAsteroidAsset = async (props) => {
  const results = await Promise.allSettled([
    OpenSea.updateAsteroidAsset(props),
    Unframed.updateAsteroidAsset(props)
  ]);
  const errors = results.reduce((acc, result) => {
    if (result.status === 'rejected') acc.push(result.reason);
    return acc;
  }, []);

  if (errors.length) throw new Error(errors);
};

const updateCrewmateAsset = async (props) => {
  const results = await Promise.allSettled([
    OpenSea.updateAsteroidAsset(props),
    Unframed.updateAsteroidAsset(props)
  ]);
  const errors = results.reduce((acc, result) => {
    if (result.status === 'rejected') acc.push(result.reason);
    return acc;
  }, []);

  if (errors.length) throw new Error(errors);
};

module.exports = {
  OpenSea,
  Unframed,
  updateAsteroidAsset,
  updateCrewmateAsset
};
