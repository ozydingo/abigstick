---
layout: post
title: "Personal budgets using Slack"
description: "Using Slack for easy data entry to Google Spreadsheets"
date: 2019-06-02 04:34:00 -0400
comments: true
tags: [Slack, Serverless]
---

In this post, we're going to build a Slack app that integrates to Google Sheets to track expenses in a budget.

## Budgeting

Budget apps suck.

This isn't a personal finance blog, so I'll spare most of the motivation here. But my wife and I want to keep a simple budget, and the bottom line is we need something in between tracking monthly credit card bills and a full-blown third party app.

* Third party apps such as Mint and You Need a Budget have lots of features, none of which quite align with how I want to track my finances. Mint, for example, has a ton os categories and subcategories that frankly make adjusting a budget completely impractical for me.
* I've held my nose and given a third party app most of my financial logins, with great reservation. I've also had to reverse over $500 in fraudulent charges a week after doing so, resulting in my credit card being cancelled right before I went on vacation. Until I can give read-only access with revokable tokens, I'm not doing that again.

Spreadsheets are excellent. They're exactly as flexible as I want them to be. They do exactly what I tell them to do. Google Sheets comes with a rich, robust interface for reviewing and updating data and a workflow that I, and more importantly, my wife, already knows without having to learn any other syntax or conventions.

The only problem is that data entry is a PITA. Try as we might, it's just not something we're going to keep up with. So let's move that part to Slack!

## Slack for Data Entry

Slack is a perfect place to put data entry. It's on my phone. It's on my wife's phone. I can define a simple syntax for data entry: `/spend $15.23 on dining: Tacos!` will translate to the data

```
{
  amount: 15.23,
  category: "dining",
  note: "Tacos!",
  user: "Andrew"
}
```

Two taps on my phone gives me a data entry prompt. This is a low enough barrier that we'll actually be able to do it reliably, tracking expenses as we spend them.

At this point, why not use a more structured database for data storage? As I've mentioned above, spreadsheets gives us all the functionality we need once the data are in. I don't have to build a query interface for my wife to use. We can review and correct data right out of the gate. For budgeting to be useful to us, we want the data in a spreadsheet. Integrating the data entry to Slack is the only missing piece, so that's what we're going to build.

## The architecture

Requirements for this project include:

* Log expenses from Slack
* View current budget summary from Slack
* View and modify data in Google Sheets

As we've done [before]() and [since](), we'll use serverless functions (specifically, here, Google Cloud Functions) as the immediate layer between Slack and any of our application internals. I'll stick with a Node.js runtime since we'll be making multiple parallelisms and the syntax for doing so in Javascript is really quite lovely.

Because I can't resist, we're also going to include the following features not strictly required for MVP

* Authentication to a unique Google account for different workspaces

I'm doing this not only because I'm stubborn, but also because it requires a whole different authentication scheme compared to using the same account that the Google Function is deployed on, and that just feels like the kind of structure that's nicer to get in ahead of time (we'll see just how true that is as we proceed). We'll store user and workspace data in Google Firestore as an easy start, but any reasonable persistence layer would do.

The one problem we'll run into is that the Google Sheets API library is actually rather slow. Too slow, in fact, for Slack's demands of a 3 second timeout. This is almost entirely in the authentication. So in fact we cannot wait for the Google Sheets operations to complete before completing our response to Slack. Instead, we'll have to give an immediate response and trigger a background task to actually insert or fetch data from the spreadhseet.

The delay between data entry and final confirmation is a bit of a UX impediment and again made me consider using a SQL database for the financial data instead. As I mentioned above, however, a top requirement is the ability to review and edit data directly in the spreadsheet, because I'm not going to build out a CRUD interface that gives the richness of experience that Google Sheets already provides and that my wife will use. A possible compromise would be to have one-off "export to Spreadsheet" functions, but again we're stuck with data editing. No, We'll stick with using the spreadsheet as the single data store.
