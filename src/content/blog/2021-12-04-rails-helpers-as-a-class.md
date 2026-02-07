---
title: "Rails helpers as a class"
description: "How to use Rails' helper methods useable outside of ActionView"
date: 2021-12-04 21:09:00 -0400
tags: [rails, ruby, OOP]
---

## Retrospective preempt

Just use `ApplicationController.helpers`. This returns an object that has all standard Rails view helpers, which is the goal of this post.

Still, the learnings and journey are worth documenting, so let's keep going.

## Rails helpers

Rails has some really useful helpers. You can access these in a Rails console using `helper`:

```rb
helper.sanitize("<script>alert('hello')</script>Totally innocent")
# => "alert('hello')Totally innocent"
helper.number_to_currency(1.234)
# => "$1.23"
```

Generally speaking, you'll use these in views. That's why Rails put them in view helpers. But run an app long enough, and you'll find places you need these elsewhere. Maybe you have another with another service or API and need to use the sanitization or other helpers in a back-end task. Maybe you're building static assets that aren't presented by Rails views.

When such needs have come up, I've seen folks take the path of the Dark Side and simply include the needed helpers in ActiveRecord models or other classes. For example, `include ActionView::Helpers::NumberHelper`. This is a poster violation of "composition over inheritance" and the Single Responsibility Principle, and is generally asking for namespace collisions as you just pile more and more mixins into your model.

## The helper modules

The problem is that these really useful helper methods are defined in modules, such as `ActionView::Helpers::NumberHelper` and `ActionView::Helpers::SanitizeHelper`. The methods are instance methods, so are available to any class that includes them, but cannot be called directly. So let's roll up our OOP sleeves and talk about a few ways to expose these methods!

### Method 1: Define a class that includes the helper

For each helper module, we'll define a class that does nothing but include the module

```rb
class SanitizeHelper
  include ActionView::Helpers::SanitizeHelper
end

SanitizeHelper.new.sanitize("<script>alert('hello')</script>Totally innocent")

# => "alert('hello')Totally innocent"
```

Done and done.

But that `new` is bugging me. We can do better.

### Method 2: create a module function that extends the helper

Tip: this method doesn't work reliable

I'd like to be able to ditch `new` and simply call `SanitizeHelper.sanitize(...)`. This looks like a module function pattern, so let's try that. First I'll do it with an example that works:

```rb
module TextHelper
  # Make instance_methods of ActionView::Helpers::TextHelper into
  # class methods of TextHelper
  extend ActionView::Helpers::TextHelper
end

TextHelper.pluralize(2, "iotum")
=> "2 iota"
```

But there's a catch:

```rb
module SanitizeHelper
  extend ActionView::Helpers::SanitizeHelper
end

SanitizeHelper.sanitize("<script>alert('hello')</script>Totally innocent")
# NoMethodError (undefined method `safe_list_sanitizer' for Module:Class)
```

This error occured because the implementation of `sanitize` calls `self.class.safe_list_sanitizer`. In a View, `self.class` is the `ActionView::Base` subclass, so this is fine. In a module function, `self.class` is the class `Module`. Oops.

```rb
def sanitize(html, options = {})
  self.class.safe_list_sanitizer.sanitize(html, options)&.html_safe
end
```

So we've hit a wall with module functions. Next!

### Method 3: Delegating singletons

We'll combine the two approaches, and use a class that has class methods that simply call the equivalent method on an instance. By doing this, we get the convenience of a class method, but we don't break with the underlying implementation expects there to be a class.

This sounds like a Singleton pattern, so we'll use that too. If you're not familiar with Ruby's Singleton, you could replace `instance` with `new` and the effect would be the same.

If you're not familiar with `delegate`, `delegate :method1, to: :method2` is the same as

```rb
def method1
  method2.method1
end
```

So here's our delegating singleton:

```rb
class SanitizeHelper
  include Singleton
  include ActionView::Helpers::SanitizeHelper

  # Explicitly delegate known methods to the instance as class methods.
  class << self
    delegate :sanitize, to: :instance
    delegate :sanitize_css, to: :instance
    delegate :strip_tags, to: :instance
    delegate :strip_links, to: :instance
  end
end

SanitizeHelper.sanitize("<script>alert('hello')</script>Totally innocent")
# => "alert('hello')Totally innocent"
```

Sweet. Two notes:

1. We could use `method_missing` instead of a list of delegations, but I hate `method_missing` for definitions that should be known ahead of time. It's lazy, and doesn't let you easily discover what methods are defined.
2. We do still want to follow this pattern a lot, once for every helper we want to wrap. Let's use some more explicit metaprogramming!

### Method 4: Metaprogrammed delegating singletons

Yummy word salad!

To avoid writing out the list of delegations, which is on the one hand a convenient source of documentation and on the other both annoying and brittle if the underlying helper module changes, we'll use Rails' sweet metaprogramming and introspection abilities. We'll use `instance_methods` to read the list of public methods from the module we're wrapping, and dynamically call `delegate` for each.

```rb
class SanitizeHelper
  include Singleton
  include(ActionView::Helpers::SanitizeHelper)

  class << self
    ActionView::Helpers::SanitizeHelper.instance_methods.each do |method|
      delegate method, to: :instance
    end
  end
end

SanitizeHelper.sanitize("<script>alert('hello')</script>Totally innocent")
# => "alert('hello')Totally innocent"
```

### Method 5: Metaprogrammed delegating singleton base class

Our word salad grows.

It's not as bad as it sounds. All this method does above the previous is generalize what we did with `ActionView::Helpers::SanitizeHelper` to any helper or module we want to wrap in this manner.

As a quick note, while I don't dive into this in depth: we need to call `delegate` on the `singleton_class` (not to be confused with the `Singleton` module) so that the delegated method is available as a class method. In the above examples we did this when we opened it with `class << self`. Here, since we need to call `delegate` *inside a method*, `self` now refers to the instance (actually the instance of the singleton class, which is the class). So we need to explicitly go back to the singleton class to use `delegate` for a class method rather than an instance method.

```rb
class RailsHelperAsAClass
  include Singleton

  class << self
    def wraps(helper)
      # Inside a method in the singleton class, this is the same
      # as calling `include` in the class itself.
      include(helper)

      helper.instance_methods.each do |method|
        # We want to call `delegate` on the singleton class, not
        # the class itself. Since we're inside a method, we need
        # to go back to the singleton_class.
        self.singleton_class.delegate method, to: :instance
      end
    end
  end
end

class SanitizeHelper < RailsHelperAsAClass
  wraps ActionView::Helpers::SanitizeHelper
end

class TextHelper < RailsHelperAsAClass
  wraps ActionView::Helpers::TextHelper
end

SanitizeHelper.sanitize("<script>alert('hello')</script>Totally innocent")
# => "alert('hello')Totally innocent"
TextHelper.pluralize(2, "iotum")
# => "2 iota"
```

### Method 6: RTFM

```rb
ApplicationController.helpers.sanitize("<script>alert('hello')</script>Totally innocent")
# => "alert('hello')Totally innocent"
```

## Warpping up

In this post, we build wrappers around ActionView helpers to isolate them for reuse. We built an easy way to do this for an arbitrary helper module using the `RailsHelperAsAClass` base class. Then we discovered that we have access to a class instance with all of these methods anyway, so we should probably just use that. Still, we had fun, didn't we?
