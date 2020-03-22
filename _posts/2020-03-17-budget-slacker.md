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

Both `reportSpend` and `addExpense` parse the request data and put a structured message onto PubSub using the `publishEvent` function we just defined. They then return a string message that gets passed back to Slack by the `main` function. `addExpense` uses `parseSpend`, which enforces a pretty strict syntax. Because that's easier for now.

We're taking a "trust but verify" approach here to make the response snappy, assuming that most usage of this function will in fact be legit. We'll verify on the other side of the SubSub bridge in the `handle_pubsub_message` function.

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

Later in this post we'll discuss deploying the PubSub topic using Deployments Manager. But if you're actuallly following along, just [spin one up](https://cloud.google.com/pubsub/docs/quickstarts) in the console  for now. You just need to give it a name.

This function will be triggered by the messages that `handle_slack_command` puts onto this PubSub topic. In the main entry point function, we'll [verify the message authenticity](https://api.slack.com/docs/verifying-requests-from-slack), then decode the PubSub message and act accordingly.

```js
async function main(pubSubEvent) {
  const rawdata = pubSubEvent.data;
  const message = JSON.parse(Buffer.from(pubSubEvent.data, "base64").toString());
  console.log("Got message:", message);
  const { token, action, data, response_url } = message;

  const appToken = await slackTokenPromise;
  if (token !== appToken) {
    console.log("Incorrect app token:", token);
    return;
  }

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

Pretty simple entry point, leaving any interpretation beyond the Slack token to the `router` function. Before we get into that, let's look at the dependencies we're alrleady using here.

First, there's `slackTokenPromise`.

```js
const { getSecret } = require("./getSecret");
const slackTokenPromise = getSecret(process.env.slackTokenSecret);
```

And in getSecret.js

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

Nothing revolutionary here, just straight from the docs usage of `@google-cloud/secret-manager`. Make sure to `npm install` it or manually add it to you your `package.json`. For this to work, you'll need to provide the environment variable value `slackTokenSecret`. This will be the name of a [secret](https://cloud.google.com/secret-manager/docs) that contains the [Slack verification token](https://api.slack.com/events-api#url_verification) you can get from the Slack app you created. I'll place more detailed instructions for these in the appendix that I keep in my brain and never write down.

Next, we saw  the `main` function use a functioncalled `messageSlack`. This function will be the way we respond to Slack after the initial [acknowledgment response](https://api.slack.com/interactivity/handling#acknowledgment_response) provided by `handle_slack_command`, and relies on the Slack-provided [response URL](https://api.slack.com/interactivity/handling#message_responses).


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

Now we can move on and look at the `router` function.

```js
async function router({ action, data, response_url }) {
  const teamInfo = await getTeamInfo(data.team_id);

  if (!haveValidTokens(teamInfo)) {
    return handleInvalidOauth({response_url, team_id: data.team_id});
  } else if (!haveValidSpreadsheet(teamInfo)) {
    return handlleInvalidSpreadsheet({response_url});
  }

  if (action === "report") {
    return handleReport({response_url, teamInfo});
  } else if (action === "spend") {
    return handleExpense({response_url, teamInfo, expense: data});
  } else {
    return Promise.reject("Unrecognized action " + action);
  }
}
```

Some more stuff is going on here; this is the main passage for all actual request processing before branching out into the individual functions.

* First, we get the team metadata from Firebase database, keyed by `team_id` that we can get straight from the Slack request data.
* We check if we have valid oauth tokens for this team. If not, we need to request them from the user.
* We check if we have a valid spreadsheet exists for this team. If it does nont, we need to create it.
* Finally, we branch on the `action` field and call a sub function that handles the appropraite logic.

Progressing systematically, let's look at `getTeamInfo`, `haveValidTokens`, `handleInvalidOauth`, and `handleInvalidSpreadsheet`.

```js
const { invokeFunction } = require("./invoke_function.js");

function getTeamInfo(team_id) {
  return invokeFunction(process.env.teamsUrl, {action: "get", team_id});
}
```

Well that's not very informative. What does `invoke_funuction.js` look like?

It's a bit longer than I'd like but it's another stright-from-the-docs method to invoke a non-pubilc Google Cloud function. That last part is important: the function hosted at `teamsUrl` is how we're going to retrieve stored oauth tokens, we have to make sure it's not publicly accessible. To invoke a non-public function from another function, you need to fetch an invocation token and send that token to the target function in your request headers.

```js
const axios = require("axios");

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

module.exports = {
  invokeFunction,
};
```

Great! Now we have the code needed to invoke one of our cloud functions from another. We'll make heavy use of this going forward. For now, let's move on to the other functions we used in `handle_pubsub_message`. Two of them, `haveValidTokens` and `haveValidSpreadsheet`, are basically MVP punts for more thorough token and resource validation, just checking that the information to find them exists.

```js
function haveValidTokens(teamInfo) {
  return teamInfo && teamInfo.tokens;
}

function haveValidSpreadsheet(teamInfo) {
  return teamInfo && teamInfo.spreadsheet_id;
}
```

That'll do for now. Now for the handlers. How do we handle invalid or missing oauth  tokens or spreadsheets? Let's do the easy one first:

```js
function handlleInvalidSpreadsheet({response_url}) {
  return messageSlack({response_url, data: responses.invalidSpreadsheetMessage});
}
```

Where `invalidSpreadsheetMessage` is just the following:

```js
function invalidSpreadsheetMessage() {
  return "Uh oh! I can't find your budget spreadsheet. Please contact support.";
}
```

Yeah. Punt.

Ok, but oauth? That one's real.

```js
function handleInvalidOauth({response_url, team_id}) {
  const oauthUrl = `${process.env.requestOauthUrl}?team_id=${encodeURIComponent(team_id)}`;
  const oauthMessage = responses.requestOauthBlocks({oauthUrl});
  return messageSlack({response_url, data: oauthMessage});
}
```

Here, we need to [enable and authorize the Google Sheets API](https://developers.google.com/sheets/api/guides/authorizing). Following the instructions there to create an app and attached credentials, we get a Google URL where we can send users to to authenticate and grant us permissions. We then respond to Slack with an interactive component that contains a button that allows the user to navigate to this URL.

```js
function requestOauthBlocks({ oauthUrl }) {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "To start using Budget Slacker, you'll need to grant authorization to use Google Sheets.",
        }
      },
      {
        type: "actions",
        block_id: "oauth-access",
        elements: [
          {
            type: "button",
            value: "grant",
            style: "primary",
            text: {
              type: "plain_text",
              text: "Grant",
            },
            url: oauthUrl,
          },
          {
            type: "button",
            value: "cancel",
            text: {
              type: "plain_text",
              text: "Cancel",
            },
          },
        ]
      }
    ]
  };
}
```

That creates a response that looks like this:

{% include post_image.html class="padded-image" name="oauth-request.png" width="500px" alt="Oauth dialog with 'Grant' and 'Cancel' buttons" title="Oauth Request"%}

When the user clicks on "Grant", they'll be taken to `requestOauthUrl`.

Ok, two more pieces.

```js
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

