---
layout: post
title: "More Fun With Enumerators: Nesting enumeration in a pixel marquee"
date: 2018-11-24 00:00:00 -0400
comments: true
tags: [Ruby]
---

<small>Skip to the [detail](#detail)</small>

## TL;DR

Cementing our mastery of enumerators in Ruby in a simple example that uses one enumeration method within another.

Here, we create a `Marquee` class. This class is given a string and loops over columns of pixels to display on a display such as a an LED marquee. We use a `Font` class, which for this illustration simply needs to have a `height` method (in pixels) and a `get(letter)` method that returns a matrix of pixel values for a given letter (assuming a fixed font size).

Note: we're not including `Enumerable` in this class. The `yield` and the `Enumerator` returned by `enum_for` is all the magic we need.

```ruby
class Marquee
  class Options
    attr_accessor :letter_spacing, :tab_spacing
    def initialize
      @letter_spacing = 1
      @tab_spacing = 4
    end
  end

  def initialize(string, font, options = Marquee::Options.new)
    @options = options
    @string = string
    @font = font
    @string.length > 0 or raise ArgumentError, "Must provide non-zero length string"
  end

  def each_column(&blk)
    return enum_for(:each_column) unless block_given?
    each_letter do |letter|
      if letter == "\t"
        yield_tab_spacing(&blk)
      else
        columns = @font.get(letter).transpose
        yield_letter_columns(columns, &blk)
        yield_letter_spacing(&blk)
      end
    end
  end

  def each_letter
    return enum_for(:each_letter) unless block_given?
    loop do
      @string.each_char do |letter|
        yield letter
      end
      yield "\t"
    end
  end

  private

  def yield_letter_columns(columns)
    columns.each do |column|
      yield column
    end
  end

  def yield_letter_spacing
    @options.letter_spacing.times do
      yield [0] * @font.height
    end
  end

  def yield_tab_spacing
    @options.tab_spacing.times do
      yield [0] * @font.height
    end
  end

end
```
---

<a name="detail" id="detail"></a>

## Enumerators and Enumerables

I've gone over `Enumerator`s and the `Enumerable` module in a [previous post](/2017/10/16/paginated-enumerator.html). In brief, `Enumerator`s are the heart of Ruby's awesome looping constructs, from `each` to `each_cons`, `select`, `take_while`, and so on. Many of these more advanced methods are defined by the `Enumerable` module, which is included in classes you know and love such as `Array` and `Hash`.

Here, we're not going to use `Enumerable`. We're keeping it completely barebones to really understand the heart of Ruby enumeration. We'll define two enumeration methods which will allow us to loop over (1) letters or (2) pixel columns of a string. To do this, we simply need to define a loop for each use case that will `yield` the desired values in order or return an `Enumerator` if no block is given. We'll go over how each of these return values are used.

## Marquee

The high-level spec of our `Marquee` class is as follows. We will initialize a `Marquee` object with a string to display and a `Font` object that will tell us how to translate letters into pixels. Don't worry about the `Font` class; suffice it to say that `font.get('a')` returns a matrix of pixel values for the `a` character.

`marquee.each_column` will give us the ability to loop over one column of pixels at a time to send to a display device. That's all we really need. But it's going to be very useful, and informative, to factor out of this high-level operation an `each_letter` enumerator, which simply loops over letter of the string before doing an font / pixel conversion.

## each_letter

Let's build the `each_letter` method first: this method can be independently testable and will be used for `each_column`.

```ruby
class Marquee
  ...
  def each_letter
    return enum_for(:each_letter) unless block_given?
    loop do
      @string.each_char do |letter|
        yield letter
      end
      yield "\t"
    end
  end
  ...
end
```

Let's break this first method down into three pieces, and really dive deep.

First is the `each_char` loop with `yield letter`. This loops over each character of `@string`, yielding one letter at a time. `yield` passes its argument, `letter`, to the block given when calling `each_letter`, allowing you to write `marquee.each_letter{|letter| ... }`.

Next, we have a quick `yield "\t"`. After the `each_char` loop passes over the string, we `yield` a tab character so we can add spacing between the phrases. This is just one of many ways to implement this feature, but a good illustration of how we can arrange multiple calls to `yield` inside the main loop.

Finally, we have the `enum_for` return line. This is what allows us to chain enumerators and their methods, such as `marquee.each_letter.first(15)`. In this call, no block is given to `each_letter`, and thus `yield` would fail. Instead we return an `Enumerator`, which has methods such as `first` that provide a block of their own definition.

```ruby
marquee = Marquee.new("hello", nil) # ignore font for now
marquee.each_letter.first(12)
# => ["h", "e", "l", "l", "o", "\t", "h", "e", "l", "l", "o", "\t"]
```

What about chaining enumerators? You got it:

```ruby
marquee.each_letter.each_cons(2).first(4)
# => [["h", "e"], ["e", "l"], ["l", "l"], ["l", "o"]]
marquee.each_letter.lazy.reject{|letter| letter == 'e'}.each_cons(2).first(4)
# => [["h", "l"], ["l", "l"], ["l", "o"], ["o", "\t"]]
```

(Notice we had to throw in a `lazy` on that last line, otherwise `reject` would loop through ALL values given be the enumerator. Since we repeat ths string, this would loop infinitely. Lazy enumerators allow methods such as `select` and `reject` to be evaluated only on the final result that is needed.)

## each_column

Now that we can easily loop over the letters, let's loop over the pixel columns.

```ruby
class Marquee
  ...
  def each_column(&blk)
    return enum_for(:each_column) unless block_given?
    each_letter do |letter|
      if letter == "\t"
        yield_tab_spacing(&blk)
      else
        columns = @font.get(letter).transpose
        yield_letter_columns(columns, &blk)
        yield_letter_spacing(&blk)
      end
    end
  end
  ...
  private

  def yield_letter_columns(columns)
    columns.each do |column|
      yield column
    end
  end

  def yield_letter_spacing
    @options.letter_spacing.times do
      yield [0] * @font.height
    end
  end

  def yield_tab_spacing
    @options.tab_spacing.times do
      yield [0] * @font.height
    end
  end

end
```

Let's break it down.

First, we have the same `enum_for` return as we did before. Same deal.

Next, we call `each_letter`. Having defined this enumerating method, we can now simply use it as an abstraction here. We'll loop, repeatedly, over each letter, being able to do something for each next letter. Sweet!

So what do we do with each letter? First, if it's a tab character, we call `yield_tab_spacing`, passing it the block that `each_column` was called with. This simply yields a column of zeros to that block.

Hang on, why are we passing this block again? It's worth making sure we understand this fully. The `&` syntax is Ruby's way of handling the block when it's not an explicit argument to the method. When you call an enumeration method, you or eventually some end code (e.g. the `first` method) will pass a block to this code. By passing that block, whatever it is, to `yield_tab_spacing`, those `yield`ed zeros will get passed in as arguments to the block. So when you say

```ruby
marquee.each_column do |column|
  activate_lights(column)
end
```

we have given `each_column` the block `{|col| activate_lights(col)}`. So when this gets to this tab character, the `yield_tab_spacing` methods gets invoked, passing the values `[0] * @font.height` into this very block and into `activate_lights`.

Great! Moving on. For every other letter, we (1) get the letter pixel matrix from the `Font` object, (2) yield the letter columns, a method that works structurally just like `yield_tab_spacing`, then finally (3) yield the letter spacing, which in this case is a single column of zeros in between each letter. Again, a rather simple set of constructs where we mix together a few different `yield` statements within our main loop from `each_letter`. Each yield statement is placed so that we get the correct sequence of pixel columns.

## The result

```ruby
pp marquee.each_column.first(20).transpose
[[1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
 [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
 [1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0],
 [1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0],
 [1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0]]
```

What, you can't immediately read that? It says "hello" damnit!

Anyway, that's it! This was a pretty detailed dive, so let's bubble back up. All we've really done is defined an arbitrary method, and in there we make up a control flow that calls `yield` for each pixel column, in order, one at a time. That plus the `return enum_for(...)` line is all we need to define as complex of an Enumerator as we want! And now we understand many of the details of implementing enumeration in Ruby, so next time we want to come up with anything from a simple to a clever way to loop through a set of data, we'll be ready.
