const csv = require('csv');
const fs = require('fs');
const request = require('request-promise');
const inquirer = require('inquirer-promise');
const sink = require('stream-sink');
require('dotenv').load();
const argv = require('yargs')
  .usage('Usage: $0 dailytimeapp-export.csv [--quiet]')
  .option('quiet', {
    alias: 'q',
    default: false,
    describe: "Don't ask for confirmation"
  })
  .option('delimiter', {
    alias: 'd',
    default: ',',
    describe: 'Delimiter used for the CSV'
  })

  .demand(1)
  .argv;

fs.createReadStream(argv._[0])
  .pipe(csv.parse({ delimiter: ',', comment: '#', columns: ['activity', 'timeInMinutes'] }))
  .pipe(csv.transform(parseCsvRecord))
  .pipe(sink({ objectMode: true }))
  .on('data', worklog => checkWorklog(worklog)
    .then(askForConfirmation)
    .then(submitToJira)
    .catch(err => console.log(err.message))
  )
  .on('error', err => { throw new Error(err) });

/**
 * Parse CSV records to a JSON structure, aka "worklog".
 */
var date;
function parseCsvRecord(record) {
  // This is the date line
  if (!record.activity && record.timeInMinutes.includes('/')) {
    date = convertDate(record.timeInMinutes);
    return;
  }

  const issue = parseIssue(record.activity);
  return {
    date: date,
    number: issue.number,
    description: issue.description,
    timeInMinutes: record.timeInMinutes,
  };
}

/**
 * Checks a given worklog for mistakes.
 *
 * @param worklog
 * @throws Error if mistakes are found.
 * @returns {Array} Correct worklog.
 */
function checkWorklog(worklog) {
  const info = missingInfo(worklog);

  if (info.length) {
    return Promise.reject(Error("Missing data for: \n" + info.join("\n")));
  }

  return Promise.resolve(worklog);
}

/**
 * Push data to Jira.
 * @param {Array} worklog
 */
function submitToJira(worklog) {
  // Post each work log
  console.log('Sending to Jira...');
  return Promise.all(worklog.map(postWorklogToJira))
    .then(res => console.log(`Transferred ${res.length} entries.`));
}

/**
 * Checks if the user wants to commit the data
 * @param {Array} worklog
 */
function askForConfirmation(worklog) {
  if (argv.quiet) {
    return Promise.resolve(worklog);
  }

  dumpWorklog(worklog, console);

  return inquirer
    .confirm('Does this look alright?')
    .then(confirmed => confirmed ? Promise.resolve(worklog) : Promise.reject('Canceled'));
}

/**
 * Parses a JIRA issue number from a text.
 *
 * A Jira issue number always is some capital letters,
 * a minus and a number. Example: XXX-12345.
 *
 * @param text
 * @returns {Object} Issue number and description.
 */
function parseIssue(text) {
  var issue = /([A-Z]{2,10}-\d{1,5})(.*)/.exec(text);

  if (!issue) {
    return { number: null, description: text };
  }

  return {
    number: issue[1],
    description: issue[2].trim()
  };
}

/**
 * Returns missing info in a worklog.
 *
 * @param {Array} worklog
 * @returns {Array}
 */
function missingInfo(worklog) {
  var missingInfo = worklog.filter(function (row) {
    return row.timeInMinutes <= 0 || !row.number || !row.description;
  });

  return missingInfo.map(row => row.number + " " + row.description);
}

/**
 * Post a single work log to jira.
 *
 * @param worklog
 */
function postWorklogToJira(worklog) {
  //return request({
  return Promise.resolve({
      method: 'POST',
      uri: process.env.JIRA_ISSUE + worklog.number + '/worklog',
      headers: {
        Authorization: 'Basic ' + process.env.JIRA_TOKEN
      },
      body: {
        started: worklog.date + 'T18:00:00.201+0000',
        timeSpent: worklog.timeInMinutes + 'm',
        comment: worklog.description
      },
      json: true,
    });
}

/**
 * Converts 27/01/16 format to '2016-01-27'.
 */
function convertDate(date) {
  var part = date.split('/');

  return ["20" + part[2], part[1], part[0]].join('-');
}

/**
 * Dumps worklog on the given output log.
 *
 * @param worklog
 * @param console
 */
function dumpWorklog(worklog, console) {
  console.log(worklog.length + " entries:");
  worklog
    .map(log =>
      [
        log.number,
        log.timeInMinutes + ' min',
        log.description
      ].join("\t")
    )
    .map(log => console.log(log));
}
