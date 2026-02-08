---
title: "Using Middleware to serve views in Rails"
description: "Exploring the basics of Rack middleware in order to respond with static HTML"
date: 2021-04-23 04:53:00 -0400
tags: [rails, rack, middleware, html]
---

## Motivation

This will be a two or three part series (I haven't decided yet). The end goal is to take some code I have written up to provide a swanky UI to [FactoryBot](https://github.com/thoughtbot/factory_bot) for easy manual testing and wrap it up in a gem. In order to do so, I need to take the controllers and views that server this UI out of my Rails application's domain. To do this, we're reaching for middleware!

## Middlewhat?

I won't go into depth, as there are plenty of other resources that do.  [Here](https://blog.engineyard.com/understanding-rack-apps-and-middleware)'s a short intro to get you started. In brief, your application's middleware is a chain of smaller apps that handle incoming requests and outbound responses. Requests coming to your Rails application first go through this chain from the outside in, and responses get sent back out the same chain from the inside out.

With both incoming requests and outbound responses, any piece of middleware can

* Pass the message through without doing anything
* Modify the message (e.g. inject customer headers in a response)
* Respond directly without passing the message any further along the chain.

To serve our special view code from outside the application, we're going to build middleware that we hook up to a specific route and do the last of these; we will respond with our own rendered HTML without passing the request any further.

Rack middleware, like any Rack application, is a Ruby object that responds to `call`. It must accept an environment Hash parameter and respond with an array of status code, response headers, response body. We'll focus on building classes with a `call` method. We also need our class to be initialized with a single parameter, `app`, which represents the next piece of middleware in the chain.

## Step 0: Middlware to inject a custom header

Just to get our feet wet, we'll write middleware that will do nothing but add a custom header to the outbound response.

```ruby
class RackHeader
  def initialize(app)
    @app = app
  end

  def call(env)
    code, headers, response = @app.call(env)
    headers["X-Rack"] = "yes"
    return code, headers, response
  end
end
```

That's it. The `call` method does three things, which you can read line by line. It passes the request down the chain by calling `@app.call`. It adds a custom header `"X-Rack"` to the response. It returns the modified response back up the chain.

Save this in `lib/middleware/rack_header.rb` and add the following to `config/application.rb` to start using this awesome middleware immediately:

```ruby
module App
  class Application < Rails::Application
    ...
    require Rails.root.join("lib/middleware/rack_header")
    config.middleware.use RackHeader
    ...
  end
end
```

If you want a scratch Rails application to play with, try `rails new --api`.

Start up `rails s` then view the new header using `curl --head localhost:3000`. It should return something like

```
HTTP/1.1 200 OK
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
X-Content-Type-Options: nosniff
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
Referrer-Policy: strict-origin-when-cross-origin
Content-Type: text/html; charset=utf-8
Vary: Accept
X-Rack: yes    ## <----- there it is!
ETag: W/"efd313e7ac2d030c7948716f0e0d7d05"
Cache-Control: max-age=0, private, must-revalidate
X-Request-Id: 3117dce3-6535-4a18-8f1c-519c637d8184
X-Runtime: 0.005260
```

Let's go one step further just to poke at that `env` object a little bit. We'll only add the header if we have set a "rack-header" param.

```ruby
class RackHeader
  def initialize(app)
    @app = app
  end

  def call(env)
    code, headers, response = @app.call(env)
    req = Rack::Request.new(env)
    headers["X-Rack"] = "yes" if req.params.key?("rack-header")
    return code, headers, response
  end
end
```

Now, if you use `curl --head "localhost:3000?rack-header" | grep X-Rack` you'll see our header. If you omit the param, `curl --head "localhost:3000?rack-header" | grep X-Rack`, you'll see nothing.

## Step 1: Basic middleware to respond with html

Responding with basic HTML is easy enough. Create `lib/a_big_stick/a_big_stick.rb`:

```rb
class ABigStick
  URL = "http://www.abigstick.com"

  def initialize(_app = nil)
    # we're not gonna use it
  end

  def call(env)
    return code, response_header, response_body
  end

  def response_header
    {"Content-Type" => "text/html"}
  end

  def response_body
    ["<html><body><a href='#{URL}'>A Big Stick</a></body></html"]
  end
end
```

Add into `config/application.rb`:

```ruby
    require Rails.root.join("lib/a_big_stick/a_big_stick")
    config.middleware.use ABigStick
```

`rails restart` and point your browser at [http://localhost:3000](http://localhost:3000). Cool!

## Step 2: Serving separate files

Let's separate our view code from our middleware.

`lib/a_big_stick/a_big_stick.rb`

```ruby
class ABigStick
  URL = "http://www.abigstick.com"

  def initialize(_app = nil)
    # we're not gonna use it
  end

  def call(env)
    return 200, response_header, response_body
  end

  def response_header
    {"Content-Type" => "text/html"}
  end

  def view_root
    @root ||= Pathname(__dir__).expand_path.join('assets')
  end

  def response_body
    [File.read(view_root.join("index.html"))]
  end
end
```

`lib/a_big_stick/assets/index.html`

```html
<html>
<body>
  <a href="http://www.abigstick.com">A BIG Stick</a>
</body>
</html>
```

You can, of course, use `ERB` to start adding dynamic templating to your view. However, we're going in a different direction. But we're going to focus on static content, and how to start linking multiple files together.

## Step 3: Serving linked static assets

Notice how we had to dynamically generate the path to our view template. This might start to get tricky as we start to include our own javascript or css files. Luckily, we have some pre-built middleware to do this for us: [`Rack::Static`](https://www.rubydoc.info/gems/rack/Rack/Static).

`lib/a_big_stick/a_big_stick.rb`

```ruby
class ABigStick
  def initialize(_app = nil)
    # we're not gonna use it
  end

  def call(env)
    static_app.call(env)
  end

  def static_app
    Rack::Static.new(nil, static_options)
  end

  def static_options
    {urls: [""], root: view_root, index: 'index.html'}
  end

  def view_root
    @root ||= Pathname(__dir__).expand_path.join('assets')
  end
end
```

`lib/a_big_stick/assets/index.html`

```html
<html>
<head>
  <link rel="stylesheet" href="index.css"></link>
</head>
<body>
  Let's go to
  <a class="linky" href="http://www.abigstick.com">A big Stick</a>
  right now
</body>
</html>
```

`lib/a_big_stick/assets/index.css`

```css
.linky {
  border: 2px solid #222;
  border-radius: 5px;
}

.linky:hover {
  box-shadow: 1px 1px 3px #2226;
}
```

Restart and go to [http://localhost:3000](http://localhost:3000), and you've got linked static assets. Easy peasy, a little cheesy.

## Routing

Of course we don't want to actually replace our entire Rails app with this intercepted page. Instead, we want to route specific requests to this asset, but allow the app to run as normal. If you've used Resque, Flipper, or other similar gems that have their own dashboard or server, you'll have seen how this is often done. Add the following to your `config/routes.rb` file:

```ruby
mount ABigStick.new, at: "/abigstick", as: "abigstick"
```

Remove `config.middleware.use ABigStick` from your `config/application.rb` file so that it doesn't intercept all requests. We can now delete the no-op `initialize` method in `ABigStick` since we control its lifecycle with `ABigStick.new` here. For completeness, our final Rack app (not really fair to call it middleware anymore) will look like this:

```ruby
class ABigStick
  def call(env)
    static_app.call(env)
  end

  def static_app
    Rack::Static.new(nil, static_options)
  end

  def static_options
    {urls: [""], root: view_root, index: 'index.html'}
  end

  def view_root
    @root ||= Pathname(__dir__).expand_path.join('assets')
  end
end
```

Restart the server, then:

* [http://localhost:3000](http://localhost:3000) will serve your regular Rails app
* [http://localhost:3000/abigstick](http://localhost:3000/abigstick) will bring us to our new Rack app!

## Summing up

We've got all the pieces we need now to build a killer gem that comes with its own front-end interface.

* We reviewed how Rails is just a Rack application
* We saw how a simple Rack application simply needs to respond to `call` with a certain spec
* We built Rack applications that could function as middleware or their own apps
* In 17 lines of Ruby and 18 lines of unnecessary html and css, we used `Rack::Static` to serve arbitrary static files at a known location.

Moving forward, we'll build a real app into a Gem that uses these above learnings to server its UI at any arbitrary mounted location in a Rails application.
