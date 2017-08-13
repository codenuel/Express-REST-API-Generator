"use strict";

var models = require('../../models');
var _ = require('lodash');
var log = require('../logger');
var encryption = require('../encryption');
var crypto = require('crypto');
var request = require('request-promise');
var q = require('q');

var jobs = {};

// Logs all API requests
jobs.createRequestLog = function(request, done){
    log.info('logging API request: ',request.RequestId);
    models.RequestLogs.create(request)
    .then(function(res){
      return done(false, res);
  })
    .catch(function(err){
      log.error(err);
      return done(new Error(err.message));
  });
};

// Logs all API responses
jobs.updateRequestLog = function(response, done){
    log.info('logging API response: ',response.requestId);
    var requestId = response.requestId;
    delete response.requestId;
    models.RequestLogs.update({RequestId: requestId},response)
    .then(function(res){
        return done(false, res);
    })
    .catch(function(err){
        log.error(err);
        return done(new Error(err.message));
    });
};

// Creates search tags for all db records
jobs.createSearchTags = function(data, done){
    log.info('Creating search index for: ', data._id);
    var model = data.model;
    var update = data.update ? true : false;
    if(data.update){
        delete data.update;
    }
    delete data.model;
    var ourDoc = data;
    var split = [];
    delete ourDoc._id;
    delete ourDoc.createdAt;
    delete ourDoc.updatedAt;
    delete ourDoc.tags;
    for(var n in ourDoc){
        if(typeof ourDoc[n] === 'string'){
            split.push(ourDoc[n].split(' '));
        }
    }

    var task;
    if(update){
        task = models[model].update(data,{ $set: { updatedAt: new Date()}, $addToSet: {tags: {$each: split}} });
    }else{
        task = models[model].update(data,{ $set: { tags: split} });
    }

    task
    .then(function(res){
      return done(false, res);
  })
    .catch(function(err){
      log.error(err);
      return done(new Error(err.message));
  });
};

// Backup Data to Trash
// ToDo: Test saveToTrash job
jobs.saveToTrash = function(data, done){
    log.info('Saving '+data._id+' to Trash...');
    models.Trash.create(data)
    .then(function(res){
        done(false, res);
    })
    .catch(function(err){
        done(new Error(err.message));
    });
};

// Send Webhook Event
// ToDo: Test Webhook Event
jobs.sendWebhook = function(data, done){
    log.info('Sending Webhook to '+data.url+' (Secure mode: '+ data.secure+') with data => '+data.data);
    var hookData = {};
    // Expected data
    // {
    // url: 'http://string.com',
    // secure: true, // true or false
    // data: {
    // someData: 'this',
    // someOtherData: 'and this'
    // }
    // }
    // 
    // Data Sent to Hook Url
    // {
    // secure: true, // true or false
    // truth: 'a45de562fc65428ac537f', // checksum (Optional)
    // x-tag: 'gjsdgjadgjdabchyriadndbmnqoeequcmbsdbmdbshjchd', // Encryption Key (Optional)
    // data: 'Encryted data if secure is true or data object if secure is false'
    // }
    var hookPromise;
    if(data.secure){
        hookData.secure = data.secure;
        // Convert the Object to String
        var stringData = JSON.stringify(data.data);

        // Generate Checksum
        var checksum = crypto.createHash('sha512')
        .update(stringData)
        .digest('hex');
        hookData.truth = checksum;
        // Encrypt Data
        var key;
        hookPromise = encryption.generateKey()
        .then(function(resp){
            key = resp;
            hookData['x-tag'] = key;
            return encryption.encrypt(stringData, key);
        })
        .then(function(resp){
            hookData.data = resp;
            return hookData;
        });
        // ToDo: Test Secure Webhooks
    }else{
        hookPromise = q.fcall(function(){
            hookData.secure = false;
            hookData.data = data.data;
            return hookData;
        });
        // ToDo: Test Unsecure Webhooks
    }

    hookPromise
    .then(function(resp){
        var options = {
            method: 'POST',
            uri: data.url,
            body: resp,
            json: true // Automatically parses the JSON string in the response
        };
        return request(options);
    })
    .then(function(resp){
        done(false, resp);
    })
    .catch(function(err){
        done(new Error(err.message));
    });
};

module.exports = jobs;