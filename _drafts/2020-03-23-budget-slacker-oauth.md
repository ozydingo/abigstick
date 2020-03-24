
│   ├── handle_slack_interaction [...]
│   └── teams


handle_pubsub # router

if (!haveValidTokens(teamInfo)) {
  return handleInvalidOauth({response_url, team_id: data.team_id});
} else if (!haveValidSpreadsheet(teamInfo)) {
  return handlleInvalidSpreadsheet({response_url});
}

Some more stuff is going on here; this is the main passage for all actual request processing before branching out into the individual functions.

* First, we get the team metadata from Firestore database, keyed by `team_id` that we can get straight from the Slack request data.
* We check if we have valid oauth tokens for this team. If not, we need to request them from the user.
* We check if we have a valid spreadsheet exists for this team. If it does nont, we need to create it.
* Finally, we branch on the `action` field and call a sub function that handles the appropraite logic.

For now, let's move on to the other functions we used in `handle_pubsub_message`. Two of them, `haveValidTokens` and `haveValidSpreadsheet`, are basically MVP punts for more thorough token and resource validation, just checking that the information to find them exists.

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


## Oauth

Alright, look, I know you're getting tired, right, but we can't take the easy way out. We haefv to deal with Oauth before we can dive into the endpoints that read and write from the spreadsheets.

A basic Oauth workflow is to send the user to an authentication page at the identity provider (here, Google). After logging in and verifying the granted permissions ("scopes"), the identity provider redirects the user to a URL you have set up with a code. To verify that this request is legit, your server (excuse, me, serverless function) send this code back to the identity provider in exchange for authentication tokens that you can subsequently use to make authenticated calls to the service.

So we have two functions: `request_oauth` and `store_oauth`, repsenting either side of this transaction.

In `requesut_oauth`, we:

* Retrieve the secret that tells Google we are the application we way we are.
* Make a request to Google's authentication URL with the secret and some "state" information that Google will keep attached to this request.
  * Here, we need the team id to be returned to us when the user authenticates so we know where to store the tokenn.
* With Google, we have to use their client library to get the authentication URL. This is the `getAuthUrl` function, below. To even do this, we need the app secret, which we've stored in Secrets Manager (see `getSecret`, defined above)
* We also need to [identify the scopes](https://developers.google.com/identity/protocols/oauth2/scopes) we require. Ideally, this would just be `drive.file` scope, which give our application permission to create files and edit files that we have created. However, we need `drive.readonly` as well because we're going to copy a read-only, [public spreadsheet](https://docs.google.com/spreadsheets/d/1wxB-doRFGIlMRNAn9wTJ9ySyxl5V5M0WOyK0L1MRjsc/edit?usp=sharing) that I've set up to be the initial template that all budget spreadsheets will start with. Without the `drive.readonly` or greater scope, we can't read this file from the app and therefore can't copy it into our own account.

```js
const { google } = require("googleapis");

const { getSecret } = require("./getSecret");

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file"
];
const oauthRedirectUri = process.env.storeOauthUrl;

// Do this on function initializaion; it doesn't change.
const credentialsPromise = getSecret(process.env.appCredentialsSecret);

function getAuthUrl({app_credentials, team_id}) {
  const {client_secret, client_id} = app_credentials;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, oauthRedirectUri
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: JSON.stringify({team_id}),
  });

  return authUrl;
}

function htmlRedirect(url) {
  return `<html><head><script>window.location.href="${url}";</script></head></html>`;
}

async function main(req, res) {
  const { query: { team_id } } = req;
  const app_credentials = await credentialsPromise;
  const oauthUrl = getAuthUrl({app_credentials, team_id});
  res.status(200).send(htmlRedirect(oauthUrl));
}

module.exports = {
  main,
};
```

So when the user clicks the "Grant" button from the above Slack interactive block, we'll respond with this function, sending them to `oauthUrl` containing the scopes and team_id.

When the user authenticates, we'll get a request to our `storeOauth` function. In this function, we parse the code from the request, exchange it with Google for tokens (for which we again need the app secret), store these tokens in our database (Look, don't give me slack about encryption, you wanna hack my family budget? Go for it.), and, if necessary, create the spreadsheet for the team.

As always, start with `main` and branch out from there.

```js
const { google } = require("googleapis");

const { getSecret } = require("./getSecret");
const { invokeFunction } = require("./invoke_function");

// Do this on function initializaion; it doesn't change.
const credentialsPromise = getSecret(process.env.appCredentialsSecret);

// TODO: get URL from deployment url property instead of constructing it
const redirect_url = `https://us-east1-budget-slacker.cloudfunctions.net/${process.env.functionName}`;

const clientPromise = credentialsPromise.then(app_credentials => {
  const {client_secret, client_id} = app_credentials;
  const client = new google.auth.OAuth2(
    client_id, client_secret, redirect_url
  );
  return client;
});

async function getToken(code) {
  console.log("Exchanging code for tokens");
  const client = await(clientPromise);
  const token = await client.getToken(code);
  return token;
}

async function storeTokens(team_id, tokens) {
  console.log(`Storing tokens for team ${team_id}`);
  return invokeFunction(process.env.teamsUrl, {
    action: "update",
    team_id,
    tokens
  });
}

async function setupTeam(team_id, tokens) {
  const app_credentials = await credentialsPromise;
  return invokeFunction(process.env.setupUrl, {
    app_credentials,
    team_id,
    tokens
  });
}

