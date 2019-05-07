---
layout: post
title: "AWS CloudFormation from the ground up"
description: "A step-by-step walkthrough using AWS CloudFormation to build a machine vision pipeline"
date: 2019-05-06 15:59:00 -0400
comments: true
tags: [AWS, CloudFormation, Serverless]
---

<span class="skip-link"><a href="#template_v1"> &raquo; Skip to the first template</a></span>

## A missing link between "hello world" and full API docs

AWS CloudFormation, a form of [infrastructure as code](https://en.wikipedia.org/wiki/Infrastructure_as_code), is pretty neat. With it you can specify an entire full stack web application or data processing engine (including servers, serverless functions, storage and databases, public APIs, and so on) in a template file that can be used to spin up or tear down with a few simple commands. This opens up a world of possibilities, such as version-controlling your infrastructure, easily spinning up staging or test environments, and spinning up isolated stacks on the fly such as when a user logs into your website. Now that's cool.

But I've found it very difficult to get off the ground with CloudFormation. There are a lot of reasons for this, but suffice it to say I find Amazon's software ecosystems (both internal and customer facing) just the right magical combination of being slightly buggy, poorly documented, a touch unintuitive, and with limited or delayed visibility to make the developer's experience something that occasionally makes me want to rip my eyelashes out.

So in this post, I want to build up the concepts and resources of CloudFormation step by step in digestible bits. We're going to build a CloudFormation stack that will process images and videos using Amazon Rekognition. But we'll go one step at a time, focusing on just the parts of the CloudFormation template we need to add or modify, what those changes are specifically responsible for doing, and why we need then.

## The templates

<a id="template_v1"></a>
### Hello, CloudFormation!

In the first template, we'll just create an S3 bucket.

<div>
  <span class="filename">template_v1.yaml</span>
  <span class="skip-link"><a href="#template_v2"> &raquo; Go to v2</a></span>
</div>

```
Resources:
  UploadBucket:
    Type: AWS::S3::Bucket
    Description: Input bucket for uploaded files
```

Resources created by this template:
<div class="output">UploadBucket (AWS::S3::Bucket): hello-stack-uploadbucket-1clr2yhf7fnf4</div>

The logical name "UploadBucket" is only meaningful in this template and stack. The physical name (right) given to this bucket is generated on the fly by CloudFormation. You can set it manually in the template, but by leaving it up to CloudFormation you can leave the responsibility of generating unique names for on-the-fly resources up to AWS.

Deploy this template using the following AWS CLI command (You can change the name `hello-stack` to anything you'd like):

```
aws cloudformation deploy --stack-name hello-stack --template-file template_v1.yaml
```

This creates or updates a stack called "hello-stack" in your AWS account. If this command succeeds, you can view your stack and its single resource in the [CloudFormation console](https://console.aws.amazon.com/cloudformation).

Generate the resource list as above using this, erm, "one-liner":

```
aws cloudformation describe-stack-resources --stack-name hello-stack | ruby -r json -e 'res = JSON.load(ARGF.read); puts res["StackResources"].map{|r| r["LogicalResourceId"] + " (" + r["ResourceType"] + "): " + r["PhysicalResourceId"]}'
```

<a id="template_v2"></a>
### Lo!, a file!

Next, we'll add a [Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/lambda-introduction-function.html) that responds to files uploaded to this bucket.

First a quick key to my coloring scheme:

<pre class="highlight"><code><span>New or modified code</span>
<span class="unmodified">Unmodified code from the previous template</span>
<span class="inline-value">Inline text block value</span>
</code></pre>

<div>
  <span class="skip-link"><a href="#template_v1">Go to v1 &laquo;</a></span>
  <span class="filename">template_v2.yaml</span>
  <span class="skip-link"><a href="#template_v3"> &raquo; Go to v3</a></span>
</div>

<pre class="highlight"><code>Transform: 'AWS::Serverless-2016-10-31'

<span class="unmodified">Resources:
  UploadBucket:
    Type: AWS::S3::Bucket
    Description: Input bucket for uploaded files</span>
  UploadHandler:
    Type: AWS::Serverless::Function
    Description: Responds to uploaded files
    Properties:
      Handler: index.handler
      Runtime: nodejs8.10
      InlineCode: <span class="inline-value">|
          exports.handler = async (event) => {
              const key = event.Records[0].s3.object.key;
              console.log(key);
          };</span>
      Events:
        NewFile:
          Type: S3
          Properties:
            Bucket: !Ref UploadBucket
            Events: s3:ObjectCreated:*
</code></pre>

Resources created by this template:
<div class="output">UploadBucket (AWS::S3::Bucket): hello-stack-uploadbucket-1clr2yhf7fnf4
UploadHandler (AWS::Lambda::Function): hello-stack-UploadHandler-DWC5R4LF6YTJ
UploadHandlerNewFilePermission (AWS::Lambda::Permission): hello-stack-UploadHandlerNewFilePermission-U4FZB5Z6LWY3
UploadHandlerRole (AWS::IAM::Role): hello-stack-UploadHandlerRole-1KUK6L8DWVS2W</div>

The architecture:

![Architecture diagram of the template_v2 architecture]({{site.url}}/assets/images/posts/{{page.id | slugify}}/template_v2-architecture.png "template_v2 architecture")

We've added two key things here. The first, at the top, is the `Transform` declaration. This uses the [AWS Serverless Transform](https://github.com/awslabs/serverless-application-model/blob/master/versions/2016-10-31.md) for CloudFormation templates. This transform defines, among other things, the `AWS::Serverless::Function` resource type, which is not native to [CloudFormation Resource Types](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html). Think of this transform as a pre-processor that expands the template to create multiple resources needed for triggering and executing Lambda code (notice how the output resource list has a few extra resources that we didn't declare -- more on that soon).

Second, we use this `AWS::Serverless::Function` resource type. We're using a Node.js 8.10 runtime, and [triggering](https://github.com/awslabs/serverless-application-model/blob/master/versions/2016-10-31.md#event-source-types) it from any ObjectCreated event in the S3 bucket we created by this template. Notice that we're referring to that bucket using the `!Ref UploadBucket` syntax, which is CloudFormation-specific syntax that [returns different things depending on what you're referencing](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-ref.html#ref-resource-return-examples).

To keep things simple, we're providing the code inline rather than having separate files to deal with at this stage in the walkthrough. The code in this function is very simple: it just spits the name of the uploaded file to the log. To verify that your stack is working, you can upload any file to your bucket and view these logs in the "Monitoring" tab of the Lambda console (look for the button that says "View logs on CloudWatch").

To deploy this template, we need to add the `capabilities` flag to explicitly grant ourselves permission to modify [IAM resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html).

```
aws cloudformation deploy --stack-name hello-stack --capabilities CAPABILITY_IAM --template-file template_v2.yaml
```

So, wait, look at that output resource list. What the hell is a `AWS::Lambda::Permission` exactly? It's not made very clear, and I can't even track down a documentation page that actually describes this outside of how you specify one within CloudFormation. So what is CloudFormation actually doing with this, and where can I see it in my AWS account?

In short, this "permission" allows other services (the entity responsible for the S3 notification, in this case) to call your function. You wouldn't need this if you were going to invoke your function from the command line or AWS console, and having the serverless transform handle this automatically is one of the biggest reasons to use that transform. The permission is almost the same thing as what's called the "Function Policy" in the AWS console, which you can see by clicking on the key icon floating on the top left of the Lambda console designer (duh). :eyeroll:

![Screenshot of the view permissions key in the AWS Lambda console]({{site.url}}/assets/images/posts/{{page.id | slugify}}/lambda-view-permissions.png "View Permissions"){:width="70%"}

The IAM Role created by this template, on the other hand, is more intuitive to understand. It is the role that the function assumes,  which gives it permission to do things such as execute the code, write logs, and, later in this walkthrough, use services like Rekogntiion and Kinesis.

<a id="template_v3"></a>
### Yeah, I'm gonna need that report

Now let's create a [Kinesis Data Stream](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) where we can write our information (still just the file name for now). This will allow us to poll these written data from web clients, other lambda functions, and anywhere where we can string together the code to connect to an AWS SDK or API.

<div>
  <span class="skip-link"><a href="#template_v2">Go to v2 &laquo;</a></span>
  <span class="filename">template_v3.yaml</span>
  <span class="skip-link"><a href="#template_v4"> &raquo; Go to v4</a></span>
</div>

<pre class="highlight"><code><span class="unmodified">Transform: 'AWS::Serverless-2016-10-31'</span>

Globals:
  Function:
    Environment:
      Variables:
        OUTPUT_STREAM: !Ref OutputStream

<span class="unmodified">Resources:
  UploadBucket:
    Type: AWS::S3::Bucket
    Description: Input bucket for uploaded files
  UploadHandler:
    Type: AWS::Serverless::Function
    Description: Responds to uploaded files
    Properties:
      Handler: index.handler
      Runtime: nodejs8.10</span>
      InlineCode: <span class="inline-value">|
          const util = require('util');
          const aws = require('aws-sdk');
          const kinesis = new aws.Kinesis();
          putRecords = util.promisify(kinesis.putRecords.bind(kinesis));
          exports.handler = async (event) => {
            const key = event.Records[0].s3.object.key;
            await putRecords({
              Records: [{
                Data: key,
                PartitionKey: 'shard-0',
              }],
              StreamName: process.env.OUTPUT_STREAM,
            });
            console.log("Put record for " + key);
          };</span>
      Policies:
        - AWSLambdaExecute
        - AmazonKinesisFullAccess
      <span class="unmodified">Events:
        NewFile:
          Type: S3
          Properties:
            Bucket: !Ref UploadBucket
            Events: s3:ObjectCreated:* </span>
  OutputStream:
    Type: AWS::Kinesis::Stream
    Description: "Collects all output data"
    Properties:
      ShardCount: 1
      StreamEncryption:
        EncryptionType: KMS
        KeyId: alias/aws/kinesis
</code></pre>

Resources created by this template:

<div class="output">OutputStream (AWS::Kinesis::Stream):hello-stack-OutputStream-8BPE5N22MHFM
UploadBucket (AWS::S3::Bucket):hello-stack-uploadbucket-1clr2yhf7fnf4
UploadHandler (AWS::Lambda::Function):hello-stack-UploadHandler-DWC5R4LF6YTJ
UploadHandlerNewFilePermission (AWS::Lambda::Permission):hello-stack-UploadHandlerNewFilePermission-U4FZB5Z6LWY3
UploadHandlerRole (AWS::IAM::Role):hello-stack-UploadHandlerRole-1KUK6L8DWVS2W</div>

The architecture:

![Architecture diagram of the template_v3 architecture]({{site.url}}/assets/images/posts/{{page.id | slugify}}/template_v3-architecture.png "template_v3 architecture")


Ok, what have we done now?

First, let's focus on the Kinesis data stream, called `OutputStream` (at the bottom of the template). This is pretty straightforward, we're just creating a stream that we can publish records to, using some reasonable defaults including an AWS-managed encryption key. If you don't know what shards are, don't worry, let's not get into that here.

Ok, now at the top we've added a `Globals` key. We're adding an environment variable that holds the name of the Kinesis data stream -- remember that we're letting CloudFormation generate this on the fly, so we can't refer to it statically. Using an environment variable, can reference this stream within our Node.js lambda code. Once again we're using the `!Ref` Cloudformation template function; this time instead of a resource Arn it gives the stream name, which is what we need. `!Ref` gives you what you usually need in most use cases. Convenient, until it's not.

We've also added `Policies` to the Lambda function. We didn't specify this in the last template, but we did need it! The serverless transform took care of it for us. But since we're doing custom actions (writing to Kinesis), we need to specify this setting ourselves. So we plop in the role that was created for us by default (AWSLambdaExecute, which is a [managed policy](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html)), and add to is the AmazonKinesisFullAccess managed policy.

Finally, we've updated the Lambda function code to write the file name to the kinesis record instead of the log. I'm not going to go into the code here since I want to focus on CloudFormation, not Lambda or the Kinesis Node.js SDK, but suffice it to say if we upload a file called "hello.txt" we'll get a record on the Kinesis data stream with the data "hello.txt".

<a id="template_v4"></a>
### Hark!, a face!

We're making progress! Let's do something more interesting that report the file name: let's send images uploaded to this bucket to Amazon Rekognition and run [DetectFaces](https://docs.aws.amazon.com/rekognition/latest/dg/API_DetectFaces.html) on them.

<div>
  <span class="skip-link"><a href="#template_v3">Go to v3 &laquo;</a></span>
  <span class="filename">template_v4.yaml</span>
  <span class="skip-link"><a href="#template_v5"> &raquo; Go to v5</a></span>
</div>

<pre class="highlight"><code><span class="unmodified">Transform: 'AWS::Serverless-2016-10-31'

Globals:
  Function:
    Environment:
      Variables:
        OUTPUT_STREAM: !Ref OutputStream

Resources:
  UploadBucket:
    Type: AWS::S3::Bucket
    Description: Input bucket for uploaded files
  UploadHandler:
    Type: AWS::Serverless::Function
    Description: Responds to uploaded files
    Properties:
      Handler: index.handler
      Runtime: nodejs8.10</span>
      InlineCode: <span class="inline-value">|
          const util = require('util');
          const aws = require('aws-sdk');
          const rekog = new aws.Rekognition();
          const kinesis = new aws.Kinesis();
          detectFaces = util.promisify(rekog.detectFaces.bind(rekog));
          putRecords = util.promisify(kinesis.putRecords.bind(kinesis));
          exports.handler = async (event) => {
            const bucket = event.Records[0].s3.bucket.name;
            const key = event.Records[0].s3.object.key;
            const data = await detectFaces({
              Image: {
                S3Object: {
                  Bucket: bucket,
                  Name: key,
                }
              }
            });
            console.log("Got data", data);
            await putRecords({
              Records: [{
                Data: JSON.stringify(data),
                PartitionKey: 'shard-0',
              }],
              StreamName: process.env.OUTPUT_STREAM,
            });
            console.log("Put record for " + key);
          };</span>
      Policies:
        - AWSLambdaExecute
        - AmazonKinesisFullAccess
        - AmazonRekognitionFullAccess
      <span class="unmodified">Events:
        NewFile:
          Type: S3
          Properties:
            Bucket: !Ref UploadBucket
            Events: s3:ObjectCreated:*
  OutputStream:
    Type: AWS::Kinesis::Stream
    Description: "Collects all output data"
    Properties:
      ShardCount: 1
      StreamEncryption:
        EncryptionType: KMS
        KeyId: alias/aws/kinesis</span>
</code></pre>

Resources created by this template:

<div class="output">OutputStream (AWS::Kinesis::Stream): hello-stack-OutputStream-8BPE5N22MHFM
UploadBucket (AWS::S3::Bucket): hello-stack-uploadbucket-1clr2yhf7fnf4
UploadHandler (AWS::Lambda::Function): hello-stack-UploadHandler-DWC5R4LF6YTJ
UploadHandlerNewFilePermission (AWS::Lambda::Permission): hello-stack-UploadHandlerNewFilePermission-U4FZB5Z6LWY3
UploadHandlerRole (AWS::IAM::Role): hello-stack-UploadHandlerRole-1KUK6L8DWVS2W</div>

The architecture:

![Architecture diagram of the template_v4 architecture]({{site.url}}/assets/images/posts/{{page.id | slugify}}/template_v4-architecture.png "template_v4 architecture")


This one's actually pretty simple as far as CloudFormation goes. In fact, you can see that our physical resource list hasn't changed. All we needed to do was add the `AmazonRekognitionFullAccess` policy to the Lambda function's execution role (under `Policies`), and use the [AWS Rekognition SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Rekognition.html) to call [DetectFaces](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Rekognition.html#detectFaces-property). This call returns the result in the same request, so there isn't really any additional architecture needed. We just get the result of `DetectFaces` and put it, instead of the file name, onto the Kinesis data stream.

<a id="template_v5"></a>
### Let's get movin'

V4 was a cop-out; we didn't change any architecture! Let's build in some more advanced Rekogntiion calls that will have us building an SNS topic and a second Lambda function. Specifically, we're going to use the [PersonTracking](https://docs.aws.amazon.com/cli/latest/reference/rekognition/start-person-tracking.html) Rekognition operation, an asynchronous task that we will have to handle in a separate piece of our stack.

<div>
  <span class="skip-link"><a href="#template_v4">Go to v4 &laquo;</a></span>
  <span class="filename">template_v5.yaml</span>
  <!-- <span class="skip-link"><a href="#template_v6"> &raquo; Go to v6</a></span> -->
</div>

<pre class="highlight"><code><span class="unmodified">Transform: 'AWS::Serverless-2016-10-31'

Globals:
  Function:
    Environment:
      Variables:
        OUTPUT_STREAM: !Ref OutputStream</span>
        SNS_PERSON_TRACKING_ROLE_ARN: !GetAtt PersonTrackingSnsRole.Arn
        SNS_PERSON_TRACKING_TOPIC: !Ref PersonTrackingSnsChannel

<span class="unmodified">Resources:
  UploadBucket:
    Type: AWS::S3::Bucket
    Description: Input bucket for uploaded files
  UploadHandler:
    Type: AWS::Serverless::Function
    Description: Responds to uploaded files
    Properties:
      Handler: index.handler
      Runtime: nodejs8.10</span>
      InlineCode: <span class="inline-value">|
          const util = require('util');
          const aws = require('aws-sdk');
          const rekog = new aws.Rekognition();
          startPersonTracking = util.promisify(rekog.startPersonTracking.bind(rekog));
          exports.handler = async (event) => {
            const bucket = event.Records[0].s3.bucket.name;
            const key = event.Records[0].s3.object.key;
            const resp = await startPersonTracking({
              Video: {
                S3Object: {
                  Bucket: bucket,
                  Name: key,
                }
              },
              JobTag: key,
              NotificationChannel: {
                RoleArn: process.env.SNS_PERSON_TRACKING_ROLE_ARN,
                SNSTopicArn: process.env.SNS_PERSON_TRACKING_TOPIC
              }
            });
            console.log("Response from rekognition:");
            console.log(resp);
          };</span>
      <span class="unmodified">Policies:
        - AWSLambdaExecute
        - AmazonRekognitionFullAccess</span>
        - Version: 2012-10-17
          Statement:
            - Effect: Allow
              Action: iam:PassRole
              Resource: !GetAtt PersonTrackingSnsRole.Arn
      <span class="unmodified">Events:
        NewFile:
          Type: S3
          Properties:
            Bucket: !Ref UploadBucket
            Events: s3:ObjectCreated:* </span>
  PersonTrackingSnsChannel:
    Type: AWS::SNS::Topic
    Description: SNS Topic to notify of completed Rekognition/PersonTracking jobs
  PersonTrackingSnsRole:
    Type: AWS::IAM::Role
    Description: Provides permission to publish job completion notifications to SNS
    Properties:
      AssumeRolePolicyDocument:
        Version: 2012-10-17
        Statement:
          - Effect: Allow
            Principal:
              Service: rekognition.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AmazonSNSFullAccess
  PersonTrackingJobHandler:
    Type: AWS::Serverless::Function
    Description: Handle completed Rekognition/PersonTracking jobs
    Properties:
      Handler: index.handler
      Runtime: nodejs8.10
      InlineCode: <span class="inline-value">|
          const util = require('util');
          const aws = require('aws-sdk');
          const kinesis = new aws.Kinesis();
          putRecords = util.promisify(kinesis.putRecords.bind(kinesis));
          exports.handler = async (event) => {
            console.log("Looks like we done tracked a person");
            console.log(event.Records[0].Sns);
            await putRecords({
              Records: [{
                Data: JSON.stringify(event.Records[0].Sns),
                PartitionKey: 'shard-0',
              }],
              StreamName: process.env.OUTPUT_STREAM,
            });
          }</span>
      Policies:
        - AWSLambdaExecute
        - AmazonKinesisFullAccess
      Events:
        PersonTrackingJobComplete:
          Type: SNS
          Properties:
            Topic: !Ref PersonTrackingSnsChannel
  <span class="unmodified">OutputStream:
    Type: AWS::Kinesis::Stream
    Description: "Collects all output data"
    Properties:
      ShardCount: 1
      StreamEncryption:
        EncryptionType: KMS
        KeyId: alias/aws/kinesis</span>
</code></pre>

Resources created by this template:

<div class="output">OutputStream (AWS::Kinesis::Stream): hello-stack-OutputStream-8BPE5N22MHFM
PersonTrackingJobHandler (AWS::Lambda::Function): hello-stack-PersonTrackingJobHandler-1MVZP0GXRRM3N
PersonTrackingJobHandlerPersonTrackingJobComplete (AWS::SNS::Subscription): arn:aws:sns:us-east-1:315960167857:hello-stack-PersonTrackingSnsChannel-MYUFPLCIZKBY:2db1c03c-b493-4477-b07f-c3505273cd60
PersonTrackingJobHandlerPersonTrackingJobCompletePermission (AWS::Lambda::Permission): hello-stack-PersonTrackingJobHandlerPersonTrackingJobCompletePermission-HT2I36VKUB3P
PersonTrackingJobHandlerRole (AWS::IAM::Role): hello-stack-PersonTrackingJobHandlerRole-3GIHUCPWC8HN
PersonTrackingSnsChannel (AWS::SNS::Topic): arn:aws:sns:us-east-1:315960167857:hello-stack-PersonTrackingSnsChannel-MYUFPLCIZKBY
PersonTrackingSnsRole (AWS::IAM::Role): hello-stack-PersonTrackingSnsRole-1N7EJH7QLPX6O
UploadBucket (AWS::S3::Bucket): hello-stack-uploadbucket-1clr2yhf7fnf4
UploadHandler (AWS::Lambda::Function): hello-stack-UploadHandler-DWC5R4LF6YTJ
UploadHandlerNewFilePermission (AWS::Lambda::Permission): hello-stack-UploadHandlerNewFilePermission-U4FZB5Z6LWY3
UploadHandlerRole (AWS::IAM::Role): hello-stack-UploadHandlerRole-1KUK6L8DWVS2W</div>

The architecture:

![Architecture diagram of the template_v5 architecture]({{site.url}}/assets/images/posts/{{page.id | slugify}}/template_v5-architecture.png "template_v5 architecture")


Ok, so there's a lot of new going on here. Let's do this one thing at a time.

<span class="output">PersonTrackingSnsChannel</span>. This is an [SNS topic](https://docs.aws.amazon.com/sns/latest/dg/welcome.html) that we will set up Rekognition to report completed PersonTracking jobs to, and we will trigger a new Lambda to respond to.

<span class="output">PersonTrackingJobHandler</span>. This function responds to completed Rekognition jobs and writes the output to the Kinesis data stream. So we need the AmazonKinesisFullAccess policy, which was previously were on the UploadHandler function. We also need AWSLambdaExecute as we do for any function to run.

We're setting this lambda function's trigger to be the SNS topic we just created, via `!Ref PersonTrackingSnsChannel`. As before, this will cause the serverless transform we're using to also create a `AWS::Lambda::Permission` (named PersonTrackingJobHandlerPersonTrackingJobCompletePermission) that will allow this SNS topic to invoke this function. It also creates a `AWS::SNS::Subscription` (named PersonTrackingJobHandlerPersonTrackingJobComplete), which is the mechanism responsible for actually communicating SNS messages to consumers. We see these resources in the output but we don't need to explicitly worry about it in our template.

The function code itself simply dumps the data received from the SNS notification into the same Kinesis data stream as before.

<span class="output">PersonTrackingSnsRole </span>. This is an IAM role that will allow Rekognition to publish to our SNS channel. Translating the "Assume Role Policy Document" out of AWS-speak, we are allowing the service rekognition.amazonaws.com (the "principal") to assume this role, which contains the AmazonSNSFullAccess policy that will authorize it to publish messages to SNS. While we listed managed policies by name for our lambda functions, when defining an IAM role it wants the full [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) for some reason.

<span class="output">Environment Variables</span>. We need to reference our new SNS topic and IAM role in our modified UploadHandler function. To do this, we're storing their references in environment variables just like we did for the Kinesis data stream. We get the SNS topic using `!Ref PersonTrackingSnsChannel`, which gives us the topic ARN as we need. However `!Ref PersonTrackingSnsRole` returns the role name, not ARN, so we can use `!GetAtt PersonTrackingSnsRole.Arn` instead. Don't you love the consistency?

<span class="output">UploadHandler</span>. We're actually removing functionality here: we no longer need this function to write to Kinesis. Instead, we modify the Rekognition call to use the
[StartPersonTracking](https://docs.aws.amazon.com/rekognition/latest/dg/API_StartPersonTracking.html) method. For this we need the AWSLambdaExecute and AmazonRekognitionFullAccess policies, as before. But we've also added an inline policy document right beneath these managed policy names. It's an odd little thing: IAM PassRole. This policy permits its holder (the Lambda function) to pass on a specified IAM role (PersonTrackingSnsRole) to another entity (Rekognition).

The idea here is that granting another entity an IAM role is a large potential security vulnerability, so AWS locks this down by preventing you from doing so unless you have the appropriate PassRole permission. To be honest, this strikes me more as an over-configured security-by-paranoia rather than actually useful, but it's the system we're working with.

Phew!

## In sum

* We built a functional, scalable machine vision pipeline (using off the shelf machine vision, of course) one step at a time in order to gain an appreciation an understanding of the CloudFormation constructs required to build the final product.

* The documentation for all of these components is occasionally a bit spread out; while I tried my best here to aggregate all the documents, the only remedy for moving forward is to struggle through finding the docs for different concepts until you have a better feeling for how AWS likes to (mis)manage its informational resources.

* We got a feel for declaring resources such as S3 buckets, Lambda functions, SNS topics, and Kinesis data streams.

* For most communications between these components, we needed to declare or have given for us some IAM role. Most of the time, for these roles, we were able to use "managed policies", but sometimes we needed to specify the policy documents manually. In some cases, when we needed to grant permission to a service to invoke a lambda function, we didn't create an IAM role but instead defined a concept that AWS doesn't seem to have a consistent name for, sometimes a "Function Policy", sometimes a "Lambda Permission", elsewhere a "Trust Policy".

Moving forward, I'd definitely encourage to beef up the Lambda code, for example by adding error handling, file type validation, and such. I may soon come back and add additional template layers that work with separate files instead of inline code, and perhaps add on a few more AWS services / resources, but I've had quite enough for now, so bye!
