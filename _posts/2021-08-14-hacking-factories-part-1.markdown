---
layout: post
title: "Hacking FactoryBot to build a factory UI"
description: "Part 1: The main guts of the FactoryBurgers gem"
date: 2021-08-14 10:00:00 -0400
comments: true
tags: [rails, rspec, factory_bot, ruby, gem, rubygems]
---

## Motivation

As stated in the [last last post](/2021/04/23/a-gem-with-a-view.html), our goal package up a front end interface for [FactoryBot](https://github.com/thoughtbot/factory_bot) and distribute the functionality as a Ruby Gem. In the [last post]() we built the gem, leaving the details of the FactoryBot ~hacks~ hooks as a black box. Today we open that box. We'll find a fair amount of guessing and hackery in order to do what we want to with FactoryBot. It's gonna be fun!

## Quick Recap

When we left off, we had just built a gem that could be installed in a Rails app to provide a UI to FactoryBot simply by using

```ruby
mount FactoryBurgers::App, at: "/factory_burgers", as: "factory_burgers"
```

A user could then go to `localhost:3000/factory_burgers` (for a standard `rails s` startup) to view and use the UI. We didn't go over what the UI looked like or how the back end works. This post will focus on the back end, but let's start from the UI to make things easier to follow from the user perspective.

## A Sneak Peek at the UI

When a user navigates to `/factory_burgers`, they'll be greeted with a form:

{% include post_image.html name="form.png" width="700px" alt="Form with factories in a datalist dropdown" title="form"%}

This form allows the user to select from a list of FactoryBot factories to create an object. Once selected, the form dynamically creates checkboxes for each registered trait as well as model attributes.

{% include post_image.html name="traits_and_attributes.png" width="700px" alt="Form with trait checkboxes and attribute fields" title="traits_and_attributes"%}

The selections above are the UI equivalent of writing

```rb
FactoryBot.create :post, :long, title: "test_post_1"
```

Once the user hits "Gimme", the object is created and displayed. But we're not done! Now we go deeper. Using ActiveRecord introspection, we find the associations defined on the model (here, `Post`), then find the factories that are capable of building any of those associations, and allow the user to build out associated objects to the `Post` instance we just created.

{% include post_image.html name="object1.png" width="700px" alt="Object card representing the requested and built object" title="object1"%}

As the user builds out additional objects, they can select and of the objects already ordered to build out additional associations. When we're all done, we can have a look at everything we've done.

{% include post_image.html name="full_order.png" width="700px" alt="Object cards with all objects built" title="full_order"%}

So now that you have the User Journey, we'll spend the rest of this post going over

* How to use these factories in a non-test environment
* How to list all of the factories
* How to discover and expose traits, attributes, associations, and factories for these associations
* How to get around some issues when using FactoryBot outside a immediate tear-down test db environment (*cough* uniqueness validations *cough*).
* How to allow customization of the display such as you see above: different models display different summary attributes and can even have links to your application's show pages for these resources.

We won't cover the UI (React with very cool animations, thank you very much) or the controllers / middleware that connects the two. Most of the latter was covered in the last post.

## The Back End

### Prerequisites

The first prerequisite is to make sure you have FactoryBot enabled in your development environment. So make sure `factory_bot` is in your Gemfile and included in at least the `:development` (or equivalent) group and not just `:test`.

Next, we need to load the registered factories; we don't get this for free. But in Factory Bot 6.x, we can do this as easily as

```rb
def load_factories
  FactoryBot.reload
end
```

We'll call this from an initialization script, `init.rb`

```rb
require Pathname(__dir__).join("factory_bot_adapter.rb")

begin
  require "factory_bot"
rescue LoadError
  raise LoadError, "Could not load factory_bot. Please make sure it is installed."
end

FactoryBurgers::FactoryBotAdapter.load_factories
```

Here, `factory_bot_adapter` is a ~premature~ optimistic architecture for allowing this gem to work with different versions of FactoryBot that may have different APIs. To that end, many of the floating methods you see defined here are, in the [full codebase](https://github.com/ozydingo/factory_burgers), defined in version-specific adapters such as `FactoryBurger::FactoryBotAdapter::FactoryBotV6`

## Listing Factories

Once we have the above, getting a list of factories is simply

```rb
def factories
  FactoryBot::Internal.factories
end
```

The return value is an Array of `FactoryBot::Factory` objects. That's no good to pass to our front end, so we'll create our own data class that can wrap a `FactoryBot::Factory` for use in our gem. This class will give us some attribute methods that our middleware can use to pass to the front-end. As we've seen, we also want to know what attributes and traits we can use on the factory, so you'll also see the `traits` and `attributes` methods.

```rb
module FactoryBurgers
  module Models
    class Factory
      attr_reader :factory

      def initialize(factory)
        @factory = factory
      end

      def to_h
        {
          name: name,
          class_name: class_name,
          traits: traits.map(&:to_h),
          attributes: attributes.map(&:to_h),
        }
      end

      def to_json(*opts, &blk)
        to_h.to_json(*opts, &blk)
      end

      def name
        factory.name.to_s
      end

      def class_name
        build_class.base_class.name
      end

      def traits
        defined_traits.map { |trait| Trait.new(trait) }
      end

      def attributes
        settable_columns.map { |col| Attribute.new(col) }
      end

      private

      def build_class
        factory.build_class
      end

      def settable_columns
        factory.build_class.columns.reject { |col| col.name == build_class.primary_key }
      end

      def defined_traits
        factory.definition.defined_traits
      end
    end
  end
end
```

We're using our own data class for factories, and we'll use our own data class for traits and attributes. This way, the middleware can call a set of methods that does not depend on the specific FactoryBot or ActiveRecord version implementation of any of these data.

For attributes, we use `factory.build_class` to get the ActiveRecord class, then call `columns` to get its list of columns. Finally, we reject the primary key, since we don't want to allow the user to specify that in the UI. We wrap each column objecct in our own class:

```rb
module FactoryBurgers
  module Models
    class Attribute
      attr_reader :column

      def initialize(column)
        @column = column
      end

      def to_h
        {name: name}
      end

      def to_json(*opts, &blk)
        to_h.to_json(*opts, &blk)
      end

      def name
        column.name
      end
    end
  end
end
```

And for traits, we use `factory.definition.defined_traits`, where `factory` is a `FactoryBot::Factory`, and the return value is an array of `FactoryBot::Trait`s.

```rb
module FactoryBurgers
  module Models
    class Trait
      attr_reader :trait

      def initialize(trait)
        @trait = trait
      end

      def to_h
        {name: name}
      end

      def to_json(*opts, &blk)
        to_h.to_json(*opts, &blk)
      end

      def name
        trait.name
      end
    end
  end
end
```

Both of these are very basic classes whose single responsibility is to encapsulate factory, trait, and attribute information in a manner our middleware can reliable consume.

An example of what these classes give us:

```rb
pp FactoryBurgers::Models::Factory.new(factory).to_h

{:name=>"post",
 :class_name=>"Post",
 :traits=>[{:name=>"long"}, {:name=>"very_long"}],
 :attributes=>
  [{:name=>"created_at"},
   {:name=>"updated_at"},
   {:name=>"author_id"},
   {:name=>"title"},
   {:name=>"body"}]}
```

These data maps directly into the form inputs that are place on the page when the user selects the "post" factory.

Just to close the loop, when the form gets submitted with factory, traits, and attribute data, we can use FactoryBot to build the requested object using `FactoryBurgers::Builder#build`:

```rb
def build(factory, traits, attributes)
  FactoryBot.create(factory, *traits, attributes)
end
```

This simply maps the data we parse and pass from the middleware to the `create` call you're likely already familiar with. If you're used to seeing `create` called without an explicit reference to `FactoryBot`, that's because you have some setup (such as `spec_helper.rb` in rspec) that defines these methods in your test's execution context. We don't have and don't wan't that, so we'll just call the method on `FactoryBot` explicitly.

### Customization

The next cool thing we'll build into the gem is the ability to customize what information we display for each built object. It could quickly become overwhelming to see all attributes of an object, and which attributes are the most usefuil summary is application and use-case specific.

Out strategy will be to use presenters. We'll construct a presenter base class that application developers can subclass, exactly as Rails provides the base class `ActiveRecord::Base` that can be subclassed. We'll require application developers to register their presenters using one of two forms:

1. Reference the presenter class explicitly

    ```rb
    FactoryBurgers::Presenters.present "User", with: FactoryBurgers::Presenters::UserPresenter
    ```

2. Use an anonymous presenter defined inline

    ```rb
    FactoryBurgers::Presenters.present("Post") do
      attributes do |post|
        {
          id: post.id,
          author_id: post.author_id,
          word_ccount: post.body.split(/\s+/).count,
        }
      end

      link_path { |post| Rails.application.routes.url_helpers.post_path(post) }
    end
    ```

Let's start with the base class. Pay attention to two methods, `attributes` and `link_path`. These methods we will expect developers to override in their subclasses to provide information about what attributes to display, and what if any link to their application to show with the object.

```rb
module FactoryBurgers
  module Presenters
    class Base
      class << self
        def presents(name)
          define_method(name) { object }
        end
      end

      attr_reader :object

      def initialize(object)
        @object = object
      end

      def type
        object.class.name
      end

      def attributes
        object.attributes.slice("id", "name")
      end

      def link_path
        nil
      end
    end
  end
end
```

Above, we referenced `FactoryBurgers::Presenters::UserPresenter`. In our test app, this looks like the following, overriding `attributes` and `link_path` as we've described above.

```rb
class FactoryBurgers::Presenters::UserPresenter < FactoryBurgers::Presenters::Base
  presents :user

  def attributes
    {
      id: user.id,
      name: user.full_name,
      login: user.login,
      email: user.email,
    }
  end

  def link_path
    Rails.application.routes.url_helpers.user_path(user)
  end
end
```

When we put

```rb
FactoryBurgers::Presenters.present "User", with: FactoryBurgers::Presenters::UserPresenter
```

in our Rails application initializers (`/config/initializers/factory_burgers.rb`), `FactoryBurgers` is now aware of this presenter, and will use it to display any `User` object.

{% include post_image.html name="user.png" width="250px" alt="Card with user attributes and an external linke" title="user object"%}

Notice the link icon? That uses the `link_path` method we defined. Nice.

We also showed an anonymous presenter using `FactoryBurgers::Presenters.present("Post") do ... end`. How does this work? First, let's look at the `present` method.

```rb
def present(klass, with: nil, &blk)
  presenter = with || build_presenter(klass, &blk)
  @presenters[klass.to_s] = presenter
end
```

As you can see, if we provide a block instead of a `with` argument, we use the `build_presenter` method. Let's look at that.

```rb
def build_presenter(klass, &blk)
  PresenterBuilder.new(klass).build(&blk)
end
```

and


```rb
module FactoryBurgers
  # The PresenterBuilder is resposible for building anonymous subclasses of
  # FactoryBurgers::Presenters::Base when FactoryBurgers::Presenters.present is
  # called with a block. The block is evaluated in the context of a
  # FactoryBurgers::PresenterBuilder instance, which understands the DSL.
  class PresenterBuilder < BasicObject
    def initialize(klass)
      @presenter = ::Class.new(::FactoryBurgers::Presenters::Base)
      @klass = klass
    end

    def build(&blk)
      instance_eval(&blk)
      return @presenter
    end

    def presents(name)
      @presetner.presents(name)
    end

    def type(&blk)
      @presenter.define_method(:type) do
        blk.call(object)
      end
    end

    def attributes(&blk)
      @presenter.define_method(:attributes) do
        blk.call(object)
      end
    end

    def link_path(&blk)
      @presenter.define_method(:link_path) do
        blk.call(object)
      end
    end
  end
end
```

If this is a little too much meta-programming for you, don't worry, it suffices to unuderstand the explicit presenter subclass use case. In brief, we use a class that creates a new anonymous subclass of `FactoryBurgers::Presenters::Base`

```rb
@presenter = ::Class.new(::FactoryBurgers::Presenters::Base)
```

It then executes the block passed to `presents`, providing definitions for `attributes` and `link_path` that define the corresponding methods on this new class using `define_method`. Ruby is pretty awesome.

### Headaches

Building this gem, I encountered one major headache that threatened to render the gem unusable. When you use FactoryBot, you often define sequences. For example, if you have a uniqueness validation on `users.email`, you might define a sequence `user_email` so that your first user created gets `somebody1@aol.com` and the next user gets `somebody2@aol.com`, and so on, so that your calls to `create` don't blow up for violating uniqueness.

The problem is that these sequences do not persist their state across server requests. In a test suite, you don't have to worry about server requests, and your sequences work as expected. In development, when you send one request that calls `FactoryBot.create :user`, then send another request from another browser click, the sequence starts from scratch and it blows up.

I came up with a quick and dirty solution, then a better but more manual solution. First, the quick and dirty:

```rb
def build(factory, traits, attributes)
  resource = insistently do
    FactoryBot.create(factory, *traits, attributes)
  end
  return resource
end

def insistently(tries = 30)
  tries.times do |attempt|
    return yield
  rescue ActiveRecord::RecordInvalid
    raise if attempt >= tries - 1
  end
end
```

Basically, if you get a invalid record, just try again. The sequence will increment by one, and eventually you'll get a valid record. Yeah, dirty.

There's a craftier solution, but it's a bit involved and so will be the subject of a separate post.
