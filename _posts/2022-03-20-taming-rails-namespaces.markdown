---
layout: post
title: "Taming Rails Namespaces"
description: "What to do when you application outgrows your framework"
date: 2022-03-20 10:18:00 -0400
comments: true
tags: [rails, organization, patterns]
---

([Skip to the tl;dr](#the-final-recommendation): how do I organize my large Rails app?)

## The Problem

A codebase I work on has long outgrown the standard Rails scaffolding framework. What do I mean by this? I mean that Rails comes with some strong opinions about where to put starter code such as the well known `app/models`, `app/controllers`, `app/views`. It also has a heavily [[1](https://medium.com/extreme-programming/what-goes-in-rails-lib-92c74dfd955e)] contested [[2](https://codeclimate.com/blog/what-code-goes-in-the-lib-directory/)] `lib` [[3](https://devblast.com/b/rails-app-vs-lib)] folder [[4](https://dockyard.com/blog/ruby/2012/02/14/love-your-lib-directory)] that no one can seem to agree on "proper" usage. Without additional design patterns, many apps simply grow within this structure until you have a situation like I am seeing:

- 473 top-level files in `app/models`
- 47 subfolders of `app/models`, most of which have been added to Rail's auto-load paths
  - Some of these folders serve as _both_ Rails namespaces _and_ autoload paths, a situation that has led to many hard-to-discover bugs in development.
- 173 top-level files in `lib` and 52 subfolders, again a combination of namespaces and autoload paths

Understanding that our codebase is a proud monolith with no inttentions of microservicing, the major downsides of this sprawl include:

- Uncertainty where to place additional code
  - This lead to default “easy” choices such as bloating models or putting a new file at the top-level of `lib` – a self-reinforcing positive feedback loop of sprawl!
  - In some cases this even led to defining global, top-level functions and consts in rake files because there was no better place to put them.
  - Bloated models (or worse, controllers) are difficult to test, difficult to refactor and maintain, and lead to functional and performance-related bugs.
- Poor discoverability, which further fuels the feedback loop above.
- Namespace collision and confusion. The worst example of this was `app/models/statistic.rb`, defining the const `Statistic`, which actually was a very specific use-case model for one subfeature.

## Sisyphus’s code: leading by example

Over the years we've opportunistically tidied a few things up, optimistic that we'd clean the oceans eventually. But without a concerted effort, feature development outpaces cleanup.  It was a Sisyphean task, and the problem continues and grows faster than it is solved.

## A better approach

The rest of this piece is going to be opinionated. If you don't want opinionated, keep organizing your files how you like and this post isn't for you. But we'll start with a few core tenets

- *Organize* business logic by high-level “feature”
  - This increases discoverability and limits how spread out feature changes need to be.
- *Separate* classes and methods that handle business logic from MVC code
  - This increases modularity, testability, and agility of our code.
- *Co-locate* related code files, including models, controllers, and business logic
  - This allows better focus on features you are working on with less file sprawl.
  - This differs a lot from Rails' default stance, which organizes code by code pattern rather than by feature. But as an application grows a wider feature base, Rails' approach does not keep up.

If you disagree or even have the slightest of reservations about these tenets, let's hear about it in the comments!

## What is a "feature"?

Naming things is hard. Here, I'm using "feature" o broadly describe a grouping of code / behavior / functitonality that related to a coherent conncept in your business domain. For example, a retailer might group code into `Advertsiing`, `Sales`, `Returns`, and `Promotions`. It's an art, and the level of granularity depends on the breadth of your application and business, and the needs of your developers.

This concept goes by other names, including "interest", "conern", "domain", and others.

## A quick refresher on Rails' const lookups

- Rails ships with a few default "autoload paths", including `app/models`, `app/controllers`, and others.
- You can configure additional [autoload paths](https://guides.rubyonrails.org/autoloading_and_reloading_constants.html) in `config/application.rb`
- Any folder under an autload path can be used to implicitly name a module used as a namespace.
  - For example, with no modification to your application configuration, a const `Foo::Bar` could be defined in `app/models/foo/bar.rb`.

## How to structure non-MVC business logic

I'm taking the position that `lib` will be used for code that's not directly concerned with your application; that's why it lives outside of `app`. This might include libraries that you write that could be extracted to gems, or could be used in entirely application-agnostic contexts. Following this scheme has encouraged me to write well-isolated and highly modular code.

I'm also taking it for granted that organizing code by design pattern, such as models, presenters, interactors, decorators, workers -- doesn't make a whole lot of sense, doesn't solve the sprawl problem, and requires you to wildly thrash your code locations around if you want to even think about modifying the design approach of a piece of code.

So where does our business logic go? We'll create a new folder, `app/features`, and we'll add this folder to our Rails application's autoload paths.

```rb
config.autoload_paths << "#{config.root}/app/features"
```

That way, `app/features/foo/bar.rb` easily defines the `Foo::Bar` class as a member of the `Foo` feature and namespace.

## Organizing the monolith

Using the above structure is great for obviously non-MVC code but doesn't solve the problems above such as a sprawling `models` folder that would make even the surest suburban planner raise their hands up in despair and move to a shack in the country.

The problem is that the more we dive into elements of an opnionated framework (ahem Rails), the more we have to work to make sure our system jives with the framework. For example:

- ActiveRecord models are backed by a table name corresponding to the model name
- Controllers for a model named baz are expected to be named bazs_controller
- View templates rendered by bazs_controller are expected to be in app/views/bazs/
- ActiveRecord associations auto-infer the class name
  - For example, belongs_to :qux will, by default, look for a class named Qux and expect a column named qux_id

These conventions can often be overridden. Doing so begins to violate one of Rails' core tenets: Convention over Configuration. This is a _very valuable_ tenet, but pragmatically it will flop when your use case is not well served by existing convention. Often, this is a code smell; Rails serves a lot of use cases! But for sake of argument we'll say we need to pivot. We will still fall back to another tenet that I’m going to make up just now:

> Don’t fight your framework.
>
>   ~ Me, just now.

The rest of this document will explore the ways in which we can pivot from Rails' original conventions to achieve our goals and how they rate on the “don’t fight your framework” scale.

## Components requires by our application

### Business Logic

As mentioned above, organizing business logic (referring to non-MVC code) using our own conventions is easy. This is because Rails, as opinionated as it is, has no opinions about business logic. So we simply add folders names by feature in `app/features`, such as `app/features/bar.rb` to define a class `Foo::Bar`.

- Framework-fighting score: 0 out of 10.

### Models

While Rails will place models in `app/models`, there’s nothing stopping you from defining them elsewhere, including in autoloaded namespaces. Many gems (at least responsible ones) do this. For example, [Flipper](https://github.com/jnunemaker/flipper) creates a model `Flipper::Adapters::ActiveRecord::Gate`, defining its table name to be `flipper_gates`. Similarly, we can define a model `Foo::Baz` by placing our file in `app/features/foo/baz.rb`. We could have also placed it in `app/models/foo/baz.rb`, but one of our tenets is co-locate related code.

* **Pro:** Models can be co-located with other feature-related code in the same domain
* **Con:** Increased verbosity for associations, requiring class specification: belongs_to :baz, class_name: "Foo:Baz"
* **Con:** Increased verbosity for polymorphic associations: resource_type == "Foo::Baz"
* **Con:** you can’t use Rails' default scaffolding generators. Well, I hate those things anyway.

I don't actually mind those cons at all.

- Framework fighting score: 2 out of 10.

#### Models: table name

By default, a model called `Foo::Baz` will be backed by a table called just `bazs`. Of course, this can lead to name conflicts with a different model `Quux::Baz`, which would also try to claim a table names bazs. The simplest solution to this is to avoid the exact same name, even across namespaces.

However, it’s worth exploring how we might namespace the tables as well. To do this, let's look at how Rails defines table names. For base classes (not STI) and models not nested inside other models, the table name will be defined as

```rb
  "#{full_table_name_prefix}#{undecorated_table_name(name)}#{full_table_name_suffix}"
```

([source](https://github.com/rails/rails/blob/af0733a8e7ceddf6b9128ad2aaf4f74c5b427c43/activerecord/lib/active_record/model_schema.rb#L618))

Digging in, `full_table_name_prefix` gives us

```rb
  def full_table_name_prefix #:nodoc:
    (module_parents.detect { |p| p.respond_to?(:table_name_prefix) } || self).table_name_prefix
  end
```

([source](https://github.com/rails/rails/blob/af0733a8e7ceddf6b9128ad2aaf4f74c5b427c43/activerecord/lib/active_record/model_schema.rb#L618))

This will return `table_name_prefix` for the first module parent that responds to that method. So if we simply define `table_name_prefix` on our `Foos` module, we’ll get prefixed tables! To do so, we need to define the `Foo` module explicitly at `app/features/foos.rb`. This is more scaffolding for developers to remember. But once defined, we can define a method

```rb
module Foo
  def self.table_name_prefix
    self.name.demodulize.tableize + "_"
  end
end
```

This gives us

```rb
Foo::Baz.table_name
# => "foos_bazs"
```

We can abstract this to a module, `FeatureModule`, that we extend in any feature module. This is slightly nicer but no less scaffolding for developers to remember when adding new top-level features. Can we abstract it more transparently?

We can’t really use ApplicationRecord, because this behavior exists on the parent module, not the ApplicationRecord class.

We could override full_table_name_prefix, but doing so would have to assume that the parent module is a feature module, and this might not be true always. So this is a bad solution.

A cleaner option could be to opt-in at the model level by defining a new class method on ApplicationRecord:

```rb
class ApplicationRecord < ActiveRecord::Base
  def self.use_feature_namespace_in_table_name
    extend FeatureNamespacedModel
  end
end

module FeatureNamespacedModel
  def full_table_name_prefix
    self.module_parent.name.demodulize.tableize + "_"
  end
end
```

You can then use this in your model:

```rb
module Foo
  class Baz < ApplicationRecord
    use_feature_namespace_in_table_name
  end
end
```

- Fighting your framework score: 3 out of 10

In my view, the extra “fighting your framework” point is not worth the questionable benefit of namespaced tables. My preference is to avoid even implicit name confusion by avoiding same-named models – violations of this will be caught very early when attempting to create a table with an already claimed name.

### Controllers

Namespacing controllers is perhaps easier than you might suspect. Rails provides a module argument to the scope block of its routes files that do exactly what we want. Note: we are not using the /foo path prefix; we’ll discuss that further down in Routes.

```rb
  # To add "/foo" to the URL, use `scope "foo", module: "foo", as: "foo"`
  scope module: "foo", as: "foo" do
    resources :bazs
  end
```

- Fighting your framework score: 0 out of 10.

Pushing further, we’ve expressed a desire to co-locate as many related code files by feature as possible. To avoid sprawl in app/controllers, we can place the file at app/features/foo/bazs_controller.rb

* **Pros:** co-locate controllers with feature code
* **Cons:** none I can think of

- Fighting your framework score: 1 out of 10.

### Views

View templates don’t really have modules in the same way as models and controllers do, but they do follow the same structure as models and controllers. However, the default expectation is still that view templates are located in `app/views`. Within this constraint, we can define `app/views/foo/bazs/index.html` and so on. This doesn’t achieve code co-location, but it is probably a reasonable compromise as views ought to be relatively simple templates and/or isolated from the back-end implementation. This applies especially true as more UI gets offloaded to statically-generated assets such as a React front-end.

- Fighting your framework score: 1 out of 10.

It is possible to modify the view search path, however, via `ActionController::Base#view_paths`. We can  override this on our base controller:

```rb
class ApplicationController < ActionController::Base
  self.view_paths =  [
    Rails.root.join("app/features"),
    *self.view_paths,
  ]
end
```

This causes Rails to render `Foo::BazsController#index` with `app/features/foo/bazs/index.html`. This is slightly confusing since the bazs folder does not by name imply it is a view concern. Trying to override the lookup name bazs leads down a rabbit hole that very clearly crosses the “don’t fight your framework” line.

The confusion of the function of foo/bazs as well as the likely confusion by a new Rails-familiar developer with this novel, custom, and implicit behavior tips the scales unfavorably.

- Fighting your framework score: 4 out of 10.

One last option would be use `app/features/views` instead of `app/features`. This is more similar to the first solution, in that the views are not co-located, but share a parallel structure. This is likely a better transition solution for a legacy application that already makes well-worn usage out of app/views.

- Fighting your framework score: 3 out of 10.

### Routes

Above, we’ve used Rails routing to achieve namespacing of our controller classes and view template locations. What about the url paths themselves? That is, do we want to serve `bazs` at http://example.com/bars or http://example.com/foos/bars? This now becomes a user-facing choice, and as such can’t be decided strictly technically. Someone get the PM on the phone! But either way Rails routing supports easily. As written above, simply add a path argument "/foo" to the scope in your routes file:

```rb
  scope "/foo", module: "foo", as: "foo" do
    resources :bazs
  end
```

- Fighting you framework score: 0 out of 10.
- Fighting your customers score: ??

### Less-strongly opinionated MVC support

Here, MVC support refers to constructs such as helpers and presenters – anything concerned with the MVC lifecycle but not an M, V, or. C proper. While Rails ships with a helpers folder, the namespacing of helpers and the method of including them in controllers or views is actively discouraged (by me) as it violates everything that makes “composition over inheritance” a good idea. Instead, we can use dedicated classes that can be categorized as helpers and presenters, and include them inside the same subject-area folders as our business logic. For example, we might define a `Foo::BazsPresenter` and `Foo::BazsHelper` in `app/features/foo/bazs_presenter.rb` and `app/features/foo/bazs_helper.rb`, respectively.

* **Pro:** Code related to the same concept is co-located
* **Con:** Business logic and presentation layer code are co-located

- Fighting your framework score: 0 out of 10. Bonus point for not using Rails' concept of helpers.

### Application-agnostic code

Application-agnostic code includes everything from custom-built string parsing functions to full-blown should-be-a-gem frameworks for profiling code, reporting metrics, running complex workflows, and so on. The key is that this code is application-agnostic – it doesn’t belong to the application core nor any of its features. This code rightfully belongs in the `lib` folder of a Rails application (or on rubygems.org) Note that we have used and abused `lib` as a combination of application agnostic code, pseudo-application-agnostic code, rake tasks, a nascent version of the app/features structure proposed here, and much more. For that reason, specific to our application or similar bloated legacy applications, a simple `lib2` for a fresh start can be used to maintain a clean namespace for new, truly application-agnostic code.

### Applicaiton base classes and core

Base classes and core refers to things like your base `ApplicationRecord` and `ApplicationController`, or graphql controller or base types, and other similar base classes and common across your app but sepcific to your app core behavior.

I like to put this in `app/core`, and add that as one more application autoload path. Add nested modules as you see fit, such as `app/core/graphql_types` to contain the somewhat large number of base classes and types you need to define for graphql.

## The final recommendation

- Core base classes go in `app/core`
  - This includes Rails-external core classes, such as a base GraphqlController, GraphqlSchema, GraphqlObject, and so on.
- Feature-related code goes in `app/features`
- Models (ActiveRecord, Mongo, GraphQL, and any others), controllers, business logic, and MVC support for a feature `Foo` goes in `app/features/foo`
- `View templates go in app/features/views/foo/:resource/:action`
- Application agnostic code goes in `lib` or `lib2`


- Total fighting you framework score: 2 out of 10. I feel good about this.