This just keeps going, doesn't it? Don't worry, we're crossing a threshold. We've seen all these pieces before: `credentialsPromise`, `invokeFunction`, and `messageSlack`. We haven't looked at the `teams` function yet, but as you can infer here it returns the spreadsheet id and oauth tokens required for access for the current team. We use those credentials to read that team's spreadsheet in the function at `getTotalsUrl`, which  we'll see in a bit. Lastly, we reply to Slack with

```js
function reportTotals({totals}) {
  if (totals.length === 0) { return "You haven't spend anything this month yet!"; }
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

The `totals` data comes from the response of the function at `getTotalsUrl`, and contains objects with the structure `{category, values}`, where `values` is an array containing the last few months of totals in that category. Right now, we're only using the current month, hence the `[0]` index.

Ok, and the *final* peice of `handle_pubsub_message`, `handleExpense`. In this function, we'll add the requested expense to the spreadsheet and tell the user how much they've spent on that category so far this month. To do the latter, we'll actually first fetch the current totals and add the current expense to it right here rather than in the spreadsheet, because we don't know how long it takes for the spreadsheet formula that computes the totals to update after our request to add a new row completes. Then we'll add the expense row to the spreadsheet and respond to Slack in parallel using `Promise.all`.

```js
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

Phew, we're done with `handle_pubsub_message`. That was really the crux of all of our business logic. The rest of the functions are pretty straightforward endpoints to read and write data.

