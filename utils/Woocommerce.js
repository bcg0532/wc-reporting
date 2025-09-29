const { default: axios } = require("axios");

const WCApiRequest = axios.create({
  baseURL: process.env.WC_BASE_URL,
  auth: {
    username: process.env.WC_CONSUMER_KEY,
    password: process.env.WC_CONSUMER_SECRET
  }
});

module.exports = WCApiRequest;
