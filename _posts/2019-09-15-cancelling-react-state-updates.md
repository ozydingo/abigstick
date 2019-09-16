---
layout: post
title: "Cancelling state updates in React"
description: "Understanding stale updates and closures"
date: 2019-09-15 06:30:00 -0400
comments: true
tags: [React, closures, async, memory]
---

<div style="background-color: rgb(253,240,240); color: rgb(237,76,63); margin: 1em; border-top: 1px solid rgb(240,207,207); border-bottom: 1px solid rgb(240,207,207)">
  Warning: Can't perform a React state update on an unmounted component. This is a no-op, but it indicates a memory leak in your application. To fix, cancel all subscriptions and asynchronous tasks in a useEffect cleanup function.
</div>

If you've been working in React, there's a reasonable chance you've seen the above Javscript console error. It means that you have a component that is no longer being rendered but has some async or delayed function that is attempting to update that component's state.

Here's a stripped down bit of React code that will reproduce this error.

```js
import React, { useEffect, useState } from 'react';

function Child(props) {
  const [token, setToken] = useState(null);

  // Load a token when this component first mounts
  useEffect(() => {
    async function fetchToken() {
      const token = Math.floor(Math.random() * 100);
      // simulate a 2-second fetch delay
      const returnToken = await new Promise(r => {
        setTimeout(() => r(token), 2000)
      });
      setToken(returnToken);
    }

    fetchToken();
  }, [])

  return (
    <div>Your token: {token === null ? 'loading...' : token}</div>
  );
}

function Parent(props) {
  const [showChild, setShowChild] = useState(false);
  return (
    <>
      <button onClick={() => setShowChild(show => !show)}>
        {showChild ? "Hide" : "Show"}
      <button/>
      {showChild && (
        <Child />
      )}
    </>
  );
}

export default Parent
```
{% include post_image.html name="loading.png" width="200px" alt="Loading token" title="Loading token"%}

The error will trigger if you click the "show" button to mount the Child then click "hide" before the token value is set.

What's happening is the anonymous function that we passed into `useEffect` is still being evaluated by the Javascript engine, and it still has a reference to your unmounted component. `setToken` is still going to be called, and it will update a value in memory. Specifically, it has formed a [closure](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures), but the bottom line is that there is memory being devoted to a component that's gone. This is why React complains that you might have a memory leak.

It's actually not clear to me that this particular case is problematic. When you have a subscription, poller, interval, or other kind of continuous update function running, then it's certainly an issue if that keeps running once your component unmounts. But here it's one-and-done, so I can imagine a garbage collector ought to be able to clean this object up once the no-op `setToken` method runs.

