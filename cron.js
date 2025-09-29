const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { getReporting } = require("./controllers/reportingController");

schedule.scheduleJob('0 0 0 */1 * *', () => {
  console.log('Running at', new Date());
  getReporting();
});

const existing = fs.existsSync(path.join(__dirname, 'public', 'reporting.csv'));
if (!existing) {
  getReporting();
}
