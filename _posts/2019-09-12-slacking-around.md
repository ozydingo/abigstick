---
layout: post
title: "Slacking Around"
description: "Communicating across Slack workspaces using cloud functions"
date: 2019-09-12 07:13:00 -0400
comments: true
tags: [slack, google cloud functions, lambda, serverless]
---

I'm about to lose access to a Slack workspace. Job changes.

I knew that Slack has some fancy bot & API features, and out of curiosity I wanted to see what I string up to talk to and from this workspace from a personal workspace. Turns out there are several ways to do it, so let's walk through some of them!

Off the bat and for the record, Slack is pretty good about this and will revoke permissions to apps and bots that a user creates if they lost access or permissions.

If a coworker sets up the app, however ... well that's a different story.

Throughout this post, we'll be using [Google Cloud Functions](https://cloud.google.com/functions/) using a Node.js 8 runtime. We'll need this for some data translation between the requests originating from one workspace and the other. You can use AWS lambdas or any web server you care to set up if you wish.

## Create a Slack app

The first thing you need to do is create a slack app. Head over to https://api.slack.com/apps and click "Create New App". You'll need to do this in both workspaces; let's start with the "origin" workspace that we're going to lose access to.

{% include post_image.html name="create-app.png" width="500px" alt="Create New App dialog" title="Create New App dialog"%}

(Note that I'm using one of two personal workspaces here to protect the company's workspace identity.)

## Incoming Webhooks

The simplest way to send a message into a workspace is set up what slack calls an "Incoming Webook". We'll ditch this approach later because of limitations we'll discuss, but it's worth noting that incoming webhooks won't be halted when the app creator loses access.

{% include post_image.html name="webhooks.png" width="500px" alt="Incoming Webhooks feature" title="Incoming Webhooks feature"%}

Click in to this feature and turn it on. Scroll to the bottom and hit "Add New Webhook to Workspace". You'll have to select a channel to post to. This is the first limitation -- a single webhook can only post to a single channel. If that's all you need, great! I'll select a channel I created for this purpose, called "ghost".

{% include post_image.html name="create-webhook.png" width="500px" alt="Create Webhook" title="Create Webhook"%}

Once you do this, you'll see an example `curl` command that will post a message via this webhook. It should look like

```
curl -X POST -H 'Content-type: application/json' --data '{"text":"Hello, World!"}' https://hooks.slack.com/services/XXXXXX/YYYYYY/ZZZZZZZZZZZZZZZZ
```

Copy and paste that into a terminal and see the message!

{% include post_image.html name="webhook-message.png" width="500px" alt="Webhook message" title="Webhook message"%}

You'll also notice that Slack announces to the incoming channel that you've added an integration.

## Talking with Ghosts

Now that we have an incoming webhook, we need a way to trigger it. Head over to your other workspace and create an app for that workspace too. We're going to first add the ability to post messages to the other workspace via the webhook we already created. To do that, we'll use Slack's "Slash Commands" feature.

{% include post_image.html name="slash-commands.png" width="500px" alt="Slash command feature" title="Slash commands"%}

We'll create a slash command, `/haunt` that allows us to send messages to the webhook typing, for example `/haunt Hello from the other side!`. As we set this up, you'll notice we need a POST URL to send the slash command data to.

{% include post_image.html name="create-slash-command.png" width="500px" alt="Create slash command dialog" title="Create slash command"%}

For this we're going to use Google Cloud Functions. Mostly using default settings, this will set up an http endpoint we can give slack.

{% include post_image.html name="create-cloud-function.png" width="500px" alt="Create cloud function dialog" title="Create cloud function"%}

I'm going to use Node.js 8 as the runtime. We'll start out with the following code to look at what Slack sends us.

```js
/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.haunt = (req, res) => {
  body = req.body;
  console.log(body)
  res.status(200).send("ok");
};
```

Note that I've changed the default `helloWorld` function name to `haunt`. Make sure to change "Function to execute" setting accordingly.

Copy the function's URL, then hit "Create". If you forget to copy the URL, you can find it again in the "Triggers" tab. Paste the URL into your Slack slash command.

To trigger this new slash command, we need to install the app. Find "Install App" in the side panel of app.slack.com and hit "Install App to Workspace". This will bring up an oauth page that grants your app permissions to add slash commands.

With the slash command created, head back into Slack and start typing `/haunt`. If everything is set up right, you'll immediately see the help message pop up. Notice that this is for our second app in our personal workspace. I've called this second app Haunt instead of Ghost and used a modified version of the icon I used for the Ghost app in the A Big Stick workspace.

{% include post_image.html name="slash-command-autocomplete.png" width="500px" alt="Autocomplete dialog for slash command" title="Slash command autocomplete"%}

Type in a message and in a short while you'll get the "ok" response that our Cloud Function returns.

{% include post_image.html name="slash-command-ok.png" width="500px" alt="OK response" title="Slash command ok"%}

Head back to the cloud function and click "View Logs". You should see exactly one function execution. If you triggered it multiple times find the appropriate log entry. You'll see that our `console.log` statement told us what we're working with:

```
textPayload: "{ token: '[---REDACTED---]',
  team_id: '[---REDACTED---]',
  team_domain: '[---REDACTED---]',
  channel_id: '[---REDACTED---]',
  channel_name: 'directmessage',
  user_id: '[---REDACTED---]',
  user_name: '[---REDACTED---]',
  command: '/haunt',
  text: 'Oooooooo!!!',
  response_url: 'https://hooks.slack.com/commands/[---REDACTED---]',
  trigger_id: '760926744263.431810811761.0e7bf2c9fd50d6caa2f5a0e58d620674' }"
```

Pardon the redactions, but I don't want to make your job spamming my slack any easier. In any case, we have the pieces we need: the user id/name, the text that was sent, and, from before, the incoming web hook URL. Now we just need a way to have our cloud function send a POST request to our incoming webhook and we've completed the first part of functionality.

To to the POST, I'm going to install the `axios` npm library. Click "Edit" on the function and click into `package.json` and add axios into the package dependencies. The final result will look something like


```json
{
  "name": "sample-http",
  "version": "0.0.1",
  "dependencies": {
    "axios": "^0.19.0"
  }
}
```

Then modify index.js to the following code. We'll send an imediate response, `"Sending..."`, followed by a confirmation or error message to the `response_url` given to us by slack.

```js
const axios = require('axios');
const webhookUrl = 'YOUR WEBHOOK URL';

exports.haunt = (req, res) => {
  body = req.body;
  console.log(body);
  const text = body.text;
  const data = { text };

  axios({
    method: "POST",
    url: webhookUrl,
    data,
  }).then(res => {
    axios.post(body.response_url, {text: `Message\n>${text}\nconfirmed.`})
  }).catch(err => {
    console.log(err);
    axios.post(body.response_url, {text: `Message\n${text}\nfailed!`})
  });

  res.status(200).send("Sending...");
};
```

Hit "Deploy" at the bottom of the page, and wait for the deploy to finish. Once it does, head back to Slack and try out your slash command again!

Success!

{% include post_image.html name="slash-command-received.png" width="500px" alt="Slash command received" title="Slash command received"%}

And the confirmation message

{% include post_image.html name="slash-command-confirmed.png" width="500px" alt="Slash command confirmed" title="Slash command confirmed"%}

## Listen up

So far we've just created a way to send messages. We also need to be able to receive them!