Still, it's a little sloppy to just let `setToken` run into the void. This is a common enough problem that there's a new javascript feature in the works, as of this writing, called the [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController). However, as of this post this feature is marked as [experimental](https://developer.mozilla.org/en-US/docs/MDN/Contribute/Guidelines/Conventions_definitions#Experimental) so should not be used in production apps.

So what's a memory-conscious developer to do? The most common pattern I've seen, and used, is to change the effect function to the following:

```js
useEffect(() => {
  let cancel = false;
  async function fetchToken() {
    const token = Math.floor(Math.random() * 100);
    const returnToken = await new Promise(r => {
      setTimeout(() => r(token), 2000)
    });
    if (cancel) { return; }
    setToken(returnToken);
  }

  fetchToken();
  return () => {cancel = true;};
}, [])
```

We've added a `cancel` variable set, a check on this variable, and a [cleanup function](https://reactjs.org/docs/hooks-effect.html#effects-with-cleanup) to our effect that sets cancelled to true. Personally I dislike this syntax for cleanup functions as it abuses the semantic meaning of `return` (why not another arg to `useEffect`?), but that's not my fight to fight.

I also dislike defining this function inside the `useEffect` call, and we'll get into that in a little bit.

We're getting deeper into closure-land here, and it pays to understand them to know how and why this works, because it wouldn't in many other languages. I like to think of a closure as a bag of variables. The variable names don't matter to anyone outside your bag, but as long as your closure exists you've got access to your bag. Here, `cancel` is in our bag. We defined it at the top of this anonymous function. So everything within this function, including `setToken` and the anonymous cleanup function has access to this variable. They all point to the same bag, so when the cleanup function runs, it's updating the same `cancel` that will be read by `fetchToken` right before it tries to call `setToken`.

To really hammer in the closure thing, let's make a small change that will break this code.

```js
useEffect(() => {
  let cancel = false;
  async function fetchToken(cancel) {
    const token = Math.floor(Math.random() * 100);
    const returnToken = await new Promise(r => {
      setTimeout(() => r(token), 2000)
    });
    if (cancel) { return; }
    setToken(returnToken);
  }

  fetchToken(cancel);
  return () => {cancel = true;};
}, [])
```

<div style="background-color: rgb(253,240,240); color: rgb(237,76,63); margin: 1em; border-top: 1px solid rgb(240,207,207); border-bottom: 1px solid rgb(240,207,207)">
  Warning: Can't perform a React state update on an unmounted component. This is a no-op, but it indicates a memory leak in your application. To fix, cancel all subscriptions and asynchronous tasks in a useEffect cleanup function.
</div>

All we've done is passed `cancel` into the function rather than accessing it from the outer namespace. Why would we do this? In my case, I recently needed to re-use the same fetch function in two different effects: one for when a new resource was being loaded and display, and one for when the current resource was being refreshed after a complex server action. I want to define the fetch function independently of the effect for better isolation of concerns.

But as written, this breaks. It breaks because as soon as we pass in the variable `cancel` as an argument to `fetchToken`, `cancel` becomes a declared variable in `fetchToken`'s bag. It's a completely separate variable to the one in the outer bag of the effect function.

Let's illustrate.

<div style="display: flex; flex-direction: row; justify-content: space-between; width: 100%; margin-bottom: 0.5em;">
{% include post_image.html name="closure-1.png" width="500px" alt="Effect function uses cancel in the outer scope" title="Outer scope"%}
{% include post_image.html name="closure-2.png" width="500px" alt="Effect function uses cancel in its owns scope" title="Inner scope"%}
</div>

Rounded rectangles represent scope boundaries that help understand what a given closure has access to. In the image on the right, the name `cancel` takes on new meaning inside the `fetchToken` function. Thus reassigning that variable name to a new value outside that function does not affect the value of the named variable inside.

To fix this, I we can pass in an Object where `cancel` is a field. Reassigning `fetchState` would have the same non-effect, but modifying its data is a different story. Both references to `fetchState` point to the same data -- the same copy of the `cancel` field.

```js
function Child(props) {
  const [token, setToken] = useState(null);

  useEffect(() => {
    const fetchState = {cancel: false};
    fetchToken(fetchState);
    return () => {fetchState.cancel = true;};
  }, [])

  async function fetchToken(fetchState) {
    const token = Math.floor(Math.random() * 100);
    const returnToken = await new Promise(r => {
      setTimeout(() => r(token), 2000)
    });
    if (fetchState.cancel) { return; }
    setToken(returnToken);
  }

  return (
    <div>Your token: {token === null ? 'loading...' : token}</div>
  );
}
```

Testing this out, it works beautifully. (Add in a `console.log` in the cancel check to convince yourself).

{% include post_image.html name="closure-ref.png" width="475px" alt="Fetch function uses reference to cancel boolean" title="Reference"%}

Here, the `cancel` value is illustrated as a lavender ellipse as it is not a named variable that either closure has direct access to. Instead it is a value (field) that both versions of `fetchState` point to. I actually rather like this solution better since it allows separation of the fetch function from the effect function's scope, making it far more reusable and testable.

Until AbortControllers come onto the scene in a more stable way, that's all, folks!
