---
layout: post
title: "Budgeting with Slack"
description: "A budget app I'll actually use!"
date: 2020-03-17 06:17:00 -0400
comments: true
tags: [Slack, Serverless, Google Cloud]
---

In this post, we're going to build a Slack app that integrates to Google Sheets to track household expenses.

Hold onto your hats, this is gonna be a long one. We'll do this in three parts:

* *Part 1: (This post) Basic infrastructure with reads and writes to our budget spreadsheet*
* Part 2: Allow new Slack workspaces to authorize their own Drive account via Google Oauth
* Part 3: Deploying the entire app using Google Deployment Manager

## Motivation

I want a budget. Nothing fancy, just a way to track categories of spending that can make a difference. I've tried several forms of organized budgeting, from several different strategies of spreadsheeting to budget apps like Mint and You Need a Budget to hopelessly trying to aggregate monthly, quarterly, or yearly spend reports from my credit card companies.

Budget apps suck.

Mint and You Need a Budget have never aligned with how I want to budget. Mint, for example, has about a billion categories and makes it dreadfully difficult to customize or simply this set. They're all optimized to work when you connect your credit cards and banks, and, yes, I've been hit by credit card fraud after entering these. It's just way too much privilege for the benefit they provide.

Spreadsheets are great and let you do exactly what you want. But data entry sucks for tracking daily expenses. Sorry, I'm not opening up my spreadsheet on my phone and trying to zoom and scroll to the right row to say that I just bought a taco from a street food cart.

So here's a thought. I'm on Slack a lot. Slack apps are fun to build. Typing a quick message to slack is easy -- I already do it to jot notes to myself for later. My wife and I already have a shared Slack workspace. Let's use Slack to enter in our daily expenses!

## Data entry: Slack

Let's turn  `/spend $15.23 on dining: Tacos!` into

```
{
  amount: 15.23,
  category: "dining",
  note: "Tacos!",
  user: "Andrew"
}
```

That's easy enough I might actually even use it!

More completely, there are two interactions we want to support:

* Enter in an expense along with other metadata
* Ask for a quick summary of the current month's spend

We'll do both with the same [slash command](https://api.slack.com/interactivity/slash-commands) `/spend`. By itself, it will respond with a report of the current month. With the syntax described above it will add a new expense to our spreadsheet.

## Data storage: Google Sheets

So, wait, we're building an app and *Google Sheets* is the database?

Yep. Google Sheets comes with a rich user interface that both I and my wife already use for finances. It's easy to navigate, search, edit, build graphs, and so on. A household budget doesn't need to scale. Like I said above, spreadsheets are great for budgeting outside of data entry. Slack just solves the data entry problem.

We'll use the [Google Sheets API](https://developers.google.com/sheets/api) to store and retrieve data in the spreadsheet. One problem is that this API is a bit slow. Too slow, in fact, for Slack's 3000 ms response requirement. So keep in mind as we build: we're gong asynchronous.

We'll eventually add authorization via Google Oauth to use a different spreadsheet for individual Slack workspaces. We'll get to that in the next post -- I said that a household budget doesn't need to scale and that's only true if each household budget uses its own spreadsheet. For now we'll set this up manually.

## The architecture

