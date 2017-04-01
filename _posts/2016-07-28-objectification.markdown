---
layout: post
title: "objectification"
date: 2016-07-28 14:26:02 -0400
comments: true
categories: 
---

## Object Over-Orientation

```ruby
class Hash
  def transcript_sort
    self.sort { |a,b| a.first.to_i <=> b.first.to_i }
  end
end
```

What is this method doing? As its name correctly implies, its intended usage was to sort a transcript: specifically, a timed text transcript represented as a Hash with timestamps in the keys and words in the values.

So what's it doing on `Hash`?

Ignoring that it effectively does the same thing as the built-in Ruby [`Hash#sort`](http://ruby-doc.org/core-1.8.7/Hash.html#method-i-sort) (<2.0) or the equivalent method from [`Enumerable`](http://ruby-doc.org/core-2.2.2/Enumerable.html#method-i-sort) call edon `Hash` objects (>=2.0), this method shouldn't be here. This code forces every single instnace of `Hash` to be aware of this method called `trancsript_sort`, even if it hasn't two ducks about this "transcript" object.

`{x: 0, y: 1}.transcript_sort`. Sure.

Oh, but it's just one little simple method, what's the harm?

The following is a real-world example from the same code base. No need to parse the method too closely, but you do get bonus points for appreciating how `prepare_interpolation` and `finalize_interpolation` are methods that were inserted into `String` for similarly specific purposes.

```ruby
class Hash
  def split_words(paragraph_starts = [], no_break_up=false, max_word_length=32)
    new_words = {}
    sorted_words = self.transcript_sort
    add_blank = false
    sorted_words.each_with_index do |word, i|
      current_stamp = word.first.to_i
      parts = word.second.prepare_interpolation(no_break_up,max_word_length).split(' ')
      parts << "" if parts.empty?
      next_stamp = (sorted_words[i+1].try(:first) || (current_stamp + parts.length * 300)).to_i
      if parts.length == 1 && parts.first.blank?
        new_words[current_stamp] = '' if !!(add_blank || paragraph_starts.include?(current_stamp))
        add_blank = false
      else
        increment = ((next_stamp - current_stamp) / parts.length).floor
        for part in parts
          new_words[current_stamp] = part.finalize_interpolation
          current_stamp = current_stamp + increment
        end
        add_blank = !!(parts.last.editorial_note? or parts.last.end_of_sentence?(sorted_words[i+1].try(:second)))
      end
    end
    new_words
  end
end
```

###So what's the skinny on this fat model?

`transcript_sort` and these associated method apply only to a specific data object: the transcript as described above. It's not only confusing to other devs (especially new ones exploring objects new to them) to insert such methods into core Ruby classes, it's memory bloat and it's just begging for name conflicts. Import some code that also modifies `Hash`? Here's hoping they didn't choose any of the same method names as you. May the odds be ever in your favor. It's mixing concerns, it's not good for unit testing, and shoving various concerns' code into other classes increases the amount of code another developer needs to parse through to understand something completely unrelated to the task at hand.

The first thing I did to this code when I had a chance was to create a `Transcript` class that contained all the logic related to this transcript object. This class still stores the same data as the `Hash` version, but rather than assimilating `Hash`, it simply uses one as a data member. Ideally, we could have a `sort_words` method here that returned another `Transcript` object with the words sorted (or `sort_words!` for in-place). However, for compatiblilty with more code than I could change in one sitting, I created a `Transcript#sorted_words` method that returned the same array of [timestamp, words], sorted by timestamp.

```ruby
class Transcript
  def sorted_words
    @words.sort_by{|time, word| time.to_i}
  end


  # NIY in real life, but more ideal:
  def sort_words
    self.deep_dup.sort_words!
  end

  def sort_words!
    @words.sort_by!{|time, word| time.to_i}
    return self
  end
end
```

###Over-objectification

The concern-mixing, namespace-conflicting, method-fixing style of coding is a common anti-pattern I have begun to observe. It often comes from new developers or developer new to object-oriented programming or more comfortable with more purely [functional programming](https://en.wikipedia.org/wiki/Functional_programming). Loathe though I am to admit it, this usage seems almost encouraged by the structure of Ruby in its beautfully stubborn insistance that, no, really, *everything* is an object. There seems encouragement that `object.do_something` is the One True Way to do anything at all to `object`. Ruby's own terminology considers calling a method on an object "passing a message to it". While there are some great advantages to this way of interpreting code, it's not hard to see that, misapplied, it can confuse the concept of a well-organized class to a new developer. You get `MyModel#compute_complicated_stuff` instead of `ComplicatedStuffComputer.new(my_model).compute`. You get `Hash#split_words` instead of `Transcript#split_words`.

It's not just new developers that are affected. Rails is one of the largest offenders. Just take a peek at how many Ruby core classes are overridden within the Rails framework. You can debate how convenient it is, how the benefits outweight the costs, or just that you think it was for any reason the right call for Rails. I still hold that it encourages over-objectification in developers learning on Rails.

The Rails scaffolding itself leaves many people believeing that the types of classes you make are ActiveRecord-backed models in app/models, and miscelaneous other utilities in the "lib" junk-drawer (there's a [better way](http://blog.codeclimate.com/blog/2012/02/07/what-code-goes-in-the-lib-directory/)). If you've worked in Rails, you've probably heard "fat model, skinny controller", which all but encourages dumping all sorts of methods into ActiveRecord models. There's a [better way](https://robots.thoughtbot.com/skinny-controllers-skinny-models).

Virtually all gems in popular use by Rails projects have this pattern of injecting their own methods into ActiveRecord::Base or something similar. It's usually kept to a minimum, just defining the method that "enables" the gem for a given model. E.g., [acts-as-taggable-on](https://github.com/mbleigh/acts-as-taggable-on) defines the methods `acts_as_taggable` and `acts_as_tagger` on ActiveRecord::Base. [state-machines](https://github.com/state-machines/state_machines) defines `state_machine`. By itself, that's fine: you accept when you install a gem that you're configuring your environment, often ActiveRecord specifically, to work a certain way. But this contributes to why I think a lot of the existing framework out there encourages the anti-pattern of over-objectification.

### Classification

It is possible to beat this.

As mentioned above, the easy fix to the transcript methods scattered throughout `Hash`, `Array`, and `String` was to create an isolatable `Transcript` class that contained all of its own logic. This class then allows us to add new features to the `Transcript` class without all the clutter or scatter, and keeps the domain simple and intuitive. You can build utility methods that require a `Transcript` object and know exactly how to interact with its public methods. For example, a format converter that parses a `Transcript` and turns it into closed caption frames. This makes it obvious how to invoke this converted, rather than having to study how to morph your words into the exact specification implicitly documented by usage of transcript-hashes. This is what object oriented programming is about.

Expliring this style of code organization and conceptualization can bring about the best in what any object-oriented language has to offer. In Ruby, and especially Rails, we just have to try a little harder to encourage it.

Here's some great further reading on motivations and methods for factoring out cluttered code into more isolated models, specifically geared toward Rails projects:

* [Skinny controllers, skinny models](https://robots.thoughtbot.com/skinny-controllers-skinny-models)
* [Keeping your Rails controllers DRY with services](https://blog.engineyard.com/2014/keeping-your-rails-controllers-dry-with-services)
* [The secret to Rails OO design](http://blog.steveklabnik.com/posts/2011-09-06-the-secret-to-rails-oo-design)
* [7 ways to decompose fat ActiveRecord models](http://blog.codeclimate.com/blog/2012/10/17/7-ways-to-decompose-fat-activerecord-models/).
