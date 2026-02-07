---
title: "GraphQL == REST"
description: "Prove me wrong"
date: 2019-09-29 14:05:00 -0400
tags: [GraphQL, REST, hot-takes]
---

I was going to write a post about creating a Javascript GraphQL client from scratch.

But as I started looking into standard methods for doing what I wanted to build, I started to realize how much of it was completely unnecessary with the concepts including persisted queries and operation documents. If you don't know what these are, it's not important right now. The point is that when looking into these things and if my awesome Javascript GraphQL client was generally useful, I realized that these things made it, well, not.

And that's when it hit me. Adopting these GraphQL patterns simultaneously makes GraphQL cleaner and more efficient, and makes it REST.

## GraphQL > REST

Disclaimer. I'm not an expert in the finer nuances of REST. If you are, excellent! Tell me how I'm wrong in the comments, I'm sure I am. But I, like many others, have shunned REST for being not well matched to most of the functionality I've ever wanted to implement as a developer. You know, the old "we're writing apps, not documents" idea, like [here](https://www.freecodecamp.org/news/rest-apis-are-rest-in-peace-apis-long-live-graphql-d412e559d8e4/).

And, look, I do loveAnd don't get me wrong. GraphQL is still my go-to for defining a client-server API. Everyone's allowed a little doublethink, right? I can believe both that [GraphQL > REST](https://www.howtographql.com/basics/1-graphql-is-the-better-rest/) and [GraphQL == REST](#).

I love GraphQL. It's the best! It's also REST.

## Creating a GraphQL Client

Let me try to convince you by walking briskly through an onboarding to GraphQL. This is coming from the perspective that GraphQL is simple and I want to build up an understanding from the ground up. There are out-of-the-box clients out there. Frankly, the simple ones don't convince me that they even add any value. Then there are bigger beasts. Relay? Apollo? I'm not ready for that kind of commitment.

See, your first GraphQL query is love at first sight, and doesn't care about any of these things.

```
query { widget(id: 123) { id, type, user { id, name }}}
```

Your data layer is pulled out of messy controllers. You can specify whatever fields you want as long as you've defined your query schema, which is really easy to do. You can specific whatever data you want from your schema in the same request. Ok pretty basic GraphQL, but it still makes me feel all warm and fuzzy.

So now you build this into a Javascript front end.

```js
function widgetQuery(id) {
  return `query { widget(id: ${id}) { id, type, user { id, name } } }`
}
```

Ok immediate a new-to-graphql developer might be seeing some red flags. GraphQL injection? Well, sure, but a malicious user could send that query with or without your help. Still, graphql.org [advises against](https://graphql.org/graphql-js/passing-arguments/) constructing the query string this way. There are other reasons that we won't get into. Suffice it to say you're intrigued. GraphQL variables. Static strings.

Let's add one more query corresponding to another resource in our schema while we're at it.

```js
// Static strings!
const widgetQuery = 'query($id: ID!) { widget(id: $id) { id, type, user { id, name } } }';
const boxQuery = 'query($id: ID!) { box(id: $id) { size, location { name, long, lat } } }';

// Constructing request data that a GraphQL controller will understand.
const widgetReqData = {
  query: widgetQuery,
  variables: {id: 123}
};
const boxQuery = {
  query: messagesQuery,
  variables: {id: 42}
};

request(url, widgetReqData);
request(url, boxQuery);
```

But you don't have to make those two queries separately. And if your component wants to combine these two responses, you could just as well structure the query as

```
query($widgetId: ID!, $boxId: ID!) {
  widget(id: $widgetId) { ... },
  box(id: $boxId) { ... },
}
```

Notice that we needed to give the variables slightly more specific names.

## Building Queries

Permit me my one digression, for this is where I started going off the beaten path. My first instinct was to create each of these inner query strings as static constants and build a method to construct the whole thing, variables and all.

```js
function requestData({type, fields, variableTypes, variables}) {
  const varDeclaration = variableTypes && (
    '(' + Object.keys(
      variableTypes
    ).map(name =>
      `$${name}: ${variableTypes[name]}`
    ).join(', ') + ')'
  );
  return {
    query: `${type}${varDeclaration || ''} {${fields}}`,
    variables: JSON.stringify(variables),
  }
}

const widgetFields = 'widget { id, type, user { id, name } }';

console.log(requestData({
  type: 'query',
  fields: widgetFields,
  variableTypes: {id: "ID!"},
  variables: {id: 123}
}));
```

Outputs:

```text
{
  query: 'query($id: ID!) {id, type, user { id, name } }',
  variables: '{"id":123}'
}
```

Neat! But we have a challenge in adding the second query. We need to make sure the variable names don't conflict. And our goal is to do this with a general module, not just constructing the queries by hand as I did above.

So we're going to use a class called `QueryBuilder`. It will keep track of the queries and variables that you add in, and it will rename variables to ensure no collision.

Bear with me or just skip ahead. This is going to get ugly.

```js
class QueryBuilder {
  constructor() {
    this.query = '';
    this.variables = {};
    this.variableTypes = {};
    this.variableIndex = 0;
  }

  // Outputs fully-formed request data for HTTP request.
  // Call this when you're done adding queries.
  requestData() {
    return {
      query: `query ${this.declaredVariables()} { ${this.query} }`,
      variables: JSON.stringify(this.variables),
    }
  }

  // Call this to add the widget query
  widget({ id }, fields) {
    const vars = {
      id: this.declare("id", "ID!", id)
    };
    this.query += `widget ${this.args(vars)} { ${fields} } `;
  }

  // Call this to add the box query
  box({ id }, fields) {
    const vars = {
      fileId: this.declare("id", "ID!", id)
    };
    this.query += `box ${this.args(vars)} { ${fields} } `;
  }

  // --- Internal helper methods --- //

  // Declare a new variable and its type with a specific value.
  // Append '_NUMBER' to each variable name, where NUMBER auto0-increments
  // to guarantee uniqueness
  declare(name, type, value) {
    if (value === undefined) { return; }

    const uniqueName = `${name}_${this.variableIndex}`;
    this.variableTypes[uniqueName] = type;
    this.variables[uniqueName] = value;
    this.variableIndex = this.variableIndex + 1
    return uniqueName;
  }

  // Helper method to remove undefined keys in an Object
  removeUndefined(queryVariables) {
    const keys = Object.keys(queryVariables).filter(key =>
      queryVariables.hasOwnProperty(key) && queryVariables[key] !== undefined
    )
    return Object.fromEntries(keys.map(key => [key, queryVariables[key]]));
  }

  // Construct a list of declared variable types for the entire operation
  // e.g. `"($fileId: ID!, $name: String)"`
  declaredVariables() {
    if (Object.keys(this.variables).length === 0) { return ''; }
    return '(' +
      Object.keys(this.variables).filter(key =>
        this.variables.hasOwnProperty(key)
      ).map(key =>
        `$${key}: ${this.variableTypes[key]}`
      ).join(', ') + ')';
  }

  // Construct a list of args for a single queried field
  // e.g. `"(id: $fileId, name: $name)"`
  args(queryVariables) {
    const values = this.removeUndefined(queryVariables);
    return '(' +
      Object.keys(values).filter(key =>
        values.hasOwnProperty(key)
      ).map(key =>
        `${key}: $${queryVariables[key]}`
      ).join(', ') + ')';
  }
}
```

Yes, the `widget` and `box` methods should be extracted out into a user of the more general `QueryBuilder` class, but I didn't get there, and that's the point of this article.

Let's just see this in action so far.

```js
const builder = new QueryBuilder();

builder.widget({id: 123}, 'id, type, user { id, name }');
builder.box({id: 42}, 'size, location { name, long, lat }');

console.log(builder.requestData());
```

Outputs

```text
{
  query: 'query ($id_0: ID!, $id_1: ID!) { widget (id: $id_0) { id, type, user { id, name } } box (fileId: $id_1) { size, location { name, long, lat } } }  }',
  variables: '{"id_0":123,"id_1":42}'
}
```

Cool, I guess. Right? Variable names are unique-ified. It's flexible enough to let you add in whichever queries you want with whatever fields and variables you'd like.

Hey, what's that smell?

## GraphQL Documents

See, this isn't really how it's done. I've gone and added a horrendously more complicated developer API to use our GraphQL API, and am still left with interpolating strings on the client side.

For development, it's frankly far easier to just build the string by hand than to use my obtuse `QueryBuilder`. In a stable, production app, you've landed on a stable set of queries and operations you want your client to perform, and you don't need to construct them dynamically like this.

For example, we built the following query:

```
'query ($id_0: ID!, $id_1: ID!) { widget (id: $id_0) { id, type, user { id, name } } box (fileId: $id_1) { size, location { name, long, lat } } }  }'
```

So I should just store that query somewhere. Why use all this `QueryBuilder` nonsense?

Enter GraphQL documents and persisted queries. Your static query strings get stored server-side and can be referenced by name or id. Less data transferred in each request, yay! This also makes implementing cached requests easier as each operation is pre-defined and often repeated, keyed only by a smaller set of variables.

So, in sum, we've solidified our GraphQL API by adding:

1. Pre-defined operation names stored on the server. "Routes", if you will.
2. Fixed data shapes for each operation. Let's call these "resources."
3. A small set of client-specified variables, or "parameters" for each resource.
4. Cacheable resources for improved performance.

Sounds a lot like REST.

## I don't GET it

Ok, but so far I've only described read operations. The "R" in C<b>R</b>UD. The GET in the pointless mess that is http verbs. What about the other resource lifecycle operations, <b>C</b>reate, <b>E</b>dit, and <b>D</b>elete? What about the PUTs and the POSTs and the DELETEs?

Wait, which of these are technically part of REST again?

In GraphQL, anything remotely described by the above would be implemented by a GraphQL mutation. Some mutations (let's say `renameWidget` or `deleteWidget`) might be simply mapped to update or delete actions. But I'm going to blow past all that and call all operations create actions. Just like before, we store all of our mutation query strings on the server. The client simply has to name which operation it wants to perform. So your `assignWidgetToBoxMutation` mutation is simply asking the server to *create* an instance of that mutation. And it does. How it persists that data, what side effects it has, and whether or not you can directly *read* the same resource back is up to the server.

Realistically, the same is true for any server action no matter what methodology itt claims to follow. Sure, you just issued a standard update request for your widget, but the server created a transaction record, updated your user record for logged in time, modified your update due to business logic, and spun up a background job to recompute your widget optimization.

## GraphQL >= REST

Let's take a step back. Try not to panic or chop my head off. I like my head. I am, in fact, being a little esoteric, which is perhaps a little funny from a self-professed REST-apathist. I still love GraphQL. It makes you structure your API more sensibly, encouraging you right from the start to dissociate your API operations (aka "resources") definitions from your back-end models (aka "resources") by building a layer in between them with a well-defined schema. This is whaat happens to any reasonably non-trivial web app trying to use REST-style controllers anyway. GraphQL gives that process structure, makes it easy to develop, and is just damn pleasant to work with.

But once the honeymoon is over, you realize that all you really need now is a little REST.
