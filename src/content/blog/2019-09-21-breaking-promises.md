---
title: "Breaking Promises"
description: "Using a timeout fallback for a Javascript promise that takes too long"
date: 2019-09-21 00:53:00 -0400
tags: [Javascript, Promise, Async]
---

We've all made promises we can't keep.

How you deal with that in your personal life is your call, but in Javascript let's walk through some options for what to do if a Promise is taking too long to resolve. The two basic choices are reject or use a fallback value. Really, a fallback value ought to be handled by a rejection with a `catch`. But, as we'll see, it's adding a lot of boilerplate for a pretty common use case, so let's deal with it here too.

In either case, the basic mechanics are the same. Set up a timeout function to call the resolve or reject function of your Promise. For good measure, clean up the timeout if it's not reached. (Note that it's actually ok to let subsequent calls to resolve or reject fire; these have no effect.)

Here's a first-pass example.

```js
class TimeoutError extends Error {}

async function doSomething(delay = 2000) {
  await new Promise(res => setTimeout(res, delay));
  return "result";
}

const promise = new Promise((resolve, reject) => {
  const maxTime = 3000;
  const timeout = setTimeout(() => {
    reject(new TimeoutError("Operation timed out"))
  }, maxTime);
  doSomething(2000).then(response => {
    resolve(response)
    clearTimeout(timeout)
  })
})

promise.then(value => console.log(value)).catch(err => console.log(err))
```

You can play around with the delay value to convince yourself that this works as intended.

Let's generalize this by creating a function that returns a promise with a timeout. Let's go one step further and allow an optional default resolved value in case of timeout. This will be useful if we don't want a promise chain to just break because of one timeout. As mentioned above, we could do this in a `catch` for each timeout-able Promise, but to do this right we'd have to mix in checks for our `TimeoutError` in with the rest of our catch logic, and I'd prefer not to.

As of yet, [you can't cancel a promise](https://medium.com/@benlesh/promise-cancellation-is-dead-long-live-promise-cancellation-c6601f1f5082). So to do what we want, we can't take an existing promise, we have to construct this timeout-able promise from scratch. But, importantly, we can't generalize the logic of cancelling the action that's going on inside the promise, such as fetching data from a remote server. We can only cancel our timers.

```js
class TimeoutError extends Error {}

function cancelTimeoutWhenCalled(func, timeout) {
  return function(...args) {
    clearTimeout(timeout);
    func(...args);
  }
}

function promiseWithTimeout(resolver, maxTime, defaultValue) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (defaultValue !== undefined) {
        resolve(defaultValue);
      } else {
        reject(new TimeoutError("Operation timed out"))
      }
    }, maxTime);

    resolve = cancelTimeoutWhenCalled(resolve, timeout);
    reject = cancelTimeoutWhenCalled(reject, timeout);

    resolver(resolve, reject);
  })
}
```

Let's see this in action, then break it down.

```js
async function doSomething(delay = 2000) {
  await new Promise(res => setTimeout(res, delay));
  return "result";
}

// Timeout is 1 sec; promise is rejected
promiseWithTimeout((resolve, reject) => {
  doSomething(2000).then(response => resolve(response))
}, 1000).then(response => console.log(response))

// Timeout is 5 sec, promise is resolved with "result"
promiseWithTimeout((resolve, reject) => {
  doSomething(2000).then(response => resolve(response))
}, 5000).then(response => console.log(response))

// Timeout is 1 sec; promise is resolved with "N/A"
promiseWithTimeout((resolve, reject) => {
  doSomething(2000).then(response => resolve(response))
}, 1000, "N/A").then(response => console.log(response))
```

Nice!

## Break it down

Let's start at the `promiseWithTimeout` entry point.

The timeout code itself is basically the same as before, just with a check for default value.

```js
const timeout = setTimeout(() => {
  if (defaultValue !== undefined) {
    resolve(defaultValue);
  } else {
    reject(new TimeoutError("Operation timed out"))
  }
}, maxTime);
```

Fairly straightforward; we have a `resolve` and `reject` function, and we call one of these in the resolution of our timeout.

Next we have this funny `cancelTimeoutWhenCalled` thing.

```js
function cancelTimeoutWhenCalled(func, timeout) {
  return function(...args) {
    clearTimeout(timeout)
    func(...args);
  }
}
```

Not too bad if you're pretty familiar with Javascript functions as first-class citizens and the [spread operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax), but a little wonky to wrap you head around if you're not. What we're doing here is saying we want to take one function, for example, our `resolve` function from above, and return a new function that does the exact same thing but first executes `clearTimeout(timeout)`. This the return value of `cancelTimeoutWhenCalled` is another function (defined inline), that takes any number of args, calls `clearTimeout`, then calls the original function with the same args that were passed in.

You can generally use this pattern to insert custom functionality (logging is a good example) before and/or after an existing function.

```js
function libraryFunction(x) {
  console.log(`Doing something with ${x} from an imported library`);
}

function logFunction(func) {
  return function(...args) {
    console.log(`Starting ${func.name} with args ${args}`);
    func(...args);
    console.log(`Finished ${func.name}`);
  }
}

logFunction(libraryFunction)(42)
// output:
// > Starting libraryFunction with args 42
// > Doing something with 42 from an imported library
// > Finished libraryFunction
```

Finally, we call `resolver(resolve, reject);`. Here, `resolve` and `reject` are modified versions or their originals; we've used the `cancelTimeoutWhenCalled` function modified to make sure that if either are called by the `Promise` internals, we'll intercept and call `clearTimeout` first to clean up our timer.

`resolver` is just a name for the function that you pass into a Promise. I often don't think of the argument to `new Promise(...)` as a function, but that's what it is. It can help to realize that these are equivalent:

```js
// Style 1
new Promise((resolve, reject) => {
  resolve(42)
}).then(result => console.log(result));

// Style 2
const resolver1 = (resolve, reject) => {resolve(42)};
new Promise(resolver1).then(result => console.log(result));

// Style 3
function resolver2(resolve, reject) {
  resolve(42);
}
new Promise(resolver2).then(result => console.log(result));
```

We're just calling the resolver function passed in by the user with our modified versions of `resolve` and `reject` from our internal Promise.
