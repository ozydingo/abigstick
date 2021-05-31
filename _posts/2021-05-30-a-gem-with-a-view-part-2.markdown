---
layout: post
title: "Publishing a Ruby Gem with a React-based front end"
description: "Using Rack middleware in a Gem to serve assets from a React build"
date: 2021-05-30 08:43:00 -0400
comments: true
tags: [rails, rack, ruby, gem, rubygems, middleware, html]
---

## Motivation

As stated in the [last post](/2021/04/23/a-gem-with-a-view.html), our goal package up a front end interface for [FactoryBot](https://github.com/thoughtbot/factory_bot) and distribute the functionality as a Ruby Gem. This post will take what we've learned and build that gem. We'll leave the details of the FactoryBot hackery for another post; here we'll focus on getting the Gem built and published so that its front and back ends are correctly hooked up to any application that wishes to use it.

## Quick Recap

We left off last time with one html, one javascript, and one css file being served together using `Rack::Static`. We did this by creating our own Rack app / middleware that could be mounted in a Rails app simply with

```ruby
mount ABigStick.new, at: "/abigstick", as: "abigstick"
```

The basics of the `ABigStick` app looked like this:

```ruby
class ABigStick
  def call(env)
    static_app.call(env)
  end

  def static_app
    Rack::Static.new(nil, static_options)
  end

  # ...
end
```

We'll build on this, serving the full output of a `create-react-app` build instead of a simple html file. This presents a few challenges we'll have to address; read on! We'll also add routes to back-end features, requiring a slightly more nuanced Rack app than our initial example.

## Project Structure

There are a few parts to keep track of, so it might help to see the project structure from the beginning. Without defending this choice at all, I'm calling the gem "factory_burgers", so here we go:

```
factory_burgers
├── Gemfile
├── factory_burgers-ui
│   └── # source code for UI assets (React / jsx)
├── factory_burgers.gemspec
├── lib
│   ├── assets
│   |   └── # build output from factory_burgers-ui
│   ├── factory_burgers
│   |   └── # source code for gem (ruby), including models and mmiddleware
│   └── factory_burgers.rb
├── spec
│   └── # tests
└── test_apps
    └── # example rails apps that use the gem
```

This is simplified, of course. To see more, [check it out](https://github.com/ozydingo/factory_burgers) on Github.

## The Front End

The source code for the front-end assets are in the `factory_burgers-ui` folder. As a quick note on iteration, I started by running [`create-react-app`](https://reactjs.org/docs/create-a-new-react-app.html) inside that folder, and iterated toward replacing the stock assets with source files from my already app-resident React code. I'm not going to dive into the code or components themselves, since that's not the point of this post. Instead, I'll just make a few notes on a couple tweaks required to make this work.

#### Homepage

`create-react-app` is built for a standalone app, and by default will generate links to assets at the server root (e.g. `<script src=/my_file.js />`). This won't work for us because that request will get handled by Rails, which will not match it to our gem's middleware, and we'll just get a `404: Not Found`. To fix this, we need to tell `create-react-app` to use relative links, preserving path the gem middleware is mounted at. We can do this by adding the following our `factory_burgers-ui/package.json` file:

```json
  "homepage": "./"
```

#### Copying Build Assets

A typical developer user of this gem should not have use our static asset build process. In fact, short of forking the repo, they have no need for the React source code at all. So we will not include the `factory_burgers-ui` folder for distribution. Instead, we will copy the build assets into `lib/assets` by adding this to our `package.json`:

```json
    "build": "react-scripts build && cp -r build/* ../lib/assets"
```

This way, every build will dump the assets to a git-managed location we can distribute and reference from our middleware.

## The Middleware

Using the middleware we started out with, we can get our unnecessarily shiny front-end up and running. But that's not the whole game; we still need a connection to the back end. Specifically, we need to do two things:

1. Get a list of available FactoryBot factories along with their properties to display to the user.
2. Submit requests to our app to build resources using those factories.

The code to actually do these things is out of scope for this post, abstracted away behind a `FactoryBurgers` module that might be the subject of another post. We simply need to use this module in our middleware, and set up routes to our server that allow the front end to make these requests.

We still don't want to make usage any more complicated than

```ruby
  mount FactoryBurgers::App, at: "/factory_burgers", as: "factory_burgers"
```

so we'll use Rack's `map` feature to handle specific routes nested under `/factory_burgers`. To do this, instead of a simple Rack app with a `call` method, we'll use [`Rack::Builder`](https://www.rubydoc.info/gems/rack/Rack/Builder).

Without further ado, `lib/factory_burgers/app.rb`:

```ruby
module FactoryBurgers
  App = Rack::Builder.new do
    map("/data") { run Middleware::Data.new }
    map("/build") { run Middleware::Build.new }
    run Middleware::Static.new
  end
end
```

Requests to `/factory_burgers/*` are handled by this app. This app, in turn, will match `/factory_burgers/data` and `/factory_burgers/data` and pass those requests to instance of `Middleware::Data` and `Middleware::Build`, respectively. If the request matches neither, including the index page and all assets linked to from that page, the request is handled by `Middleware::Static`. Perfect.

#### `Middleware::Static`

`Middleware::Static` is basically the same as the app we defined in our last post.

```ruby
module FactoryBurgers
  module Middleware
    class Static
      def call(env)
        return slashpath_redirect(env["REQUEST_PATH"]) if slashpath_redirect?(env)

        rack_static.call(env)
      end

      def rack_static
        Rack::Static.new(nil, static_options)
      end

      def static_options
        {urls: [""], root: asset_path, index: 'index.html'}
      end

      def asset_path
        @asset_path ||= FactoryBurgers.root.join("assets/")
      end
    end
  end
end
```

Like before, we're configuring our `Rack::Static` instead to server assets from `asset_path`, but this time we're abstracting part of that definition to the top-level `FactoryBurgers` module

```ruby
module FactoryBurgers
  class << self
    def root
      @root ||= Pathname(__dir__).expand_path
    end
  end
end
```

Now what's up with `slashpath_redirect`?

This method is here to address an issue with our `Rack::Statis` approach. Specifically, if an end user navigates to `<DOMAIN>/factory_burgers/`, everything is hunky-dory. But if the user navigates to `<DOMAMIN/factory_burgers` (without the trailing slash), the relative paths we worked so briefly to set up will not work because the browser does not interpret `factory_burgers` as a directory. Therefore, we redirect such requests to `<DOMAIN>/factory_burgers/`:

```ruby
  def slashpath_redirect?(env)
    # Only check for a trailing slash if this request is to the mount location.
    env["REQUEST_PATH"] == env["SCRIPT_NAME"] && env["REQUEST_PATH"][-1] != "/"
  end

  # Append `/` to the path and redirect
  def slashpath_redirect(path)
    return [
      302,
      {'Location' => "#{path}/", 'Content-Type' => 'text/html', 'Content-Length' => '0'},
      [],
    ]
  end
```

There's probably a better way to do this.

2. `Middleware::Data`

The purpose of this middleware is to provide the initial list of factories to the front-end. The behavior will be nicely abstracted away behind `FactoryBurgers` modules and classes, so we can focus for now only on the Rack interaction

```ruby
module FactoryBurgers
  module Middleware
    class Data
      def call(*)
        factories = FactoryBurgers::Introspection.factories.sort_by(&:name)
        factory_data = factories.map { |factory| factory_data(factory) }
        return [200, {"Content-Type" => "application/json"}, [JSON.dump(factory_data)]]
      end

      def factory_data(factory)
        FactoryBurgers::Models::Factory.new(factory).to_h
      end
    end
  end
end
```

Nothing crazy going on here. Our back-end code has a method that collects a list of factories (`FactoryBurgers::Introspection.factories`) and a class that maps these objects into data required by the front-end (`FactoryBurgers::Models::Factory.new(factory).to_h`). We request this from the front end using `fetch("./data")`, and use the response to build the form.

3. `Middleware::Build`

This one gets a little more complicated, and we won't dive into the specifics of the UI options to build custom objects using our factories, nor the error handling. For now, let's just see this as an example of how to parameters in a Rack app via `Rack::Request#params`. This is done in our `paramters` method, which is called from `build`, which is in turn called from the main `call` method.

```ruby
module FactoryBurgers
  module Middleware
    class Build
      def call(env)
        resource = build(env)
        object_data = FactoryBurgers::Models::FactoryOutput.new(resource).data
        response_data = {ok: true, data: object_data}
        return [200, {"Content-Type" => "application/json"}, [JSON.dump(response_data)]]
      rescue StandardError => err
        log_error(err)
        return [500, {"Content-Type" => "application/json"}, [JSON.dump({ok: false, error: err.message})]]
      end

      def build(env)
        params = paramters(env)
        factory = params.fetch("factory")
        traits = params["traits"]&.keys
        attributes = attribute_overrides(params["attributes"])
        return FactoryBurgers::Builder.new.build(factory, traits, attributes)
      end

      def paramters(env)
        request(env).params
      end

      def request(env)
        Rack::Request.new(env)
      end

      # ...
    end
  end
end
```

We can use request parameters in `build`, and we construct the response body as JSON using `FactoryBurgers::Models::FactoryOutput`. The details on the other side of that wall will be the subject of another post.

## The Gem

All that's left is to bundle this up as a gem! There's really nothing here you can't get by reading the [rubygems guide](https://guides.rubygems.org/make-your-own-gem/), but I'll just show that which is relevant to this project setup. Here's our `factory-brugers.gemspec` file:

```ruby
require File.expand_path('./lib/factory_burgers/version')

Gem::Specification.new do |s|
  s.name        = 'factory_burgers'
  s.version     = FactoryBurgers::VERSION
  # ... all thue standard stuff ...
  s.files       = Dir["lib/**/*"]

  s.add_dependency "factory_bot", ">= 4"
  s.add_dependency "rack", ">= 1"

  s.add_development_dependency "activerecord", ">= 4"
  s.add_development_dependency "sqlite3"
  # ...
end
```

Our development dependencies include `acctiverecord` and `sqlite3`, just enough to build functional ActiveRecord models that can be built with factories for our test harness.

To build the gem, the usual rules apply: `gem build factory-brugers.gemspec`, `gem push factory_burgers-x.y.z.gem`. Since we're coordinating a Ruby gem and a Javascript React app, we're going one step further and providing a [`Makefile`](https://github.com/ozydingo/factory_burgers/blob/main/Makefile) that coordinates the asset build, Javascript linting, Ruby linting, and test suite as dependencies of building the gem and pushing it to rubygems.org.

## Summing up

* We put our front end build source in a distribution-hidden folder and copy the  build output into `lib`.
* We needed a couple minor tweaks to a standard `create-react-app` build process to make this work as a mounted app served by Rails.
* We constructed our Rack app using `Rack::Builder` to define a couple nested routes to handle non-static back-end requests at `/<MOUNT_PATH>/data` and `/<MOUNT_PATH>/build`
* We built separate apps to handle these non-static requests, using parameters that can be obtained from `env` and calling back-end code from ouur gem.
* We built and published the gem using standard tooling, including a Makefile to help keep everything built correctly.

In the next post, we'll go over the guts of `FactoryBurgers`, since there's a lot of cool stuff in there to allow `FactoryBot` to work will in a non-automated-test environment.
