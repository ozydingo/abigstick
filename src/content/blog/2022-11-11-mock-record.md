---
title: "Mock Record"
description: "Testing libs against a totally fake record"
date: 2022-04-09 11:42:00 -0400
tags: [rails, rspec, mock, fake, testing]
---

## Testing lib code

I'm a frameworks kind of guy, and in my day job I write a lot of code that I want other developers to use in their projects. In a green-field, ideal scenario, I'm writing gems, publishing open source, and dancing with the unicorns of BSD licenses and full separation of concerns.

In reality, a lot of my application-agnostic code is plopped right into the `lib` folder of an application project. After all, is it not decreed that we [avoid hasty abstraction](https://kentcdodds.com/blog/aha-programming)?

This practicality has led to an interesting decision tree around testing. I'm not satisfied unless the system under test includes a real consumer of my code, so that I exercise all the fun little cartilagey bits between unit tests and interactions with the real world. So the easiest thing to do is simply to write a set of tests using models and objects from the application I'm working in. This was, I'll admit, the first iteration of my test suite for the [Factory Burgers: Factory Bot UI](/2021/08/14/hacking-factories-part-1.html)

I didn't think unicorns could cry, but I might have just made that a reality.

The thing is, coupling my application-agnostic code with application constructs in tests isn't very application agnostic. It makes it hard to actually extract the code come time to do so, and results in fragile tests as the application grows and evolves into something you never would have imagined, hoped for, or feared when you first signed the job offer.

I needed a better way.

## Cheap fakes

I'll make a quick stop to mention that the first successful abstraction away from application code was to use very shallow stubs of the classes I needed. So in a piece of code that aimed at standardize data transformation of a certain kind of class, I just created classes with dummy attributes, and didn't much care about mimicking anything ActiveRecord-like or database-backed beyond that.

```rb
module SpecSupport
  module VariantList
    class StandardFurniture < ApplicationRecord
      attr_accessor :id, :code, :display_name, :active, :description
    end

    class NonstandardFurniture < ApplicationRecord
      attr_accessor :id, :item_code, :description
    end
  end
end
```

Sure, these models inherited from `ActiveRecord::Base` by way of `ApplicationRecord`, but the declared attribute were in no way connected to ActiveRecord behaviors, callbacks, or persistence.

## Flipping the table

The solution above became inadequate when I needed to test an encryption module I was writing. I was writing this because I knew it was available in Rails 7, and I knew we weren't going to migrate to Rails 7 for longer than I could stand seeing keys stored in plain text or with an encryption gem with a 2013 exposed security vulnerability. I needed to test queries, write assertions about the data that was saved to the database and not just that which was exposed to the class. (As a side-note, if you dogmatically never test anything but your class' public interface, but the feature you're writing is specifically designed to foil hackers using nonstandard access and intentionally never exposes these details to your consumers, what gives?)

It should be noted that I took inspiration from [this blog post](https://envygeeks.io/blog/2013/06/24/mocking-active-record-to-test-concerns) about creating temporary tables in tests. However, I wanted a few changes:

- True "temporary tables" were causing some parts of ActiveRecord (that apparently I needed) to break
- I wanted my feature to live in its own module, not be plopped right into the global namespace of anything you can write while in an rspec test group.

What came out of these requirements was simply this. Create a table then declare a model linked to that table using standard ActiveRecord migration and model syntax, such as with this example:

```rb
  MockRecord.create_temporary_table("mock_records", run_context: self) do |t|
    t.string :foo, limit: 16
    t.string :bar
    t.string :baz, null: false
  end

  mock_model =
    MockRecord.generate("mock_records") do
      validates :baz, presence: true

      scope :fooey, -> { where.not(foo: nil) }
      scope :barey, -> { where.not(bar: nil) }
    end
```

The table is dropped up at the end of your example group, and the value returned from `MockRecord.generate` is a real ActiveRecord::Base subclass backed by the table.

The code, just like me, isn't all that much to look at:

```rb
module MockRecord
  Base = Class.new(ActiveRecord::Base)

  module_function

  def generate(table_name, &blk)
    klass = Class.new(MockRecord::Base)
    klass.table_name = table_name
    klass.class_eval(&blk)
    return klass
  end

  def create_temporary_table(table_name, run_context:, force: false, &blk)
    run_context < RSpec::Core::ExampleGroup or
      raise "`run_context` should be `self` inside an example group."

    # TODO: verify table does not already exist
    ActiveRecord::Migration.suppress_messages do
      ActiveRecord::Base.connection.execute("DROP TABLE IF EXISTS `#{table_name}`") if force
      ActiveRecord::Migration.create_table table_name do |t|
        blk.call(t)
      end
    end

    run_context.after(:all) do
      ActiveRecord::Migration.suppress_messages { ActiveRecord::Migration.drop_table table_name }
    end
  end
end
```

A few notes from this code.

- For funsies, we're creating a `MockRecord::Base` class that inherit from `ActiveRecord::Base` and is the base class of any created mock record class. This isn't specifically used as of yet, but it seemed like a good idea.
- The `generate` method simply defines a subclass of this base class, evaluates the block you pass it as if it were written inside a class definition block. This makes the api very similar to authoring a real ActiveRecord class.
  - I could have been stricter and kept table naming out of this method, but I wanted to allow this class to be anonymous to avoid declaring global consts inside specs. This means ActiveRecord wouldn't have a convention to use for the table name for each class. Linking it explicitly to the table in the method params seemed a little more intuitive given that requirement that forcing users to use `self.table_name = ...` as you would with custom table naming.
- I don't love the need to pass `self` in, but this was the only way I could add an `after(:all)` hook automatically without breaking down my module encapsulation.

## Mockery in action

Using this new feature in my encryption module test:

```rb
  MockRecord.create_temporary_table("encryptables", run_context: self, force: true) do |t|
    t.string :foo, limit: 2048
    t.string :bar
    t.string :baz
  end

  mock_model =
    MockRecord.generate("encryptables") do
      extend ::Encryptz::Encryptable

      encryptz :foo
      encryptz :bar, key: SecureRandom.random_bytes(32), deterministic: true

      # Retrieve the value stored in the database without serializers, overrides, or any model behavior
      def stored(attr_name)
        query = "SELECT #{attr_name} FROM encryptables WHERE id = #{self.id}"
        self.class.connection.execute(query).first.first
      end
    end
  end
```

Now I have a real fake ActiveRecord model that uses the real test database, allowing me to write my specs to ensure that I was in fact storing encrypted data transparently to users of any class, and I could test this using a class that wasn't tied to any application concern.

When it comes time to extract this into a gem, well, I won't, because Rails 7 already has that covered.

## Postscript: testing the testing utility

What's nice about writing a test helper is that testing the test helper can be done in a file that's actually collocated with the helper itself. I can test a few sanity-checking behaviors, such as the ability to query my fake model (example above)

```rb
  it "queries like any ActiveRecord model" do
    query = mock_model.fooey.barey.where(baz: "nope")
    expect(query).to be_a(ActiveRecord::Relation)
  end
```

That the table exists during the test

```rb
  it "creates a temporary table" do
    result = ActiveRecord::Base.connection.execute(MockRecord::TEST_QUERY)
    expect(result.to_a).to be_present
  end
```

And that the table is dropped afterwards, by writing a test that runs afterwards.

```rb
describe "MockRecord ::after" do
  it "destroys the temporary table" do
    expect { ActiveRecord::Base.connection.execute(MockRecord::TEST_QUERY) }.to raise_error(
      ActiveRecord::StatementInvalid,
      /Table '\w+.mock_records' doesn't exist/,
    )
  end
end
```
