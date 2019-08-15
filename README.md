# serverless-ami-creation-deletion

Whenever the lambda function will be triggered, it will create AMI of your ec2 instances and delete the instances whose expiry date is less than the current date.

# Configuration
For configuration, the following variables need to be configured in the index.js file,

```variables

# specify the region name where you have your ec2 workloads.
region = 'us-east-1'

TagName = 'BackupNode'
SENDER_EMAIL_ID = 'abc@gmail.com'
CC_EMAIL_IDS = 'xyz@gmail.com'
TO_EMAIL_IDS = 'abc123@gmail.com'
RETENTION_TYPE = 'minutes'
RETENTION_TIME = 10
```

For more information, please review my blog (http://bit.ly/2Nd5iq6).