## Deployment Manager

Let's take a break from Node.js function code and look at how to actually deploy all of these functions together. In brief, a Deployment Manager configuration or template specifies resources such as functions, pubsub topcis, and IAM roles.

Here's a small snippet of our Deployment Manager configuration to get us started.

```yml
- name: slack-pubsub
  type: pubsub_topic.jinja
- name: handle-slack-command
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_command
    public: true
    environmentVariables:
      pubsub_topic: $(ref.slack-pubsub.name)
```

In this small section, we're creating the first two resources we talked about: the function that handles the Slack command request and the PubSub topic that this function publishes to.

Both resources reference a template that we have additional files for: `pubsub_topic.jinja` and `budget_slacker_function.jinja`. Taking them at face value for now, there are only three configurations we're providing here:

* The code location for `handle-slack-command` -- this refers to a location inside the [Google Source Repository](https://cloud.google.com/source-repositories) that we're pushing this code to.
* Specifying that this function is public, which will mean we allow unauthenticated invocation. We want this to be the case *only* for those functions that need to be called externalls, such as Slack handlers and Oauth redirects.
* The encironment variable `pubsub_topic`, which takes the value of the deeployed name of the pubsub topic. This allows the function to reference the pubsub topic without hardcoding the name or making any assumptions about how Deploymnet Manager names its deployed resources.

Diving into `budget_slacker_function.jinja`, we use a bunch of reasonable function defaults (Node.js runtime, 256 MB memory, 60 s timeout, `main` as the entry point function name), some simple configurations such as the function's base name, code location, and environment variables, and primary have our own logic for

* Public vs authenticated invocation
* HTTPS vs PubSub trigger

{% raw %}
```yml
{% set location = 'us-east1' %}
{% set name = env['deployment'] + '-' + env['name'] %}

{% set environmentVariables = properties['environmentVariables'] or {} %}
{% set function_name = name + "-function" %}
{% set parent = 'projects/' +  env['project'] + "/locations/" + location %}
{% set policy_name = name + "-policy" %}
{% set trigger = properties['trigger'] or {'httpsTrigger': {}} %}
{% set sourceRepoUrl = 'https://source.developers.google.com/projects/budget-slacker/repos/budget-slacker/moveable-aliases/master/paths/' + properties['codeLocation'] %}

{% set _ = environmentVariables.update({'deployTimestamp': env['current_time']|string}) %}
{% set _ = environmentVariables.update({'functionName': function_name}) %}

resources:
  - name: {{ function_name }}
    type: gcp-types/cloudfunctions-v1:projects.locations.functions
    properties:
      function: {{ function_name }}
      sourceRepository:
        url: {{ sourceRepoUrl }}
      parent: {{ parent }}
      timeout: 60s
      runtime: nodejs8
      availableMemoryMb: 256
      entryPoint: main
      {% if 'httpsTrigger' in trigger %}
      httpsTrigger: {}
      {% elif 'eventTrigger' in trigger %}
      eventTrigger:
        resource: $(ref.{{ trigger['eventTrigger'] }}.name)
        eventType: providers/cloud.pubsub/eventTypes/topic.publish
      {% endif %}
      environmentVariables:
        {{ environmentVariables }}
  - name: {{ name }}-policy
    action: gcp-types/cloudfunctions-v1:cloudfunctions.projects.locations.functions.setIamPolicy
    properties:
      resource: $(ref.{{ function_name }}.name)
      policy:
        bindings:
          - members:
            {% if properties['public'] %}
            - allUsers
            {% else %}
            - serviceAccount:{{ env['project'] }}@appspot.gserviceaccount.com
            {% endif %}
            role: "roles/cloudfunctions.invoker"

{% if 'httpsTrigger' in trigger %}
outputs:
  - name: url
    value: $(ref.{{ function_name }}.httpsTrigger.url)
{% endif %}
```
{% endraw %}

Let's briefly walk through our custom logic here.

* We name the function `{{ name }}-policy`. E.g. `handle-slack-command-function`.
* The `trigger` jinja variable can be passed in from the configuration, or it defaults to `{'httpsTrigger': {}}`, which means a regular https trigger with an auto-generated URL. The only other option it supports is `eventTrigger`, which we'll see when we view the configuration for `handle_pubsub_message`.
* We create an IAM policy to attach to the function called `{{ name }}-policy`, e.g. `handle-slack-command-policy`. This policy is attached to the function as its resources and has two possible values for its member binding:
  * `allUsers` for public functions. This is a special  user designation in Google Cloud that allows unauthenticated users to invoke the function.
  * `serviceAccount:{{ env['project'] }}@appspot.gserviceaccount.com`. This construction represents the default [service account](https://cloud.google.com/iam/docs/service-accounts) that other Google Cloud Functions will be using. That is, this member binding allows other Google Cloud functions in the same project to invoke this function.
* Lastly, if the function is an https trigger, we declare an output named `url` to allow the configuration using this template to print this URL out.

The `pubsub_topic.jinja` is relatively much more straightfoward. It's just a PubSub topic with a name.

{% raw %}
```yml
resources:
  - name: {{ env['name'] }}
    type: gcp-types/pubsub-v1:projects.topics
    properties:
      topic: {{ env['deployment'] }}-{{ env['name'] }}

```
{% endraw %}

So, with that, let's just see the full configuration.

```yml
imports:
- path: budget_slacker_function.jinja
- path: pubsub_topic.jinja
resources:
- name: handle-slack-interaction
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_interaction
    public: true
- name: slack-pubsub
  type: pubsub_topic.jinja
- name: handle-slack-command
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_command
    public: true
    environmentVariables:
      pubsub_topic: $(ref.slack-pubsub.name)
- name: handle-pubsub-message
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_pubsub_message
    trigger:
      eventTrigger: slack-pubsub
    environmentVariables:
      addExpenseUrl: $(ref.add-expense.url)
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      teamsUrl: $(ref.teams.url)
      getTotalsUrl: $(ref.get-totals.url)
      requestOauthUrl: $(ref.request-oauth.url)
      slackTokenSecret: projects/526411321629/secrets/slack-verification-token/versions/1
- name: teams
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/teams
- name: get-totals
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/get_totals
- name: add-expense
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/add_expense
- name: request-oauth
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/request_oauth
    public: true
    environmentVariables:
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      storeOauthUrl: $(ref.store-oauth.url)
- name: setup
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/setup
    environmentVariables:
      spreadsheetsUrl: $(ref.spreadsheets.url)
      teamsUrl: $(ref.teams.url)
- name: spreadsheets
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/spreadsheets
- name: store-oauth
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/store_oauth
    public: true
    environmentVariables:
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      setupUrl: $(ref.setup.url)
      teamsUrl: $(ref.teams.url)
outputs:
- name: handle-slack-command-url
  value: $(ref.handle-slack-command.url)
- name: handle-slack-interaction-url
  value: $(ref.handle-slack-interaction.url)
```

Digest that in your own time, but at a high level this configuration is a PubSub topic and a bunch of functions (with IAM roles) as defined by `budget_slacker_function.jinja`. Each function has settings for public vs authenticated, https or pubsub trigger, code location, and any environment variables that the function will need (such as other function URLs, secrets names, or the name of the PubSub topic).
