---
layout: post
title: "Budgeting with Slack"
description: "A budget app I'll actually use!"
date: 2020-03-17 06:17:00 -0400
comments: true
tags: [Slack, Serverless, Google Cloud]
---

In this post, we're going to build a Slack app that integrates to Google Sheets to track household expenses.

Hold onto your hats, this is gonna be a long one.

## Motivation

I want a budget. I want to see where I'm spending money so I know what I can tune up. I've tried several forms of organized budgeting, from several different strategies of spreadsheeting to budget apps like Mint and You Need a Budget to hopelessly trying to aggregate monthly, quarterly, or yearly spend reports from my credit card companies.

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

Wait, we're building an app and *Google Sheets* is the database?

Yep. Google Sheets comes with a rich user interface that both I and my wife already use for finances. It's easy to navigate, search, edit, build graphs, and so on. A household budget doesn't need to scale. Like I said above, spreadsheets are great for budgeting outside of data entry. Slack solves the data entry interface, and Google Sheets provides both the compute engine the UI data review and Sunday morning <del>arguments</del> family discussions.

We'll use the [Google Sheets API](https://developers.google.com/sheets/api) to store and retrieve data in the spreadsheet. But one problem is that this API is a bit slow. Too slow, in fact, for Slack's 3000 ms response requirement. So keep in mind as we build, we're gong asynchronous.

We're also going to need to add a third interaction from the Slack app: granting authorization to our app to write to Google Sheets. We could set this part up manually, but I said that a household budget doesn't need to scale and that's only true if each household budget uses its own spreadsheet. Not that anyone else is going to use this app, no, but -- ok I'm just an overachiever, leave me alone.

## The architecture

[Google Cloud functions](https://cloud.google.com/functions) is my go-to tool for handling the immediate layer behind Slack apps. They're quick and lightweight with minimal overhead. I'm also looking for an excuse to really try out the "micro" part of microservices before rebelling against them in vile horror, so we're going to split the suite of behaviors into multiple sub-functions.

Remember, we need to offline our actual interaction with Slack beacuse the Google Sheets API is too slow. So, in brief, we'll have:

* A function that handles Slack commands and responds immediately after putting the message on some queue
* Functions that run offline to parse the command and interact with other resources such as Google Sheets
* A message queue in between the above two items.

For best user experience, and because we can, these back-end functions will also be able to respond directly to the Slack user.

Since we're already using Google Cloud functions, we may as well use other Google Cloud infrastructure for the rest:

* The message queue will be a [PubSub](https://cloud.google.com/pubsub/docs) topic. It's easy to directly trigger another Google Cloud function with PubSub.
* We'll store metadata, such as the spreadsheet id and authorization tokens, in a [Firestore](https://cloud.google.com/firestore) database. (Having the user authorize per request is -- just no)
* At this point, we're managing several moving parts, so we'll use use [Google Cloud Deployment Manager](https://cloud.google.com/deployment-manager) to keep it all organized.

All told, the architecture looks like this.

{% include post_image.html class="padded-image" name="architecture.png" width="500px" alt="Budget Slacker architecture" title="Architecture"%}

<small>Yes, we could use a separate PubSub topic for each interaction type withing Slack instead of a single message bus. But I don't wanna, ok? Besides, there's a fair bit of shared code to verify the message's authenticity, retrieve the authentication credentials, and authenticate Google Sheets clients, so let's just do that part once.</small>

## The Code

Let's peek at the future and look at the project's organization.

```
.
├── functions
│   ├── add_expense [...]
│   ├── get_totals [...]
│   ├── handle_pubsub_message [...]
│   ├── handle_slack_command [...]
│   ├── handle_slack_interaction [...]
│   ├── request_oauth [...]
│   ├── setup [...]
│   ├── spreadsheets [...]
│   ├── store_oauth [...]
│   └── teams
└── templates
    ├── budget-slacker.yml
    ├── budget_slacker_function.jinja
    └── pubsub_topic.jinja
```

You can see the [full repo](https://github.com/ozydingo/budget-slacker/issues) on Github.

Simple enough. Our deployment templates are in a `templates` folder, and the functions we need are in `functions`. Each of these functions will usue Node.js.

Let's dive into the first function in our data flow, `handle_slack_command`.

### handle_slack_command

Since we're doing heavy lifting asynchronously, let's keep this one as light as possible. Receive a message, publish to PubuSub, respond to Slack. That's it. So we need only `@google-cloud/pubsub` in our dependencies. If you're setting this up from scratch: `npm init` then `npm install "@google-cloud/pubsub"` in the `handle_slack_command` folder, then verify that the created `package.json` file contains the following:

```json
"dependencies": {
  "@google-cloud/pubsub": "^1.5.0"
}
```

Google Cloud Functions will use this `package.json` file to install the same dependencies on the server running the serverless code. (I just like saying that.)

Now for the function itself. It needs to parse the command and do something with the result. Easy:

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

`process.env.GCP_PROJECT` is given to us for free, but we'll have to set up the environment variable `process.env.pubsub_topic`, the string name of the PubSub topic. Hardwire it if you like, but we'll set this up in the Deployment Manager template.

Here's the rest of `handle_slack_command`:

```js
const SPEND_PATTERN = /\$?(\d+(?:\.\d{1,2})?)\s+(?:on\s+)?(.+?)(?:\s*:\s*(.*))$/;

function parseSpend(text) {
  const match = text.match(SPEND_PATTERN);
  if (!match) { return {ok: false}; }
  const [, amount, category, note] = match;
  return {ok: true, expense: {amount, category, note}};
}

async function reportSpend(body) {
  const { token, response_url, team_id } = body;
  const data = { team_id };
  await publishEvent({ token, action: "report", response_url, data });
  return "Crunching the numbers, hang tight!";
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

The return values in  `reportSpend` and `addExpense` are seen as responses in Slack. We're taking a "trust but verify" approach here to make the response snappy, assuming that most usage of this function will in fact be legit. We'll verify on the other side of the SubSub bridge in the `handle_pubsub_message` function.

## Deliverable 1: a working Slack app

Before we get into the other functions, we can pause here and do a small amount of work to have a deliverable product: a working Slack app that accepts these commands and logs them, but doesn't actually do anything with them. Look we're being agile.

I won't go into depth, but here's a checklist:

* Create a [Google Cloud Function](https://cloud.google.com/functions#documentation), making sure it has an HTTP trigger and allows unauthenticated invocations. (Slack needs to be able to call it!)
* Leave the source as "inline editor" and select "Node.js" as the runtime. I'm still using 8 for this, but 10 should work fine even though it's in beta (for GCP) at the time of this writing.
* Paste the dependencies section into `package.json` and the rest into `index.js`.
* Set the "function to execute" to `main`
* Save the function and copy its trigger URL.
* Create a [Slack app](https://api.slack.com/apps)
* Create a [slash command](https://api.slack.com/interactivity/slash-commands), `/spend`. Add the cloud function trigger URL to this command's "Request URL".

Seven small steps, and your app is up and running.

### handle_pubsub_message
