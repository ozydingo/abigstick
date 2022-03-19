---
layout: post
title: "Deploy Nagging"
description: "When you don't have a CD pipeline, at least you can be nagged about it"
date: 2022-03-19 08:20:00 -0400
comments: true
tags: [CI, CD, slack, github]
---

## Nagging about deployment

A lot of shops have a CI/CD pipeline set up so that merges to the main branch trigger checks, tests, and, if everything passes, automatic deployment.

I work in a shop that does not. Moving to CD is a north star goal, but it's so baked into our process and our culture that merges to `main` do _not_ trigger automatic deployment that simply making it so could have some pretty bad implications. Still, we are gorwing to a size where we can't just rely on [good intentions](https://www.linkedin.com/pulse/good-intentions-dont-work-mechanisms-do-jv-roig/) providing a reasonable deploy cadence so some poor level 1 engineer isn't stuck with a list of 37 commits on their first attempt at a production deploy.

So we're going to build a low-lift, low-maintenance, intermediate solution. We'll post a nag to Slack whenever we have more than N commits on `main` that have not yet been deployed. In our process, we can count undeployed commits by simply comparing `main` to an automatically updated branch called `production`. We'll use N = 8.

## The Slack webhook

One of the requirements of this project is no additional infrastructure to manage. This means avoiding writing up any data storage, and secrets mangement, and the like. We're going to use the dead simple [Slack Webhooks](https://slack.com/help/articles/115005265063-Incoming-webhooks-for-Slack) to post messages.

## Github actions

We host our code on Github. So we can take advantage of [Github actions](https://docs.github.com/en/actions) to add a single yml file to our repository, and we have all the tools we need!

### On push to main

First, we want this action to run only on a push to the `main` branch. (Note: this includes PR merges, which is not only good but a requirement.) To do this, we configure the action with the following

```yml
name: ProdDivergence
on:
  push:
    branches:
      - main
```

We're naming our action `ProdDivergence`, and configuring it to match the `push` action only to a branch called `main`. Is there an echo in here?

### What the git?

Github actions don't have access to your repository history by default. Instead, we'll use the preconfigured [checkout action](https://github.com/actions/checkout) as the first job our action will run. Since we need access to the `production` branch, we're going to start by checking that branch out explicitly.

```yml
jobs:
  report_divergence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
          ref: production
```

More specifically, we need the next step to be able to resolve both `production` and `main` (or, more specifically, the `after` target provided in the [github action data](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#webhook-payload-object-37) -- this refers to the head commit after the push). Without further tuning, the easiest way to do this is to provide `fetch-depth: 0` to get the entire git history.

### What happened?

Next, we need to list the commits between `production` and `main`. A simple `git log` will do, with some formatting:

```
git log --pretty=format:%s HEAD..${{ github.event.after }}
```

Since we checked out `production`, `HEAD` refers to the latest commit on `production`. Note that we can't refer directly to `production` because the checkout action does not appear to fetch branch names. Similarly, we can't reference `main`, but we can use the event data `github.event.after` which will reference the commit on the target branch after the push, aka `main`.

We're using `pretty=format:%s` to generate an easy-read summary that won't overwhelm a Slack thread. This will print only the first line of each commit's message without the gitref, like so:

```
feat(users) [AS] Add forgot password link
fix(users) [AS] Fix broken forgot password link
chore(users) [AS] Remove unused code in forgot password link
```

### Bashed up

We want to do a bit more than just post the commits every time. So let's write a quick bash script to

- Format the commit list
- Count the commits
- Only post the latest few commits to not overwhlem the Slack channel
- Add a link to the github compare URL for the full list / more information
- Format the Slack message
- Only post the Slack message if the commit count is above a threshold

Without further ado,

```sh
# Replace this with your Slack webhook
url="https://hooks.slack.com/services/T*****/B*****/*****"
# Get just the familiar branch name from the ref
branch_name=$(basename ${{ github.event.ref }})
# Construct the compare URL for more information
compare_url="${{ github.event.repository.url }}/compare/production..$branch_name"
# Define a threshold
threshold=8
# List all commits between main and production
commits=$(git log --pretty=format:%s ^HEAD ${{ github.event.after }})
# Count the commits
count=$(echo "$commits" | wc -l)
# Trim to the latest three
latest_three=$(echo "$commits" | head -3)
# Add bullet list formatting
commit_list=$(echo "$latest_three" | awk '{ print " - " $$0 }')
# Bash doesn't play well with the ` character, so use a variable
backtick='`'
# Make it friendly
header=":thinking_face: ${backtick}${branch_name}${backtick} is <$compare_url|$count commits> ahead of ${backtick}production${backtick} -- time for a deploy?"

# Construct the message
message="$header
Latest commits include:
$commit_list
- ... <$compare_url|but wait, there's more!> ..."

# Log it in the github action ouutput for debugging
echo "$message"

# If over the threshold, post $message to the webhook!
[ $count -gt $threshold ] &&
  curl -X POST -H 'Content-type: application/json' --data "{\"text\":\"$message\"}" "$url"
```

### Puutting it all together

Finally, our github action file, at `/.github/workflows/prod_divergence.yml`, looks like this

```yml
name: ProdDivergence
on:
  push:
    branches:
      - main

jobs:
  report_divergence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
          ref: production

      - name: Post the commits
        run: |
          url="https://hooks.slack.com/services/T*****/B*****/*****"
          branch_name=$(basename ${{ github.event.ref }})
          compare_url="${{ github.event.repository.url }}/compare/production..$branch_name"
          threshold=8

          commits=$(git log --pretty=format:%s ^HEAD ${{ github.event.after }})
          count=$(echo "$commits" | wc -l)
          latest_three=$(echo "$commits" | head -3)
          commit_list=$(echo "$latest_three" | awk '{ print " - " $$0 }')
          backtick='`'
          header=":thinking_face: ${backtick}${branch_name}${backtick} is <$compare_url|$count commits> ahead of ${backtick}production${backtick} -- time for a deploy?"
          message="$header
          Latest commits include:
          $commit_list
          - ... <$compare_url|but wait, there's more!> ..."
          echo "$message"
          [ $count -gt $threshold ] &&
            curl -X POST -H 'Content-type: application/json' --data "{\"text\":\"$message\"}" "$url"
```

A bit much script for a yml file, but this meets the goal of a quick, very-low-maintenance feature.

{% include post_image.html name="slack.png" width="700px" alt="Hmm, time for a deploy?" title="nag"%}

(A non-`main` branch was used for testing, but you get the point.)