[Google Cloud functions](https://cloud.google.com/functions) is my go-to tool for handling the immediate layer behind Slack apps. They're quick and lightweight with minimal overhead. I'm also looking for an excuse to really try out the "micro" part of microservices before rebelling against them in vile horror, so we're going to split the suite of behaviors into multiple sub-functions.

Remembering our immediate response requirements, we'll have the following:

* A function that handles Slack commands and responds immediately after putting the message on some queue
* Functions that run in the background to parse the command and interact with other resources such as Google Sheets -- these functions will also be able to respond directly to the Slack user
* A message queue in between the above two items.

Sticking with Google Cloud infrastructure, we'll use:

* A [PubSub](https://cloud.google.com/pubsub/docs) topic as the message queue. It's easy to directly trigger another Google Cloud function with PubSub.
* A [Firestore](https://cloud.google.com/firestore) database to  store auth tokens and a pointer to the spreadsheet document.
* [Google Secrets Manager](https://cloud.google.com/secret-manager/docs) to store secrets such as our oauth client secret and slack app secret.
* [Google Cloud Deployment Manager](https://cloud.google.com/deployment-manager) to keep deployment sane (we'll get to this in Part 3).

At a high level, it will look something like this:

{% include post_image.html class="padded-image" name="architecture.png" width="500px" alt="Budget Slacker architecture" title="Architecture"%}

<small>Yes, we could use a separate PubSub topic for each interaction type withing Slack instead of a single message bus. But I don't wanna, ok? Besides, there's a fair bit of shared code to verify the message's authenticity, retrieve the authentication credentials, and authenticate Google Sheets clients, so let's just do that part once.</small>

## The pieces

Let's dive a little deeper into what component functions we're going to build to make this happen. Specifically, let's carve out what that clump of functions after the PubSub queue looks like. The `handle-pubsub-message` function will parse the command and call one of the following pathways:

* `add-expense`: Add a row to our spreadsheet and report the totals for the added category
* `get-totals`: Fetch this month's category totals
* `request-oauth`: Direct the user to authenticate our application in their Google Drive accuont.

In this post, we're ignoring the oauth path. You can manually obtain tokens for yourself by following the [Google Sheets authorization guide](https://developers.google.com/sheets/api/guides/authorizing). Without this branch, the  architecture remains quite simple.

{% include post_image.html class="padded-image" name="architecture-no-oauth.png" width="500px" alt="Budget Slacker architecture" title="Architecture"%}

But don't you dare get complacent, we're eventually headed here:

{% include post_image.html class="padded-image" name="architecture-full.png" width="700px" alt="Budget Slacker architecture" title="Architecture"%}

## The Code

To peek at where we're headed, you can see the [full repo](https://github.com/ozydingo/budget-slacker/issues) on Github. In brief, all the functions we're looking at are in their own folders in a `functions` folder, and each is written to run in a Node.js 8 runtime environment.

Let's dive into the first function in our data flow, `handle_slack_command`.

## Function: handle_slack_command

Because of our PubSub architecture, we're keeping this function as light as possible. Receive a message, publish to PubuSub, respond to Slack. That's it. For this we need only `@google-cloud/pubsub` in our dependencies. If you're setting this up from scratch: `npm init` then `npm install "@google-cloud/pubsub"` in the `handle_slack_command` folder, then verify that the created `package.json` file contains the following:

```json
"dependencies": {
  "@google-cloud/pubsub": "^1.5.0"
}
```

You can also just paste this into your `package.json` file, but by `npm install`ing it you get to check for updated versions and play with the installed libraries in a node console. In either case, Google Cloud Functions will use this `package.json` file to install the same dependencies on the server running the serverless code. (I just like saying that.)

Now for the function itself. The entry point is a simple control switch:

```js
exports.main = async (req, res) => {
  const { body } = req;
  if (commandHasData(body.text)) {
    const message = await addExpense(body);
    res.status(200).send(message);
  } else {
    const message = await reportSpend(body);
    res.status(200).send(message);
  }
};

function commandHasData(text) {
  return /\w/.test(text);
}
```

Both `addExpense` and `reportSpend` will publish a message to PubSub, so let's carve that function out right now. This simply follows Google's specs for sending data to PubSub.

```js
const { PubSub } = require("@google-cloud/pubsub");
const PUBSUB_TOPIC = process.env.pubsub_topic;

async function publishEvent(data) {
  const client = new PubSub({projectId: process.env.GCP_PROJECT});
  const dataBuffer = Buffer.from(JSON.stringify(data));
  const messageId = await client.topic(PUBSUB_TOPIC).publish(dataBuffer);
  console.log(`Published message id ${messageId} to ${PUBSUB_TOPIC}`);
}
```

The environment variable `GCP_PROJECT` is [available in all Google Cloud Functions](https://cloud.google.com/functions/docs/env-var), but we'll have to set `pubsub_topic` ourselves. This should be the value of a PubSub topic we'll set up. For now, [create it manually](https://cloud.google.com/pubsub/docs/quickstarts) and manually set the environment variable in the Google Cloud Function console. Later, in Part 3, we'll set it automatically to the PubSub topic that gets created in our Deployment Manager configuration.

Moving on, let's look at the easier of the two switched functions, `reportSpend`. It simply pushes the message onto the PubSub topic  using the `publishEvent` function we just defined. Note that the return value is a string that is sent back to Slack via the `res.send` function in `main`.

```js
async function reportSpend(body) {
  const { token, response_url, team_id } = body;
  const data = { team_id };
  await publishEvent({ token, action: "report", response_url, data });
  return "Crunching the numbers, hang tight!";
}
```

We want to do a tiny bit more with `addExpense`, because, for best user experience, we can and should respond immediately in a way that acknolwedges the message content. So we'll parse the message, extract the structured data, push that onto the PubSub topic if valid, and respond to Slack.

```js
// e.g: `$1.00 on food: dollar tacos!`
const SPEND_PATTERN = /\$?(\d+(?:\.\d{1,2})?)\s+(?:on\s+)?(.+?)(?:\s*:\s*(.*))$/;

// return structured data from /spend message
function parseSpend(text) {
  const match = text.match(SPEND_PATTERN);
  if (!match) { return {ok: false}; }
  const [, amount, category, note] = match;
  return {ok: true, expense: {amount, category, note}};
}

async function addExpense(body) {
  const { token, response_url, team_id, text, user_name, user_id } = body;
  const { ok, expense } = parseSpend(text);
  if (!ok) { return "Invalid command format. Use \"$AMOUNT on CATEGORY: NOTE\""; }
  const { amount, category, note } = expense;
  const timestamp = (new Date()).getTime();
  const data = { timestamp, team_id, user_name, user_id, amount, category, note };
  await publishEvent({ token, action: "spend", response_url, data });
  return `$${expense.amount} on ${expense.category}, got it!`;
}
```

A final note here: we're taking a "trust but verify" approach. That is: optimize to make the legitimate use case response snappy, even if it means a few extra bad apple messages on our PubSub queue that we block later anyway. I know, poor choice given the extreme motivation to hack into my family budget.

## Deliverable 1: a working Slack app

We're actually at a stopping point. Right here we can deliver a working, if very limited, app. It responds correctly and can print results to logs. It doesn't integrate with the spreadsheet yet, but it's usable. Look we're being agile.

To make this deliverable, you need to deploy the function and create a Slack app that sends requests to it. I won't go into depth, but here's a checklist.

* Create a [Google Cloud Function](https://cloud.google.com/functions#documentation), making sure it has an HTTP trigger and allows unauthenticated invocations. (Slack needs to be able to call it!)
  * Leave the source as "inline editor" and select "Node.js" as the runtime. I'm still using 8 for this, but 10 should work fine even though it's in beta (for GCP) at the time of this writing.
  * Paste the dependencies section into `package.json` and the rest into `index.js`.
  * Set the "function to execute" to `main`
  * Save the function and copy its trigger URL.
* Create a [Slack app](https://api.slack.com/apps)
  * Create a [slash command](https://api.slack.com/interactivity/slash-commands), `/spend`. Add the cloud function trigger URL to this command's "Request URL".

Just a couple quickstart guides and your app is up and running.

{% include post_image.html class="padded-image" name="pie.png" width="300px" alt="Slack response: $3.14 on pie, got it!" title="Slack Pie"%}

## Function: handle_pubsub_message

This function is triggered by our PubSub topic. It will [verify the message authenticity](https://api.slack.com/docs/verifying-requests-from-slack), then act accordingly.

```js
const { getSecret } = require("./getSecret");
const slackTokenPromise = getSecret(process.env.slackTokenSecret);

async function main(pubSubEvent) {
  const rawdata = pubSubEvent.data;
  const message = JSON.parse(Buffer.from(pubSubEvent.data, "base64").toString());
  console.log("Got message:", message);
  const { token, action, data, response_url } = message;

  // Verify message authenticity
  const appToken = await slackTokenPromise;
  if (token !== appToken) {
    console.log("Incorrect app token:", token);
    return;
  }

  // Perform the requested action
  await router(
    { action, data, response_url }
  ).then(response => {
    console.log("Response:", response);
  }).catch(err => {
    console.error("ERROOR:", err.message);
    messageSlack({response_url, text: "Oh no! Something went wrong."});
  });
}

module.exports = { main };
```

We get the verification token in `slackTokenPromise` from Secrets Manager using the following code in `getSecret.js`:

```js
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

async function getSecret(versionString) {
  const secretsClient = new SecretManagerServiceClient();
  const secretData = await secretsClient.accessSecretVersion({
    name: versionString
  });
  const secret = secretData[0].payload.data.toString("utf8");
  return secret;
}

module.exports = {
  getSecret,
};
```

Nothing revolutionary here, just straight from the docs usage of `@google-cloud/secret-manager` (make sure to `npm install` this or manually add it to you your `package.json`). [Create a secret](https://cloud.google.com/secret-manager/docs) that contains the [Slack verification token](https://api.slack.com/events-api#url_verification) you can get from the Slack app you created, and set the `slackTokenSecret` environment variable to that secret's name.

Next, let's define `messageSlack`. This function will allow us to response to the Slack user after the initial [acknowledgment response](https://api.slack.com/interactivity/handling#acknowledgment_response), and relies on the Slack-provided [response URL](https://api.slack.com/interactivity/handling#message_responses).

```js
const axios = require("axios");

function messageSlack({response_url, data}) {
  return axios({
    method: "POST",
    url: response_url,
    data,
  });
}
```

Standard stuff.

And that does it for the front lines of our PubSub message handling. Let's now look inside the walls at the `router` function. If you're looking at the repo, you'll see we're skipping the oauth stuff, as promised.

```js
const { invokeFunction } = require("./invoke_function.js");

function getTeamInfo(team_id) {
  return invokeFunction(process.env.teamsUrl, {action: "get", team_id});
}

async function router({ action, data, response_url }) {
  const teamInfo = await getTeamInfo(data.team_id);

  if (action === "report") {
    return handleReport({response_url, teamInfo});
  } else if (action === "spend") {
    return handleExpense({response_url, teamInfo, expense: data});
  } else {
    return Promise.reject("Unrecognized action " + action);
  }
}
```

`getTeamInfo` fetches the team info, including the spreadsheet id and stored oauth tokens, from another function we'll look at in a moment. For now, let's describe this `invokeFunction` function. Why do we need this?

We're dealing with sensitive, non-public functions, such as a function to fetch oauth tokens. Obviously we can't allow unauthenticated invocation. The first step is to restrict the users allowed to call this function to the [service account](https://cloud.google.com/iam/docs/service-accounts) used by our project's functions. We'll see in Part 3 how to do this with a Deployment Manager configuration, but for now if you check the box by the function you can make sure that your "Cloud Functions Invoker" permissions contains only your service account, which typically looks like `PROJECT_NAME@appspot.gserviceaccount.com`:

{% include post_image.html class="padded-image" name="IAM-functions-invoker.png" width="400px" alt="Set Cloud Functions Invoker permissions to member budget-slacker@appspot.gserviceaccount.com" title="Function invoker permissions"%}

Now, to call this function, we need to retrieve an [identity token](https://cloud.google.com/functions/docs/securing/function-identity) and authenticate the origin function making the call. This is what we do in `invokeFunction`:

```js
const axios = require("axios");

async function invokeFunction(url, data){
  const token = await getInvocationToken(url);
  const headers = {
    Authorization: `bearer ${token}`,
    "Content-type": "application/json",
  };
  const response = await axios({
    method: "POST",
    url,
    headers,
    data,
  });
  return response.data;
}

const metadataServerTokenUrlBase = "http://metadata/computeMetadata/v1/instance/service-accounts/default/identity?audience=";

function getInvocationToken(functionUrl) {
  const metadataUrl = metadataServerTokenUrlBase + encodeURIComponent(functionUrl);
  return axios({
    method: "GET",
    url: metadataUrl,
    headers: {
      "Metadata-Flavor": "Google"
    }
  }).then(response => response.data);
}

module.exports = {
  invokeFunction,
};
```

We'll make heavy use of this function going forward.

Next let's look at `handleReport`. This function calls another function to retrieve current category totals data from the team's spreadsheet and parses it into a response for Slack.

```js
const responses = require("./responses.js");

async function handleReport({response_url, teamInfo}) {
  const { spreadsheet_id, tokens } = teamInfo;
  const app_credentials = await credentialsPromise;
  const totals = await invokeFunction(
    process.env.getTotalsUrl,
    {app_credentials, spreadsheet_id, tokens}
  );
  const message = responses.reportTotals({totals});
  return messageSlack({response_url, data: message});
}
```

We've seen most of these pieces before: `credentialsPromise`, `invokeFunction`, and `messageSlack`. Let's first look at the `responses.js` contents, then we can dive into both functions at `getTotalsUrl` and `teamsUrl`.

```js
function reportTotals({totals}) {
  if (totals.length === 0) { return "You haven't spend anything this month yet!"; }
  // Sort categories by amount spent in current month
  totals.sort((a, b) => (b.values[0] - a.values[0]));
  let text = "What you've spent so far this month:\n";
  text += totals.filter(item => (
    item.values[0] > 0
  )).map(item => {
    return `${item.category}: $${item.values[0]}`;
  }).join("\n");
  return {text};
}
```

The `totals` data should have the structure `{category, values}`, where `values` is an array containing the last few months of totals in that category. Right now, we're only using the current month, hence the `[0]` index.

{% include post_image.html class="padded-image" name="totals.png" width="400px" alt="Slack response: What you've spend so far this month." title="Slack Totals"%}

<small>Pie deserves its own category</small>

Lastly, `handleExpense`. In this function, we'll add the requested expense to the spreadsheet and tell the user how much they've spent on that category so far this month.

Puase for a sec. We don't have a guarantee that the computed totals in our spreadsheet will update before we read from it. I'm not willing to leave that to chance, so we'll do that math inside our own function. That is:

* Block on waiting to get the current totals.
* In parallel:
  * Add the current expense to the retreived totals and response to Slack.
  * Write the new expense to the spreadsheet.

```js
const responses = require("./responses.js");

async function handleExpense({response_url, teamInfo, expense}) {
  const { spreadsheet_id, tokens } = teamInfo;
  const app_credentials = await credentialsPromise;
  const totals = await invokeFunction(
    process.env.getTotalsUrl,
    {app_credentials, spreadsheet_id, tokens}
  );
  const message = responses.confirmExpense({totals, expense});
  return Promise.all([
    invokeFunction(
      process.env.addExpenseUrl,
      {
        app_credentials,
        expense,
        spreadsheet_id,
        tokens,
      }
    ),
    messageSlack({response_url, data: message}),
  ]);
}
```

`confirmExpense`, as discussed above, adds the current expense to the fetched totals (noting that we're using case-insensitive matching on the category names).

```js
function confirmExpense({totals, expense}) {
  const { amount, category } = expense;
  const totalForCategory = totals.find(item => item.category.toLowerCase() === category.toLowerCase());
  const previousTotal = totalForCategory && Number(totalForCategory.values[0]) || 0;
  const total = previousTotal + Number(amount);
  const text = `You've spent $${total} so far this month on ${category}`;
  return {text};
}
```

Phewf. Lots of stuff. We're almost there.

## Function get_totals

As we danced around above, the `get_totals` function is responsible for reading the spreadsheet and returning the totals per category. Keeping concerns separate, this function  will require that the caller provide authentication credentials -- we won't be fetching secrets here.

Check out the [public spreadsheet template](https://docs.google.com/spreadsheets/d/1wxB-doRFGIlMRNAn9wTJ9ySyxl5V5M0WOyK0L1MRjsc/edit?usp=sharing) to see what ranges we're referring to. `Categories!B1:ZZ7` is the range of category totals going back six months. All in all, this function fetches that data range, formats it a bit, and responds with that data as JSON.

```js
const { sheetsClient } = require("./sheets_client");

const HISTORY = 6;

function parseDollars(value) {
  if (!value) { return 0; }
  return Number(value.replace("$", ""));
}

async function getTotals({sheets, spreadsheet_id}) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheet_id,
    range: `Categories!B1:ZZ${HISTORY+1}`,
    majorDimension: "COLUMNS",
  });
  if (!result.data.values) { return []; }
  const totals = result.data.values.map(array => ({
    category: array[0],
    values: array.slice(1).map(value => parseDollars(value)),
  }));
  return totals;
}

async function main(req, res) {
  const { app_credentials, tokens, spreadsheet_id } = req.body;
  const sheets = sheetsClient({app_credentials, tokens});
  const totals = await getTotals({sheets, spreadsheet_id});
  res.status(200).send(JSON.stringify(totals));
}

module.exports = {
  main
};
```

The `sheetsClient` file just allows us to abstract away the specific Google driver initialization details:

```js
const { google } = require("googleapis");

function sheetsClient({app_credentials, tokens}) {
  const { client_id, client_secret } = app_credentials;

  const client = new google.auth.OAuth2(
    client_id,
    client_secret,
  );
  client.setCredentials(tokens);

  const sheets = google.sheets({version: "v4", auth: client});
  return sheets;
}

module.exports = {
  sheetsClient
};
```

And with that, we have a working function to return  to us current budget totals. We'll use this same function for fetching totals when requested by the user but also  in the  `add_expense` function where we want to respond with the current total in that specific category. Let' see.

## Function: add_expense

Finally, we're at the part that actually gives us the basic functionality we were after to  begin with. What, was that too much work?

We have the same sheetsClient as above, and some data parsing and processing to write a new expense item into our spreadsheet as a new row.

```js
const { sheetsClient } = require("./sheets_client");

const EXPENSE_RANGE = "expenses!A1:F1";

function epochToDatetime(timestamp) {
  const month = timestamp.getMonth() + 1;
  const date = timestamp.getDate();
  const year = timestamp.getFullYear();
  const hour = timestamp.getHours();
  const minute = timestamp.getMinutes();
  const second =  timestamp.getSeconds();
  return  `${month}/${date}/${year} ${hour}:${minute}:${second}`;
}

function dataRow(expense) {
  const time = new Date(expense.timestamp);
  const values = [
    epochToDatetime(time),
    expense.user_id,
    expense.user_name,
    expense.amount,
    expense.category,
    expense.note,
  ];
  return values;
}

async function addExpense({sheets, spreadsheet_id, expense}) {
  const values = dataRow(expense);
  console.log("Appending row with", values);
  return sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheet_id,
    range: EXPENSE_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

async function main(req, res) {
  const { app_credentials, tokens, spreadsheet_id, expense } = req.body;
  const sheets = sheetsClient({app_credentials, tokens});
  await addExpense({sheets, spreadsheet_id, expense});
  res.status(200).send({ok: true});
}

module.exports = {
  main
};
```

Just a little data formatting and a simple `values.append` call to Google Sheets.

## Function: teams

The last piece we need is the `teams` function. It's a pretty simply CRUD (without the D) interface to the Firestore documents containing team metadata, including Google Sheets spreadsheet id and oauth tokens. We've split it into `index.js`, which defines handles valid requests, and `teams.js`, that encapsulates the Firestore-specific logic

`index.js` defines the `get` action, which we've used here, and the `update` action, which we will use in Part 2 when we add the ability for Slack teams to provide their own authentication credentials.

```js
const teams = require("./teams");

async function get(req, res) {
  const { team_id } = req.body;
  const team = await teams.find(team_id);
  const data = team ? team.data() : null;
  res.status(200).json(data);
}

async function update(req, res) {
  const { team_id, tokens, spreadsheet_id } = req.body;
  await teams.update(team_id, {tokens, spreadsheet_id});
  res.status(200).json({ok: true});
}

async function main(req, res) {
  const { action } = req.body;

  if (action === "get") {
    await get(req, res);
  } else if (action === "update") {
    await update(req, res);
  } else {
    res.status(400).send("Unknown action");
  }
}

module.exports = {
  main
};
```

And `teams.js` -- in Part 2 we'll add more to this function to allow writing data, but for now we only need the ability to get a team document by its id, so there's not actually much to this:

```js
const Firestore = require("@google-cloud/firestore");

const COLLECTION_NAME = "teams";
const PROJECT_ID = process.env.GCP_PROJECT;

const firestore = new Firestore({
  projectId: PROJECT_ID,
});
const collection = firestore.collection(COLLECTION_NAME);

async function find(team_id) {
  const result = await collection.where(
    "team_id", "==", String(team_id)
  ).limit(1).get();
  return result.docs[0];
}

module.exports = {
  find,
};
```

All you have to do on the back end is create a [Firestore database](https://cloud.google.com/firestore) with a collection named "teams". To this collection, add a document that contains your Slack team id. You can get your Slack team id either by logging the requests in the functions we've defined here (it's available right in the request body to `handle_slack_command` and we extract it directly in multiple places), or, if you use Slack in a browser, right from the URL when you log in: `https://app.slack.com/client/TXXXXXXXX`. That `TXXXXXXXX` path is your team id.

## Wrapping up

Wait, you're still with us? Damn.

Anyway, there you have it, a fully functioning budgeting app that ties Slack and Google Sheets together. In the next two parts, we'll look at adding team-based authentication so that each team can use its own spreadsheet (because there will totally be other users of my silly Slack app) and deploying all of these functions, complete with dynamically set environment variables, using Google Deployment Manager.

{% include post_image.html name="budget-slacker-icon.png" width="200px" alt="Penguin with dollar bills and coins" title="Budget Slacker Penguin"%}
