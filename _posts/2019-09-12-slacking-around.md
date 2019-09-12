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
