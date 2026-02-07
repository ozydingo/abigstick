---
title: "Pitching Rails and ActiveRecord"
description: "Making the case for Rails to a non-Rails developer"
date: 2017-10-05 21:43:00 -0400
tags: [Rails]
---

---
## Summary

Making the case for Rails and ActiveRecord and for models-over-data to a hardcore SQL enthusiast

---

When you spend a lot of time in Rails, it's very easy to forget how much you take for granted. It's also easy to forget how much you give up. Most of the time, you don't miss much from the latter. To a developer who's very fluent with raw SQL, Rails can often feel like way too much abstraction, and way too much magic. I get that. Magic is cool and all, but you lost an element of understanding and control. So I imagine a common question a lot of experienced developers seeing Rails for the first time ask themselves is "why should I learn this?"

In this post I hope to provide fodder to answer that question. This is a brief and by no means complete enumeration of ideas in this domain, but a hopefully digestable introduction.

## Models over data

At the core of any web app, you want to deal with (read, write, and manipulate) data. `SELECT * FROM widgets WHERE name = 'Best Widget'`. `INSERT INTO widgets (name, price) VALUES ('Totall Awesome Widget', 1000000)`. No problem. Ok, so you could do this with ActiveRecord too: `Widget.find_by(name: "Best Widget")`. `Widget.create(name: "Totally Awesome Widget", price: 1_000_000)`. Different syntax, same functionality. If the readability doesn't sell you, then what's the big deal?

To me, most of the big deal comes with thinking about models over pure data. ActiveRecord is a powerful intersection between [OOP](https://en.wikipedia.org/wiki/Object-oriented_programming) and data persistence in a relational database. I'm not gonig to try to repeat the entire internet to make a case for object-oriented programming itself, but it is perhaps worth noting one or two bullet points:

- Data is just data, instance of classes contain data and give you _behavior_.
- `widget = Widget.find(1)` therefore not only gives you the _data_ in the row of the `widgets` table with id 1, but also gives you any consistent behavior you as the developer have written into the `Widget` class. `widget.activate`. `widget.destroy`. `widget.compute_trajectory`. All of the methods (or functions, if you prefer) are now a developer-facing API to this object that encapsulates a single row of data in your `widgets` table.

In addition to a logically organized set of behavior naturally associated with your data, here are a few of the things you unlock with this framing.

### 1. Callbacks

While Rails has its very own seven layers of callback hell, when used properly they clean up a lot of code and can give you a very robust architecture. Let's say our `widgets` table has a `price_updated_at` `DATETIME` column. Keeping this data in sync always is as simple as:

```ruby
class Widget < ActiveRecord::Base
  before_save :check_for_price_update

  def check_for_price_update
    self.price_updated_at = Time.now if changes.include?(:price)
  end
end
```

Now anyone\*, anywhere\*, who changes the price on a given row of the `widgets` table doesn't even have to know about the existence of the `price_updated_at` data column -- it gets updated correctly, and your data stay internally consistent.

\* - The glaring exeptions, of course, are if you (1) use methods specifically designed to avoid callbacks (e.g. `update_columns`), or (2) update the data using SQL or any other non-ActiveRecord-sanctioned method. It's never impossible to do it the old fashioned way, but you shouldn't have to if your models are well designed.

### 2. Abstraction

Ruby often encourages you to forget about the specific of getter and setter methods, but in many an OOP class you'll learn to define them with checks, validations, or other behaviors. Here's a quick example, jumping right into ActiveRecord with an example where we want to encrypt a field before storing it in our database.

```ruby
 class Widget < ActiveRecord::Base
   # setter
   def secret=(raw_secret)
     encrypted_secret = AESCrypt.encrypt(raw_secret, "sooper_secret")
     super(encrypted_secret)
   end

   # getter
   def secret
     AESEncrypt.decrypt(super, "sooper_secret")
   end
 end
```

Ignoring how terribly unsecure this encryption is, the functioality is sublime. We simply interact with the `secret` field as if it were a normal, plain text field. Under the hood, our model now automatically encrypts (in the setter) and descrupt (in the getter) the value, so the plain text secret never touches the db.

This isn't meant to be a primer on OOP, and of course anything you can think of doing with a `class` can be done here. Define methods that combine and manipulate data not stored directly on the table. Define procedures that do several complicated update steps. This is, of course, nothing you coudln't do with an externally-defined class in any language which you can initialize with the data selected by raw SQL, but by representing the model backed by these data as a native, first-class citizen, you unlock a powerful level of fluency.

### 3. DRY queries

[DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) code is maintainable code. I'll let a small comparison speak for itself:

You can blow with this
```SQL
SELECT * FROM widgets INNER JOIN creators ON creators.id = widgets.creator_id \
  INNER JOIN profiles ON creators.profile_id = profiles.id WHERE \
  widgets.available = 1 AND profiles.locale = 'us' \
  ORDER BY widgets.id DESC LIMIT 1;
SELECT count(*) FROM widgets INNER JOIN creators ON creators.id = \
  widgets.creator_id INNER JOIN profiles ON creators.profile_id = \
  profiles.id WHERE widgets.available = 1 AND profiles.locale = 'us';
SELECT count(*) FROM widgets INNER JOIN creators ON creators.id = \
  widgets.creator_id INNER JOIN profiles ON creators.profile_id = \
  profiles.id WHERE widgets.available = 1 AND profiles.locale = 'us' \
  GROUP BY creators.name;
SELECT count(*) FROM widgets INNER JOIN creators ON creators.id = \
  widgets.creator_id INNER JOIN profiles ON creators.profile_id = profiles.id \
  WHERE widgets.available = 1 AND profiles.locale = 'us' AND widgets.price < \
  1000 GROUP BY creators.name;
SELECT count(*) FROM widgets INNER JOIN creators ON creators.id = \
  widgets.creator_id INNER JOIN profiles ON creators.profile_id = \
  profiles.id WHERE widgets.available = 1 AND profiles.locale = 'us' AND \
  widgets.name = 'my_widget' GROUP BY creators.name;
```

Or you can blow with that
```ruby
def creator_count(widgets)
  widgets.group(:creator_id).count
end

widgets = Widget.joins(:creator => profile).
  where(available: true, profiles: {locale: 'us'})
widgets.last
widgets.count
creator_count(widgets)
creator_count(widgets.where("price < 1000"))
creator_count(widgets.where(name: "my_widget"))
```

These queries (here, the object represented by `widgets`) are themselves first-class citizens, members of the class `Widget::ActiveRecord_Relation`. You can pass these query objects into other methods and to other objects. You can build entire gems around manipulating these queries to some thematic end. With this native representation of the table rows or a query on these table rows as class instances, you can unleash a lot of functionality with very readable, maintainable, and slim code.

And with just a little extra Railsing, you could even blow with this:
```ruby
Widget.us.last
Widget.us.count
Widget.us.creator_count
Widget.us.cheaper_than(1000).creator_count
Widget.us.named("my_widget").creator_count
```

## Wrapping up

Three's a charm, so I'll leave it at that.
