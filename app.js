require("dotenv").config();

const express = require("express");
const cors = require("cors");
const reportingRoutes = require('./routes/reporting');
const productRoutes = require('./routes/product');

require('./cron');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/api/reporting', reportingRoutes);
app.use('/api/product', productRoutes);

app.use(express.static('view'));

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`A Node JS API is listening on port: ${port}`);
});