function spreadsheetUrl(spreadsheet_id) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheet_id}`;
}

function grantResponse(spreadsheet_id) {
  return `<html><body>Thanks! You can <a href=${spreadsheetUrl(spreadsheet_id)}>view or edit your budget spreadsheet here</a> at any time. You can now close this window and return to Slack.</body></html>`;
}

async function main(req, res) {
  const { code, state } = req.query;
  console.log("Got oauth code with state",  state);
  const team_id = JSON.parse(state).team_id;
  const tokenResponse = await getToken(code).catch(console.error);
  if (!tokenResponse.tokens) { throw new Error("Unable to get tokens. Response:", tokenResponse); }
  const { tokens } = tokenResponse;

  const [setupResponse,] = await Promise.all([
    setupTeam(team_id, tokens),
    storeTokens(team_id, tokens),
  ]);

  const { spreadsheet_id } = setupResponse;
  const message = grantResponse(spreadsheet_id);

  res.set("Content-Type", "text/html");
  res.status(200).send(message);
}

module.exports = {
  main,
};
```

This renders in the user's browser, but really we want to direct them back to Slack. I use the Slack desktop app or mobile app, so with browser restrictions I won't be allowed to close the window using javascript, and so the best I'm going to do is give the user and ok message and tell them they can close the window.

One thing you might have noticed was by glaring `TODO` in this function. See, normally, I pass function URLs into other functions using environment variables. Here we have a challenge. We don't need the URL because we're trying to call it, we need it because Google's oauth client requires it as a means of identifying the application request. The problem is, we need the function of *this very function*, `store_oauth`. Google deployment manager can't pass a function's URL into itself, that's a very tight circular  dependency. So, to get around this, I am manually constructing the URL from the pattern that I know Deployment Manager currently uses.

## Setup

We're almost there, I promise.

The last thing we called in `store_oauth` was another function called `setup`. This function is responsible for setting up a team's metainfo and spreadsheet. If we already have the spreadsheet, we'll just return the id. Otherwise, we'll call the `spreadsheets` function with `action=create` to copy a new one from the template I mentioned above.

```js
const { invokeFunction } = require("./invoke_function");

function getTeam(team_id) {
  return invokeFunction(
    process.env.teamsUrl, {
      action: "get",
      team_id,
    }
  );
}

function createSpreadsheet({ app_credentials, tokens }) {
  return invokeFunction(
    process.env.spreadsheetsUrl, {
      action: "create",
      app_credentials,
      tokens
    },
  ).then(({ spreadsheet_id }) => spreadsheet_id);
}

async function main(req, res) {
  const { app_credentials, team_id, tokens } = req.body;
  const team = await getTeam(team_id);

  let spreadsheet_id;
  if (team.spreadsheet_id) {
    spreadsheet_id = team.spreadsheet_id;
  } else {
    spreadsheet_id = await createSpreadsheet({app_credentials, tokens});
    console.log("Created spreadsheet", spreadsheet_id);
    await invokeFunction(
      process.env.teamsUrl, {
        action: "update",
        team_id,
        spreadsheet_id,
      }
    );
  }

  res.status(200).json({team_id, spreadsheet_id});
}

module.exports = {
  main,
};
```

## Spreadsheets

Ok, now *I'm* getting tired.

The spreadsheets function will copy the fixed, template spreadhseet, whose id is and always will be `1wxB-doRFGIlMRNAn9wTJ9ySyxl5V5M0WOyK0L1MRjsc`, into the user's now authenticated project. Like before, we need the app secret to make this call. Unlike before, we're going to have these functions that interface with Google Sheets and Firestore require that the caller provide them (remember, these functions are not public). This keeps the app secret logic isolated to the oauth functions for greater separation of concerns. This function focuses only on knowing how to use those credentials to copy the spreadsheet that it knows about.

```js
const { google } = require("googleapis");

const templateSpreadsheetId = "1wxB-doRFGIlMRNAn9wTJ9ySyxl5V5M0WOyK0L1MRjsc";

function oauthClient({app_credentials, tokens}) {
  const { client_id, client_secret } = app_credentials;

  const client = new google.auth.OAuth2(
    client_id,
    client_secret,
  );
  client.setCredentials(tokens);

  return client;
}

function driveClient({app_credentials, tokens}) {
  return google.drive({version: "v3", auth: oauthClient({app_credentials, tokens})});
}

function copyTemplate({app_credentials, tokens}) {
  const drive = driveClient({app_credentials, tokens});
  return drive.files.copy({
    fileId: templateSpreadsheetId,
    resource: {
      name: "Budget Slacker"
    }
  });
}

async function create(req, res) {
  const { app_credentials, tokens } = req.body;
  const response = await copyTemplate({app_credentials, tokens});
  const spreadsheet_id = response.data.id;
  res.status(200).json({spreadsheet_id});
}

// async function get(req, res) {
//   const { app_credentials, spreadsheet_id, tokens } = req.body;
//   client.spreadsheets.get({spreadsheetId: spreadsheet_id});
// }

async function main(req, res) {
  const { action } = req.body;

  if (action === "create") {
    await create(req, res);
  } else {
    res.status(400).send("Bad action");
  }
}

module.exports = {
  main
};
```

## HandleSlackInteraction

Ok I've saved the best for last. Remember the oauth prompt we sent to the user in Slack? Well even though the only behavior we actually wanted was the URL redirect from the "Grant" button, Slack will still insist on pinging a URL for all interactive components. So we'll just put up a simple function that does nothing and gives a 200 OK response.

```js
function main(req, res) {
  const { body } = req;
  const payload = body.payload ? JSON.parse(body.payload) : null;
  console.log("Got payload:", payload);

  res.status(200).send("✔");
}

module.exports = {
  main,
};
```
