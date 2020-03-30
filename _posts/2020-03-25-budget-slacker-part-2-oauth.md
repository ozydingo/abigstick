---
layout: post
title: "Budgeting with Slack Part 2: OAuth"
description: "A budget app I'll actually use!"
date: 2020-03-23 06:17:00 -0400
comments: true
tags: [Slack, Serverless, Google Cloud, OAuth]
---

In this post, we're going to build a Slack app that integrates to Google Sheets to track household expenses.

We're doing this in three parts. In our [last post](2020/03/17/budget-slacker.html) we built out the basic read/write functionality from Slack, however it relied on us manually creating a spreadsheet and obtaining OAuth tokens. In this post, we'll build functions to handle that for us, so this will work for any new team without the  manual work.

* Part 1: Basic infrastructure with reads and writes to our budget spreadsheet
* *Part 2: (This post)Allow new Slack workspaces to authorize their own Drive account via Google Oauth*
* Part 3: Deploying the entire app using Google Deployment Manager

## The path less traveled

It's time to build out the larger, but far less used path in our  previous architecture diagram

{% include post_image.html class="padded-image" name="architecture-full.png" width="700px" alt="Budget Slacker architecture" title="Architecture"%}

So we're gonna need:

* To determine if a Slack message is from a team that has valid OAuth tokens or not
* A way to send users over to a Google-owned OAuth page
* A function handle Google redirecting the user after granting permissions
* A procedure to store the OAuth tokens for a team
* A procedure to initialize a new budget spreadsheet for a team using their OAuth tokens
* A bigger boat

We'll make use of functions we defined in [Part 1]((2020/03/17/budget-slacker.html)), such as `getSecret` and `invokeFunction`, so be sure to reference those if you're confused.

## Routing new teams through our OAuth path

We're going to check for valid OAuth in our main backgrond function, `handle_pubsub_message`. Again, this is so `handle_slack_command` is optimized for the most common use case and doesn't risk timing out responses just because it wants to check the Firestore database on every request.

To do this, we'll need only add the following code to the top of the `router` function isnide `handle_pubsub_message/index.js`, right after we fetch `teamInfo`:

```js
if (!haveValidTokens(teamInfo)) {
  return handleInvalidOauth({response_url, team_id: data.team_id});
} else if (!haveValidSpreadsheet(teamInfo)) {
  return handlleInvalidSpreadsheet({response_url});
}
```

Ok, fine I'll also define those functions. The predicate functions are really just MVP stubs, checking for the presence of the info in our database.

```js
function haveValidTokens(teamInfo) {
  return teamInfo && teamInfo.tokens;
}

function haveValidSpreadsheet(teamInfo) {
  return teamInfo && teamInfo.spreadsheet_id;
}
```

