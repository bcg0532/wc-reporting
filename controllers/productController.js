const path = require('path');
const csv = require('csvtojson');

exports.getProducts = async (req, res) => {
  const csvFilePath = path.join(__dirname, '..', 'public', 'skus.csv');
  const productList = await csv().fromFile(csvFilePath);
  res.json(productList);
}
