---
layout: post
title: "Pollers and Promises"
date: 2019-03-29 00:00:00 -0400
comments: true
tags: [Javascript, Async, Promise]
---

For some reason, I've found most walkthroughs of asynchronous Javascript constructs, i.e. everything based on the `Promise`, difficult to come to a fundamental understanding of. I could follow recipes but it wasn't clicking. This was most obvious when I was simply trying to wait for a "ready" status on some html element and execute code once that occurred (or immediately if it was already ready).

This post walks through how to do that in a way I think would have found helpful, ending in a function called `once` that sets this up for you, removing a fair amount of duplicated code if you do this sort of thing a lot.

This post assumes basic familiarity with [ES6](https://es6.io/) constructs such as arrow functions. There are tons of online works about these, so I won't repeat them.

## The Promise

The basic usage of `Promise` is straightforward.

```js
const p = new Promise(function(resolve, reject) {

  // ... do something that may take a long time

  if (it_succeeded) {
    resolve(value)
  } else {
    reject(new Error("Here's an error message"))
  }
})

p.then(function(value) {
  // Do something else with `value`, passed into `resolve`, above.
}).catch(function(err) {
  // Do something with error, passed into `reject`, above.`
})
```

For a barebones demo, try

```js
(new Promise((resolve, reject) => {
  setTimeout(() => resolve('foo'), 1000)
})).then(x => console.log(x))
```

Basically, you expect with a `Promise` that something will eventually call the arbitrarily named functions `resolve` or `reject`, and this will trigger actions set up by `then` or `catch` clauses.

A very common use case is fetching data from a server, where some `fetch` method is made to return a promise rather than be a blocking call:

```js
fetch(data_url).then(response => {
  updateTableData(response);
}).catch(...)
```

Nested `then`s started becoming a problem in Javascriptland, so more recently we got the `async/await` construct:

```js
async function requestTableUpdates() {
  response = await fetch(data_url);
  updateTableData(response);
}

requestTableUpdates();
```

Simple enough. And yet, when I just wanted to wait for an existing value to meet some criteria, when I needed to build my own `Promise` that didn't just have a stupid `setTimeout`, I stumbled.

## Wait for me!

What was the simplest way to write and use Promise that would let me trigger code once a condition was met? Did I have to write a timeout loop? I thought `Promise`s let you not have to do that! Couldn't I just create a simple `Promise` whose function simply checked the value I was interested in? Could I use `await`? What about `promisify`?

All of these options teased me with names that implied they would do this for me. After all, Javascript engines already have a lot of optimized mechanics to poll for timers and execute callbacks. Can't I just throw some function or object into that same mechanism and quite simply `on(myValue, doSomething)`? But, in fact, the `Promise` and `async/await` constructs are simpler constructs that let you accomplish this but only with a little extra Dorito grease. You have to build the poller yourself and wrap it in a Promise.

Note: if you know a better way, please add it to the comments! I've come to the conclusion that this is the way to go. Perhaps its for the best; if you could add an arbitrary function into, say, Node's [event loop](https://nodejs.org/es/docs/guides/event-loop-timers-and-nexttick/), you could probably very easily bring the entire engine to a halt with one bad line of code.

## Are we there yet?

Let's say we want to wait for a boolean variable `x` to become `true`, then do something. But we don't have any callback functions available to us. To solve this, let's build a polling loop inside a Promise:

```js
let x = false

const wait_for_x = new Promise((resolve, reject) => {
  const poll = () => {
    if (x) { resolve(); }
    else { setTimeout(poll, 100); }
  };
  poll();
})

wait_for_x.then(() => console.log("Huzzah!")).catch((err) => console.error(err));
```

Note that this poller does not have any timeout errors, just to keep it dead simple right now.

One point I missed in my early wrestling with this topic was to create the poller within the scope of the `Promise` so it could call the `resolve` (or `reject`) functions. You can't compose these independently -- that is, you can't create a poller that you access in the `Promise` (the poller can't call `resolve`), and you can't create a `Promise` that you pass the the poller (what would you even do with it?).

For completeness, let's add a timeout and error handling.

```js
let y = false

const wait_for_y = new Promise((resolve, reject) => {
  const start_time = new Date();
  const poll = () => {
    if (y) { resolve(); }
    else if ((new Date()) - start_time > 5000) { reject(new Error("Timeout!")); }
    else { setTimeout(poll, 100); }
  };
  poll();
}).catch(err => { throw(err) })

wait_for_y.then(() => console.log("Huzzah!")).catch((err) => console.error(err));
```

This is about as simple as it can get, but I'd have to write this block of code tailored to each variable or value I wanted to wait for. I objected.

In particular, it surprised me that it was being left to hand-written code to implement mechanics such as polling, polling interval, and timeout. A lot of boilerplate with possible bugs. I was surprised that there wasn't a more idiomatic and built-in way of easily saying "wait for `x` to be `true` then do something". I thought `Promise`s were all about this.

## Wrapping it up

How do we write a reusable construct to avoid all this code duplication for every time we want to write "wait for x then do y"? Let's write a function named `once` that lets us do just this: `once(x).then(y)`.

```js
const once = function(checkFn, opts = {}) {
  return new Promise((resolve, reject) => {
    const startTime = new Date();
    const timeout = opts.timeout || 10000;
    const interval = opts.interval || 100;
    const timeoutMsg = opts.timeoutMsg || "Timeout!";

    const poll = function() {
      const ready = checkFn();
      if (ready) {
        resolve(ready);
      } else if ((new Date()) - startTime > timeout) {
        reject(new Error(timeoutMsg));
      } else {
        setTimeout(poll, interval);
      }
    }

    poll();
  })
}
```

The `once` function returns a nice, easy `Promise`, and wraps up the polling and timeout mechanisms as I've seen fit to implement them here.

Now we can simply use it like this:

```js
let z = false;
once(() => z).then(() => console.log("Huzzah!!"));

// ...
// to trigger:
setTimeout(() => { z = true; }, 2000)
```

Or we can get fancy with the options:

```js
let metadata = {status: 'pending', value: null}
once(
  () => metadata.status == 'ready',
  {interval: 1000, timeout: 30000}
).then(val => {
  console.log('Got value: ', metadata.value);
})

// to trigger:
setTimeout(() => {
  metadata.value = 42;
  metadata.status = 'ready';
}, 2000);
```

Or even use the sugary `await`:

```js
let data = {status: 'pending', value: null}

async function respondToData() {
  await once(
    () => data.status == 'ready',
    {interval: 1000, timeout: 30000}
  )

  console.log('Got value: ', data.value);
}

respondToData();

// to trigger:
setTimeout(() => {
  data.value = 42;
  data.status = 'ready';
}, 2000);
```
