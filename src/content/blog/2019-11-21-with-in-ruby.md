---
title: "Building Python's 'with' in Ruby"
description: "Replicating a neat feature of another language"
date: 2019-11-21 07:24:00 -0400
tags: [ruby, python]
---

One of the features I really dig in Python is the `with` keyword.

```python
with open("path/to/file" as fp):
  do_something(fp)
```

When the block exits, the file pointer `fp` is guaranteed to be closed. More specifically, python's `with` keyword will call `__enter__()` on the object it is given, execute the nested block of code, then call `__exit__()` on the object even if an exception occurs. This saves a lot of leaky file pointer code and is pretty similar to a similar pattern implemented in Ruby:

```ruby
File.open("/path/to/file") do |fp|
  do_something(fp)
end
```

The biggest difference is that `with` is built into the Python language, while block execution with guaranteed cleanup like the `File.open` example has to be implemented by each library or method that wants to use it.

I seem to have a thing for [building constructs in other languages in Ruby](/2018/10/11/abnstract-interface-in-ruby), so what would it look like to bring a generalized version of this into Ruby?

Right off the bat, let's agree that `__enter__` and `__exit__` are very pythonic names (so-called "[dunder](https://www.geeksforgeeks.org/dunder-magic-methods-python/)" methods). We'll use `open` and `close` in the Ruby world, inspired by the `File` example.

The minimal version of this `File` example would actually only have a `close` method:

```ruby
module With
  module_function

  def [](object)
    yield(object)
  ensure
    object.close
  end
end
```

Used as

```ruby
With[File.open("/path/to/file")] do |fp|
  do_something(fp)
end
```

The `ensure` block is the key here, making sure that `close` is called on the object given to the `[]` method. In this case, `File.open` is used in its non-block form, which is how you'd get leaky file pointers. But our `With[]` block takes care of it. But now with this `With` module, you automatically get this safe-exit block functionality with *any* object that has a `close` method.

I've gone with the `[]` method here, which won out in my opinion over the following alternatives:

* Define `with` as a method on `Kernel`. This is brandishing our big stick too loudly. Since `with` is *not* a protected keyword in Ruby and a very common word in English, it's reasonable to assume many other classes and modules have a `with` method that would override ours in some contexts, and what gives us the right to claim the method name `with` that globally?
* Define a more readable method name, such as `block`, to be used as `With.block(...) { do_something }`. For the purpose I find it unnecessarily verbose. The `[]` method is reasonably the only thing that thie `With` module will ever want defined.
* Make `With` a class and define a method (see the preceding point) or put the functionality in the constructor, as in `With.new(...) { do_something }`. I still find this verbose and don't love the idea of the instance instantiation for every such exsecution.

So, `[]` it is!

This may be a sufficient implementation for most use cases. However it's missing one or two things especially if you prefer a little sanity checking. Let's add (1) calling the `open` method, and (2) raising a sensible error if the object doesn't have the right methods.

```ruby
module With
  module_function

  def [](object)
    raise ArgumentError "Object for `With` must respond to `close`" if !object.respond_to(:close)
    object.open if object.respond_to(:open) &&
      (!object.respond_to(:open?) || !object.open?)
    yield(object)
  ensure
    object.close
  end
end
```

Though I've made my [feelings about duck typing](/2016/04.18) known, and they haven't changed, this seems like the only sensible solution for our method.

Here, we're only checking if `object` has the `close` method, because that's the base requirement for it making any sense to use `With`. If your object doesn't have an `open` method, no problem. If it is already open and can tell us that be responding to `open?`, we won't try to open it again.

Lastly, it's worth exploring making this slightly more flexible by adding an option to use a method other than `close`.

```ruby
module With
  module_function

  def [](object, open: :open, close: :close, is_open: :open?)
    raise ArgumentError "Object for `With` must respond to `close`" if !object.respond_to(close)
    object.public_send(open) if open &&
      object.respond_to(open) &&
      !(is_open && object.respond_to(is_open) && object.public_send(is_open))
    yield(object)
  ensure
    object.public_send(close) if close
  end
end
```

The wording is slightly confusing, but for each method `open`, `close`, and `is_open`, we've added a check that it has a value other than `nil` or `false` (allowing the caller to forcibly skip them using `open: nil`, for example), and use `public_send` to call them methods by the chosen names (which default to the names we used above).

```ruby
With[temp_record, open: nil, close: :destroy!] do |record|
end
```

Though, to be honest, I think this is getting a little over-engineered and prefer the first version in this post for its simplicity. It's not that hard to re-write the `ensure` block if you want to use this idea with another kind of object.

And that's it.
