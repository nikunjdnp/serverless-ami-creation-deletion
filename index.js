'use strict'
const async = require('async');
const AWS = require('aws-sdk');
const moment = require('moment-timezone');
const ec2 = new AWS.EC2({
    region: 'us-east-1',
    apiVersion: '2016-11-15'
});
const ses = new AWS.SES({
    region: 'us-east-1',
    apiVersion: '2016-11-15'
});

const TagName = process.env.tagName; //Specify the tagName(Ex. 'BackupNode').
const SENDER_EMAIL_ID = process.env.sourceEmailId; //Specify the sender email address.
const CC_EMAIL_IDS = [process.env.CCEmailId]; //Specify the cc email ids.
const TO_EMAIL_IDS = [process.env.destinationEmailId]; //Specify the recipient email ids.

/**
 * Note: Make sure the email ids have been verified from AWS SES services, else you can't send the mail on the specified email ids.
 */

/**
 * @description Specify the retention time type for the AMIs.  It can be year, quarters,months, week, days, hours, minutes, seconds, milliseconds.
 * @example RETENTION_TYPE = 'minutes'
 */
const RETENTION_TYPE = process.env.retentionType; // IF you wish year then find from the below keyword and place it. 

/**
 * @description Specify the retention time for the AMIs. After how much time, the AMIs should be deleted. It is the expiry period of the AMIs.
 * @example RETENTION_TIME = '15'  //It means 15 minutes (retention_time + retention_type).
 * https://momentjs.com/docs/#/manipulating/add/
 */

const RETENTION_TIME = process.env.retentionTime;