In a more complete version, we should check the spreadsheet itself and make an authentication request to confirm the data we have are valid. We should also go one step further and update the OAuth tokens from using the refresh token (check the db, it's there) when the access token expires. But I won't get into that here.

The way we handle not having a spreadsheet_id is a punt, for now, since it shouldn't happen under normal circumstances:

```js
function handlleInvalidSpreadsheet({response_url}) {
  return messageSlack({response_url, data: responses.invalidSpreadsheetMessage});
}
```

Where, in `responses.js`:

```js
function invalidSpreadsheetMessage() {
  return "Uh oh! I can't find your budget spreadsheet. Please contact support.";
}
```

This won't actually come up if you don't delete your spreadsheet, so don't do that and let's move on.

The more meaningful function here is the last remaining one, `handleInvalidOauth`. This calls out to another function that responsible for initiiating the OAuth process for this team:

```js
async function handleInvalidOauth({response_url, team_id}) {
  return invokeFunction(process.env.initiateOauthUrl, {response_url, team_id});
}
```

## OAuth and Security

Initiating OAuth with Google APIs is a standard OAuth procedure:

* Use the google api client authenticated with your app secret, to generate an authentication and authorization URL, and direct the user there.
* After the user grants access, Google will redirect the user to a redirect URL that you have already specified and set up in your application with Google.
* You are allowed to use a `state` string to store information that will be passed on to your redirect URL. You cannot trust that this information has not been altered.

Let's spend a moment on that last note. In `handle_oauth`, we need to somehow identify the team we're authorizing  when Google OAuth redirects the user after granting permissions, and this has little to do with the Google identity being used. However, we can't trust `state` in this redirect request to not be tampered with.

To be fair, since we're not operating with these authorization tokens in the user's browser, we're not subject to many of the common OAuth [CRSF attacks](https://auth0.com/docs/protocols/oauth2/mitigate-csrf-attacks). About the best an attacker could do is replace a known team_id's budget and Google auth tokens with a dummy account owned by the attacker. Still, let's prevent that.

We'll handle this by generating a nonce, or a one-time, random token that will be attached to this team's record and sent in the OAuth state parameter. This tokens will only be valid when a verified request from Slack tries to connect to the spreadsheet for the first time and will be made to expire in 15 minutes. This makes me feel good about the securit of the `handle_oauth` function.

But let's also talk about this "verified request" assumption. If an attacker can make an arbitrary request to `initiate_oauth`, then our nonce is pointless. However, as we discusses in the previous post, the only way to do this is to fool our Slack message verification. If an attacker gains access to our Slack verification token, they could do this. This is why Slack provides a [more secure method of verification](https://api.slack.com/docs/verifying-requests-from-slack). If this were anything more than a silly blog about a silly budget app, I'd go down that path. But here, it's just not worth it.

## Function: initiate_oauth

This is what we're really here for. What is the code that gets this whole OAuth process running without all the manual steps we had to take in the previous post? Let's look at the entry point first.

```js
const crypto = require("crypto");

const { getSecret } = require("./getSecret");
const { invokeFunction } = require("./invoke_function.js");
const responses = require("./responses.js");

const credentialsPromise = getSecret(process.env.appCredentialsSecret);

async function main(req, res) {
  const { response_url, team_id } = req.body;
  const oauth_nonce = generatePerishableToken();
  const oauth_nonce_expiration = generateExpirationTime();
  await invokeFunction(process.env.teamsUrl, {
    action: "update",
    team_id,
    oauth_nonce,
    oauth_nonce_expiration,
  });

  const state = JSON.stringify({team_id, oauth_nonce});
  const app_credentials = await credentialsPromise;
  const url = getAuthUrl({app_credentials, state});
  const oauthMessage = responses.requestOauthBlocks({oauthUrl: url});
  await messageSlack({response_url, data: oauthMessage});
  res.status(200).send("");
}

function generatePerishableToken(bytes = 64) {
  return crypto.randomBytes(bytes).toString("hex");
}

function generateExpirationTime(minutes = 15) {
  return (new Date()).getTime() + minutes * 60 * 1000;
}

module.exports = {
  main
};
```

The nonce is a buffer of 64 random bytes, represented as a hex string. If you guess that in 15 minutes of me requesting a new OAuth token, go ahead, hack by budget spreadsheet. We set that nonce and expiration time on the teams Firestore document using the previously shown `teams` function. We then respond to Slack using an interactive message that allows the user to click over to the Google Oauth page:

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

{% include post_image.html class="padded-image" name="oauth-request.png" width="500px" alt="OAuth dialog with 'Grant' and 'Cancel' buttons" title="OAuth Request"%}

A small note before we move on. Regardless of this URL action on the "Grant" button, Slack expects another URL it will make a `POST` request to when any of the buttons are pressed. Go to "Interactivity and Shortcuts" in your Slack app, enable it, and add the URL of this dummy function like so:

{% include post_image.html name="interaction-url.png" width="100%" alt="Set the URL of your function to the interactivity URL" title="Interactivity Settings"%}

We're just going to give it a dummy function:

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

Finally, there's the `getAuthUrl` function we used above. This just wraps the Google module's usage of the OAuth client:

```js
const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file"
];
const oauthRedirectUri = process.env.handleOauthUrl;

function getAuthUrl({app_credentials, state}) {
  const {client_secret, client_id} = app_credentials;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, oauthRedirectUri
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });

  return authUrl;
}
```

Note that the `drive.file` scope would be perfectly sufficient and much easier to get past a Google app review, but unfortunately as best I can tell that does not allow our app to read, and therefore copy, the [public spreadsheet](https://docs.google.com/spreadsheets/d/1wxB-doRFGIlMRNAn9wTJ9ySyxl5V5M0WOyK0L1MRjsc/edit?usp=sharing) that I've set up to be the initial template that all budget spreadsheets will start with. So `drive.readonly` seems to be an unfortunate requirement short of recreating this public template from a API commands. Nah.

## Function: handle_oauth

When the user authenticates and grants permissions, they will be redirected to our `handle_oauth` function with the state that we set up earlier as well as a temporary `code` that Google sends us.

Again, the main entry point:

```js
async function main(req, res) {
  const { code, state } = req.query;
  const { team_id } = JSON.parse(state);
  const [,tokens] = await Promise.all([
    verifyOauthRequest({state}),
    getTokens({code})
  ]);

  const [setupResponse,] = await Promise.all([
    setupTeam(team_id, tokens),
    storeTokens(team_id, tokens),
  ]);

  const { spreadsheet_id } = setupResponse;
  const message = grantResponse(spreadsheet_id);

  res.set("Content-Type", "text/html");
  res.status(200).send(message);
}
```

The first step here is to, in parallel, verify the nonce we have in our OAuth state parameter while also following standard protocol and exchanging the `code` parameter for a set of OAuth tokens. Follow any primer on OAuth if you're confused, but, in brief, this code exchange allows us to trust the granted tokens. Our `handle_oauth` function actually has no idea where the original request came, so we can't trust that request until we handshake with a known Google service to verify the code was legit and grants us access tokens. We do this in the `getTokens` function using, again, Google's OAuth module.

```js
const { google } = require("googleapis");

const { getSecret } = require("./getSecret");

const credentialsPromise = getSecret(process.env.appCredentialsSecret);
const clientPromise = credentialsPromise.then(app_credentials => {
  const {client_secret, client_id} = app_credentials;
  const client = new google.auth.OAuth2(
    client_id, client_secret, redirect_url
  );
  return client;
});

async function getToken(code) {
  const client = await(clientPromise);
  const token = await client.getToken(code);
  return token;
}
```

Calling this function gives us the tokens right off the bat, but we still need to wait for the verification of `team_id`, as discussed above with the whole nonce nonsence.

```js
async function verifyOauthRequest({ state }) {
  const { team_id, oauth_nonce } = JSON.parse(state);
  const teamInfo = await getTeamInfo(team_id);

  if (!teamInfo.oauth_nonce_expiration || !teamInfo.oauth_nonce) {
    throw new Error("Team is not in a valid state for OAuth.");
  }
  if (new Date(teamInfo.oauth_nonce_expiration) < new Date()) {
    throw new Error("OAuth state token has expired.");
  }
  if (teamInfo.oauth_nonce !== oauth_nonce) {
    throw new Error("OAuth state token mismatch.");
  }
}
```

As promised, we check that the team has a valid nonce, that the nonce is not expired, and that the nonce given in the request matches this nonce. If any of these checks fail, the `Promise.all` call blows up and we abort the entire function.

If these checks pass, and we get a valid OAuth token response, we move onto the next block where we call `setupTeam` and `storeTokens`. First:

```js
async function storeTokens(team_id, tokens) {
  return invokeFunction(process.env.teamsUrl, {
    action: "update",
    team_id,
    tokens,
    oauth_nonce: null,
  });
}
```

we store the tokens and erase the nonce. Then, we invoke one final cloud function to set up this team's budget spreadsheet, if necessary.

```js
async function setupTeam(team_id, tokens) {
  const app_credentials = await credentialsPromise;
  return invokeFunction(process.env.setupUrl, {
    app_credentials,
    team_id,
    tokens
  });
}
```

The `setup` function will be another dumb wrapper function that expects you to pass it all credentials needed. Before we dive in, let's just take a quick look at the slack response once this completes.

```js
function spreadsheetUrl(spreadsheet_id) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheet_id}`;
}

function grantResponse(spreadsheet_id) {
  return `<html><body>Thanks! You can <a href=${spreadsheetUrl(spreadsheet_id)}>view or edit your budget spreadsheet here</a> at any time. You can now close this window and return to Slack.</body></html>`;
}
```

I'd prefer to automatically close the window, but browsers don't let you do that if you didn't open the window. Since I'm using this from the Slack app, that's not true. I could add it for other users that use mobile or Slack in a browser, but ... meh.

## Function: setup

There's only one thing to do here. Copy the public template spreadsheet.

```js
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

function createSpreadsheet({ app_credentials, tokens }) {
  return invokeFunction(
    process.env.spreadsheetsUrl, {
      action: "create",
      app_credentials,
      tokens
    },
  ).then(({ spreadsheet_id }) => spreadsheet_id);
}

module.exports = {
  main,
};
```

Oh, right, this calls out to the `spreadsheets` function. Damnit I've really microserviced myself to death here, haven't I? The thought is this function will take care of all necessary setup steps for a team. The `spreadsheets` function is explicitly in charge of creating / copying the spreadsheet file, and perhaps eventually other spreadsheet operations. But anyway, right now, these are basically one in the same. The only setup needed is creating the spreadsheet. I may soon add a re-OAuth process to this function, but that'll do for now.

## Function: spreadsheets

Without further ado:

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

Use the Google Drive client to copy the public spreadsheet into the user's account and return the new spreadsheet id.

And ... that's it. We're done.

## Wrapping up

To be hoenst, I found this work rather chorish. I wanted to codify the OAuth process, and I wanted to play with doing so in our microservice state of mind. But that was a lot of extra effort and a lot of extra functions to gain OAuth tokens that are pretty easy to get manually and we don't have to do much with once we do. Still, I learned something doing it, and now the app is ready to share, no longer tied to my own, single Google account and budget spreadsheet. Whee!
