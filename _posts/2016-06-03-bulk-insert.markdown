---
layout: post
title: "bulk_insert"
date: 2016-06-03 17:38:15 -0400
comments: true
tags: [Rails]
---

## Insert thousands of records in an instant. Even in Rails.
<a href="#tl-dr-bulk_insert">tl; dr</a>

Sometimes, you just need to create a lot of records.

We have a `Job` model, and when someone on our operations team wants to open that job up to a market, we create `JobAccess` records. Thousdans of them. You may know enough of Rails to know that this can be get slow without some care. You could disable validations, but you're still contacting the db once for each create.

A common solution is to use an asyncronous task maamnger like Resque. This kind of sucks, though, because now the the action is delayed and there's no immediate feedback to the ops manager. They click, the request gets completed OK, then they have to wait some undetermined amount of time to check if it worked.

I've got a better idea. Use SQL's `INSERT INTO` feature. This isn't implemented in Rails as of yet. It comes with a host of potential problems: it won't run validations or callbacks, for starters. But for the benefit of immediate response (it really is speedy!), we'll accept the sacrifice of having to make sure we're creating records correctly.

The biggest trick is forming the syntax. I've been getting into more Arel, but the insert manager is poorly documented. Meanwhile, we can construct the SQL ourselves with some care. For requirements, we want to pass an Array of attributes Hashes that will be properly sanitized (including serialized attributes). Luckily, ActiveRecord::Base includes a `sanitize` method that handles that for us. Because of SQL's syntax, we're going to require that all of the attributes Hashes in the Array have the same keys.

<a name="tl-dr-bulk_insert"></a>

In `active_record_extension.rb`

```ruby
def bulk_insert(attribute_array)
  return if attribute_array.empty?
  self.connection.execute(bulk_insert_sql(attribute_array))
end

def bulk_insert_sql(attribute_array)
  fields = attribute_array.first.keys
  values = attribute_array.map do |attrs|
    attrs.keys == fields or raise ArgumentError, "Attribute array must all have the same keys. Expected #{fields * ', '}, got #{attrs.keys * ', '}"
    fields.map{|key| self.sanitize(attrs[key])}
  end
  fields_string = "(" + fields.map{|f| "`" + f.to_s.gsub(/`/, "") + "`"} * ", " + ")"
  values_string = values.map{|vals| "(" + vals * ", " + ")"} * ", "
  return "INSERT INTO #{self.table_name} #{fields_string} VALUES #{values_string}"
end
```

This is a little dense, so let's break it down:

1. First, we use the keys of the first attributes Hash as the field names.
2. We then map each of the Hash values into an Array of sanitized values and confirm that each Hash has the same keys.
3. We have to manually sanitize the field names, since I can't find an ActiveRecord method that does that. As long as we strip backticks (\`) and wrap field names in a single set of the same, we're good to go. The fields will exist or they will not, and no unintended SQL can be injected. Worst case is the SQL server will complain that the field does not exist. We surround the whole list in parentheses.
4. We wrap each array of values, already sanitized, in parentheses, and join the results with a comma.
5. We're ready to go, so we piece it all together in an `INSERT INTO` statement.
6. Finally, we use the raw SQL using `ActiveRecord::Base.connection.execute()`

Once we include these methods into ActiveRecord, it's as simple as `JobAccess.bulk_insert(attributes_array)`.

Be careful with this one. You can violate a lot of Rails data validations extremeley easily using this tool.