exports.handler = (event, context, callback) => {
    let TotalOperationForEc2 = [], TotalOperationForAMIDelete = [];

    async.waterfall([
        /**
         * @param {Object} done
         * @description Fetch those ec2 instances, which have tag `BackupNode : True` and the instances are either stopped or in running state. 
         * @returns Array object of ec2 instances
         */
        function (done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['true', 'True']
                }, {
                    Name: 'instance-state-name',
                    Values: ['running', 'stopped']
                }]
            };
            ec2.describeInstances(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    done(err, null);
                }
                else {
                    done(null, data);
                }
            });
        },
        
        /**
         * 
         * @param {Object} instances 
         * @param {Function} done 
         * @description This function will create AMI & Snapshot of each instances and tag them with new tag like `isExpireOn : 1567364744744`.
         * @returns Callback function
         */
        
         function (instances, done) {
            console.log('Number of instances ::', instances.Reservations[0].Instances.length);
            if (instances) {
                async.map(instances.Reservations[0].Instances, (instance, done1) => {
                    console.log('Creating Image for ::', instance.InstanceId);
                    let params = {
                        InstanceId: instance.InstanceId,
                        Name: 'AMI_' + instance.InstanceId + '_' + moment.tz(new Date(), "Asia/Kolkata").add(RETENTION_TIME, RETENTION_TYPE).valueOf().toString(),
                        Description: 'This is an AMI of ' + instance.InstanceId + '. Created on : ' + new Date().getTime(),
                        NoReboot: false
                    };
                    ec2.createImage(params, function (err, data) {
                        if (err) {
                            console.log(err, err.stack);
                            done1(err, null);
                        }
                        else {
                            let Tags = [];
                            let instanceInfo = {};
                            instanceInfo['InstanceId'] = instance.InstanceId;
                            instanceInfo['ImageId'] = data.ImageId;
                            TotalOperationForEc2.push(instanceInfo);
                            let imageTags = instance.Tags;
                            imageTags.forEach(element => {
                                if (element.Key.indexOf("aws:", 0) == -1) {
                                    Tags.push(element);
                                }
                            });
                            Tags.push({
                                Key: 'isExpireOn',
                                Value: moment.tz("Asia/Kolkata").add(RETENTION_TIME, RETENTION_TYPE).valueOf().toString()
                            });
                            var tagparams = {
                                Resources: [data.ImageId],
                                Tags: Tags
                            };
                            ec2.createTags(tagparams, function (err, data) {
                                if (err) {
                                    console.log(err, err.stack);
                                    done1(err, null);
                                }
                                else {
                                    console.log("Tags added to the created AMIs");
                                    done1(null, data);
                                }
                            });
                        }
                    });
                }, (err, result) => {
                    if (err) {
                        done(err, null);
                    }
                    else {
                        done(null, result);
                    }
                });
            }
            else {
                done(null, 'Instances not found!');
            }
        },
        /**
         * @param {Object} forami 
         * @param {Function} done
         * @description This function will fetch the AMI from the AMI list, which have tag like `BackupNode : True`.
         * @returns Callback function 
         */
        function (forami, done) {
            let params = {
                Filters: [{
                    Name: 'tag:' + TagName,
                    Values: ['true', 'True']
                }],
                Owners: ['self']
            };
            ec2.describeImages(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    done(err, null);
                }
                else {
                    done(null, data);
                }
            });

        },
        //fetch AMI which are elidgible to delete
        /**
         * 
         * @param {Array} images 
         * @param {Function} done
         * @description This function will fetch the total AMIs from your account which have tag and deregister the AMIs, if current time > retention time.
         *  It will also delete the snapshots, which are attached with the AMIs. 
         */
        function (images, done) {
            console.log('Fetching total AMI from your account(only owned by you)...');
            console.log('Total AMIs :', images.Images.length);
            async.map(images.Images, (image, done1) => {
                if (image) {
                    var imageName = image.Name;
                    var ExpireTimestamp = imageName.replace(/_/g, " ").split(" ");
                    var currentTimestamp = moment.tz(new Date(), "Asia/Kolkata").valueOf();
                    if (ExpireTimestamp[2] < currentTimestamp) {
                        var imageDelete = {};
                        imageDelete['ImageId'] = image.ImageId;
                        TotalOperationForAMIDelete.push(imageDelete);
                        //delete image
                        ec2.deregisterImage(imageDelete, function (err, data01) {
                            if (err) console.log(err, err.stack); // an error occurred
                            else {
                                console.log('Image id ' + image.ImageId + ' Deregistered');
                                async.map(image.BlockDeviceMappings, (snapShot, done2) => {
                                    if (snapShot.Ebs) {
                                        var snapparams = {
                                            SnapshotId: snapShot.Ebs.SnapshotId
                                        };
                                        ec2.deleteSnapshot(snapparams, function (err, data) {
                                            if (err) { console.log(err, err.stack); } // an error occurred
                                            else {
                                                console.log('Snapshot id' + snapShot.Ebs.SnapshotId + ' Deleted');
                                                done2(null, snapShot.Ebs.SnapshotId);
                                            } // successful response
                                        });
                                    } else {
                                        done2(null, null);
                                    }

                                }, (err, result) => {
                                    if (err) {
                                        console.log(err, err.stack);
                                        done1(err, null);
                                    }
                                    else {
                                        done1(null, result);
                                    }
                                });
                            }
                        });
                    }
                    else {
                        //console.log("Do not need to delete any image!");
                        done1(null, null);
                    }
                }
                else {
                    console.log('Not found any AMI!');
                    done1(null, null);
                }
            }, (err, result) => {
                if (err) {
                    console.log(err, err.stack);
                    done(err, null);
                }
                else {
                    done(null, result);
                }
            });
        }
    ], (err, result) => {
        if (err) {
            console.log('Err :: ', err);
            sendEmail('[Err] AMI automation script report!', SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, err);
            callback(err, null);
        }
        else {
            let FinalDone = {
                "TotalOperationForEc2": TotalOperationForEc2,
                "TotalOperationForAMIDelete": TotalOperationForAMIDelete
            }
            console.log("AMI has been created for the following instances ::", TotalOperationForEc2, 'AMI has been deleted for the following AMIs ::', TotalOperationForAMIDelete);
            let message = "Hello, Report of AMI Automation script!  \n" +
                "Ami creation result ->  " + JSON.stringify(TotalOperationForEc2) + ", \n \n " +
                "Ami deletion result ->  " + JSON.stringify(TotalOperationForAMIDelete) + " , \n" +
                "\n \n " +
                "Thanks";
            //send email    
            sendEmail("AMI automation script report!", SENDER_EMAIL_ID, TO_EMAIL_IDS, CC_EMAIL_IDS, message);
            callback(null, FinalDone);
        }
    });

};

/**
 * @param {String} subject 
 * @param {String} senderId 
 * @param {Array} to 
 * @param {Array} Cc 
 * @param {String} messageContent
 * @description This function will send a report of the script as an email. 
 */
var sendEmail = function (subject, senderId, to, Cc, messageContent) {

    ses.sendEmail({
        Source: senderId,
        Destination: {
            BccAddresses: [],
            CcAddresses: Cc,
            ToAddresses: to
        },
        Message: {
            Subject: {
                Data: subject
            },
            Body: {
                Text: {
                    Charset: "UTF-8",
                    Data: messageContent
                }
            }
        }
    }, function (err) {
        if (err) {
            console.log(err);
            throw err;
        }
        else {
            console.log('Email has been sent!');
        }
    });
};
