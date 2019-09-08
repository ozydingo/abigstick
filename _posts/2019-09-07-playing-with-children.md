---
layout: post
title: "Playing With Children"
description: "Using templates for repeating components in React"
date: 2019-09-07 08:46:00 -0400
comments: true
tags: [react, javascript]
---

In this post, we're going to design a React component that will repeat a basic template with a list of data. We'll explore various methods of generating this template as a means of better understanding React concepts, in particular those having to do with components' children.

We're using CSS-in-JS via [aphrodite](https://github.com/Khan/aphrodite) for styling because in my view it better encompasses a component mentality to design. That means methods of styling our children by providing sting class names is right out.

<iframe src="https://codesandbox.io/embed/hardcore-chebyshev-5pl9t?fontsize=14&hidenavigation=1&module=%2Fsrc%2FMessageList.js" title="abigstick-playing-with-children-basic" style="width:100%; height:500px; border:0; border-radius: 4px; overflow:hidden; "></iframe>

Ok, cool. But what if we wanted to be able to customize the message styles? Well, we could easily define a `variant` prop for some preconfigured options such as `error`, `info`, `light`, etc. We'd defined various classes in our `styles` const, and switch on the value of `props.variant`. But that would make for a boring post, wouldn't it?

Instead, let's go full hog and allow `MessageList` to take in a template. How do we specify this template? Well, we're using React, aren't we? Let's just pass in some JSX!
