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

The first thing you need to do is create a slack app. Head over to https://api.slack.com/apps and click "Create New App". You'll need to do this in both workspaces; let's start with the "target" workspace that we're going to lose access to.

{% include post_image.html name="create-app.png" width="500px" alt="Create New App dialog" title="Create New App dialog"%}

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

Now that we have an incoming webhook, we need a way to trigger it. We'll create a Slack app in our "hidden" workspace to do so using the webhook we just created and Slack's "Slash Commands" feature.

{% include post_image.html name="slash-commands.png" width="500px" alt="Slash command feature" title="Slash commands"%}

We'll create a slash command, `/haunt` that allows us to send messages to the target workspace typing, for example `/haunt Hello from the other side!`. As we set this up, you'll notice we need a POST URL to send the slash command data to.

{% include post_image.html name="create-slash-command.png" width="500px" alt="Create slash command dialog" title="Create slash command"%}

For this we're going to use Google Cloud Functions. Mostly using default settings, this will set up an http endpoint we can give slack.

{% include post_image.html name="create-cloud-function.png" width="500px" alt="Create cloud function dialog" title="Create cloud function"%}

I'm going to use Node.js 8 as the runtime. We'll start out with the following code to look at what Slack sends us.

```js
exports.haunt = (req, res) => {
  const body = req.body;
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
{ token: '[---REDACTED---]',
  team_id: '[---REDACTED---]',
  team_domain: '[---REDACTED---]',
  channel_id: '[---REDACTED---]',
  channel_name: 'directmessage',
  user_id: '[---REDACTED---]',
  user_name: '[---REDACTED---]',
  command: '/haunt',
  text: 'Oooooooo!!!',
  response_url: 'https://hooks.slack.com/commands/[---REDACTED---]',
  trigger_id: '760926744263.431810811761.0e7bf2c9fd50d6caa2f5a0e58d620674' }
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
  const body = req.body;
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

So far we've just created a way to send messages. We also need to be able to receive them! To do this, first let's go ahead and set up another Cloud Function that will handle these messages. I'll create a function called 'abigstick-watch' with the following code.

```js
exports.watch = (req, res) => {
  res.status(200).send(req.body.challenge);
};
```

Bear with me; once we put this URL into our Slack app it will immediately attempt to verify it by sending it a `challenge` parameter and it will verify the URL if it receives the same challenge back.

Once this function is created, we'll go back into our "Ghost" app settings (that's the on in the target workspace), click into "Event Subscriptions", and turn this feature on. Paste in the http trigger from the function created above, and you should see the URL verification method, confirming that our function sent back the challenge. If it fails, you can always hit "retry" after fixing the errors.

Now add subscriptions to the following events:

* message.im (for direct messages)
* message.groups (for private channel messages)
* message.channels (for public channel messages)
* message.npim (for multi-party direct messages)

Save changes.

Don't get freaked out (or excited about) the "private channel" thing -- your used authorizes the app and it only has access to the authorizing user(s) private channels.

As stated on that page, you also need to add the associate OAuth scopes:

* im:history
* groups:history
* channels:history
* npim:history

Click into "OAuth & Permissions", scroll down to "Scopes" and add these four scopes. You'll notice that the "incoming-webhook" scope has already been added by our actions above.

Hit "Save Changes", and you'll see a big warning banner across page telling you you need to reinstall your app. This will happen any time you changes your app's scopes, and it will post a message about this change to a channel of your choosing. If you choose a channel different from the webhook we set up above, it will also add a webhook to that channel. You can keep that additional webhook or delete it.

Now that the event subscriptions are in place, we'll change the code of our function to do something useful with them. Again, first, let's just log it to see what it looks like. Change the function's source code to

```js
exports.watch = (req, res) => {
  body = req.body;
  console.log(body)
  res.status(200).send("ok");
};
```

Once deployed, go back into Slack, in the target workspace, and type in a message (easiest place to test is in your self-channel).

View the result in the function's log:

```
{ token: '[---REDACTED---]',
 team_id: '[---REDACTED---]',
 api_app_id: '[---REDACTED---]',
 event:
  { client_msg_id: '[---REDACTED---]',
    type: 'message',
    text: 'Hello?',
    user: '[---REDACTED---]',
    ts: '[---REDACTED---]',
    team: '[---REDACTED---]',
    channel: '[---REDACTED---]',
    event_ts: '[---REDACTED---]',
    channel_type: 'im' },
 type: 'event_callback',
 event_id: '[---REDACTED---]',
 event_time: 1568375967,
 authed_users: [ '[---REDACTED---]' ] }"
 ```

 The relevant info for regular text messages is `body.event.text`, `body.event.channel`, and `body.event.user`. Let's broadcast this over to our hidden workspace. To do this, we need to allow incoming messages to our hidden workspace. We could do this with a webhook like we did at the target workspace, but that's so one page ago. Let's use Slack's [`chat.postMessage`](https://api.slack.com/methods/chat.postMessage) API method! This method will actually allow us to more advanced things like route messages to difference channels without setting up a webhook for each channel.

 In order to use this API endpoint, we'll need an authorization token. Our app actually already has one but not with the correct permissions associated. To get them, we need to request the "chat:write:bot" scope. So head back over to the hidden workspace's app ("Haunt"), click into "OAuth & Permissions", scroll down to "Scopes" and add "chat:write:bot". Again, you'll have to reinstall the app after doing this.

 Once you've done this, scroll up to the top of "Oauth & Permissions" and copy the OAuth token. Let's first test it out using `curl`. Once again, I've created a destination channel for this specific purpose, which I'm calling "the-haunt". Fortunately, Slack let you specify channels by name instead of ID when making posts using `chat.postMessage`:

 ```bash
 token=PASTE_TOKEN_VALUE_HERE
 curl https://slack.com/api/chat.postMessage -X POST -H "Authorization: Bearer $token" -H "Content-type: application/json; charset=utf-8" --data '{"text": "Hello", "channel": "the-haunt"}'
 ```


{% include post_image.html name="chat-postMessage.png" width="500px" alt="Incoming chat from postMessage" title="postMessage"%}

With that working, let's now trigger it from our event subscriptions in the target workspace. Head back to out `abigstick-watch` function and change the code to:

 ```js
 const axios = require('axios');
 const postUrl = 'https://slack.com/api/chat.postMessage';
 const token = 'NO TOTALLY DO NOT PASTE YOUR TOKEN IN PLAIN TEXT HERE';

 exports.watch = (req, res) => {
   const body = req.body;
   console.log(body)

   const { user, channel, text } = body.event;
   const data = {
     text: `*${user}@${channel}:* ${text}`,
     channel: 'the-haunt',
   };
   const headers = {
     "Authorization": `Bearer ${token}`,
     "Content-type": "application/json; charset=utf-8"
   };

   axios({
     method: "POST",
     url: postUrl,
     data,
     headers,
   });

   res.status(200).send();
 };
 ```

Look, obviously you should store your token in some secure fashion. Since we're using Google Cloud, [Secrets Management](https://cloud.google.com/solutions/secrets-management/) looks like a good solution. AWS has a similar service. All of that is out of scope for this walkthrough, though.

We also need to add axios to package.json, as we did for our abigstick-haunt function. Recall, that will look like this:

```json
{
  "name": "sample-http",
  "version": "0.0.1",
  "dependencies": {
    "axios": "^0.19.0"
  }
}
```

With the function saved, since the Slack event subscriptions are already set up, we should be good to go!

{% include post_image.html name="being-watched.png" width="500px" alt="Posting a message in the target workspace" title="Target workspace message"%}

{% include post_image.html name="watching.png" width="500px" alt="Viewing the message in the hidden workspace" title="Hidden workspace channel"%}

As you can see, the user and channel are represented as IDs, not names. I'll leave it as an exercise to the reader to translate these into human readable names -- the quick & dirty method I'm still using is to build an object where the keys are known IDs and the values are the display names. You can, of course, use the Slack API to get these values, but that adds another API call into the workflow, slowing everything down for data that is for the most part entirely static.
