---
title: "Abstract Interfaces in Ruby"
description: "Declare a method interface for Ruby classes"
date: 2018-10-11 21:30:00 -0400
tags: [Ruby, Java, OOP]
---
<small>Skip to [tl;dr](#tl-dr)</small>

## Defining a code contract

There are so many reasons I love Ruby more than Java. But there's one thing Java really gets so right, and it's the [Interface](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html). I like this pattern so much I had to write a pseudo-implementation of this for Ruby.

Using it looks like this:

```ruby
module Duck
  extend AbstractInterface

  # args: none
  # returns: (String message)
  implements :quack

  # args: (String, optional) destination
  implements :fly

  # args: none
  # returns: nil
  implements :eat_bread
end

class Mallard
  include Duck

  def quack
    "I QUACK LIKE A DUCK"
  end

  ...
end
```

By including this module, I am telling clients of my code that I have implemented the `quack`, `fly`, and `eat_bread` methods, implicitly in the context of being a duck. This is the concept of a "contract".

In Java, this contract is much more strict. If a class that implements the interface doesn't define one of the methods, you get a compile-time error. It's Java, so of course you need to specify the return type and the full list of arguments. Here you can see I've left that all out; the contract is on good faith and not strictly enforced, but suggested by the comments. That's ok, this is Ruby and we don't need to try to be Java. But we still get the benefits I most desire out of the concept of interfaces while retaining the flexibility Ruby guarantees you of being able to overrule any behavior you want to. As always, with great power comes great responsibly, so use it wisely and don't be a d*ck.

Enumerated, those benefits are:

1. Developer-friendly documentation. If I was new to a project and wanted to figure out what I need to do to implement my very own duck, I can just look in this interface. Clearly, I need to define these three methods as described. By doing so, my class will do everything any user of the Duck interface expects it to do.
2. Identification. I've already written about how much [I hate duck typing](/2016/04/18/duck.html). So here you can be much more explicit than `responds_to?(:quack)` and actually ask what you mean: `is_a?(Duck)`.
3. Dev-friendly error messaging. Look for the implementation below. If your `Mallard` class doesn't implement `quack` and someone tries to call it, you will get a `NoMethodError` with the message `Expected class Mallard to implements quack`.

On #3: This is a runtime error, not a compile-time error, because, again, this is Ruby. You'd expect to `include Duck` at the top of the class before the method is defined, and to allow that you cannot check if the method was defined on include. If you want to allow the method to be defined dynamically, which would be very ruby-ist of you, you can't check at app initialization either. And even if you did check and it passed, you could always [undefine](https://apidock.com/ruby/Module/undef_method) it later. In my opinion, it's better to work with your language's strengths: define the contract as a convention and expectation, but allow the developer to violate it if they really want.

<a id="tl-dr" name="tl-dr"></a>
## Implementation

It's pretty minimal:

```ruby
module AbstractInterface
  def implements(method_name)
    define_method(method_name) do |*args|
      if defined?(super)
        super(*args)
      else
        raise NoMethodError, "Expected #{self.class} to implement method #{__method__}"
      end
    end
  end
end
```

The `implements` instance method is the head of the duck line here. It takes the method name as an argument and defines a method with that name on the including class. "Wait, it defines the method?" you ask? Well, yes -- we're defining the method to raise our specific `NoMethodError` with our desired message. We could instead let it propagate all the way up to the default `NoMethodError`, but that would be harder to debug when received, and opens up the possibility that another definition of `method_missing` would get in our way. (This concern is also why I chose not to raise the error inside a `method_missing` definition, but it's certainly an option that would avoid the supermethod juggling).

The special `__method__` variable is Ruby's way of cheating and giving us the name of the current method, which lets us throw a more informative error message.

Ah, but if we're defining a method on the class itself, what if we're overriding the method defined in a superclass or included module? That why we check `if defined?(super)`, and call it if that check returns `true`. A performance hit on every call for sure, but a good way to keep in sync with any modules that may be included after this interface.

And that's it! Not a lot of code. Not a lot of functionality, either. But I've found it to be a great tool nonetheless, really helping to define expectations in larger, more complex projects.
