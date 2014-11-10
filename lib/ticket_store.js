/*global require module process */
var redis = require("redis")
var config_file = process.env.CONFIG_FILE || 'config.json'
// read the config file and create a redis client
var redclient;
// moving this into the config_okay callback
//
// might be a race condition, if waiting to parse the file while
// already processing requests?
//
// redclient = redis.createClient();
var config_okay = require('config_okay')
config_okay(config_file,function(err,config){
    // config has redis config parameters, if any
    //
    logger.error({'err':err,
                 'config':config})

    throw new Error('die')
    var host = "127.0.0.1"
    var port = 6379
    var password;
    if(err !== undefined && config.redis !== undefined){
        // have a config.  Process it
        if(config.redis.port !== undefined){
            port = config.redis.port
            delete config.redis.port
        }
        if(config.redis.host !== undefined){
            port = config.redis.host
            delete config.redis.host
        }
        if(config.redis.password !== undefined){
            password = config.redis.password
            delete config.redis.password
        }
        // all other options are passed through as is
    }
    // set the global
    // probably should do this in a callback
    // test this first, then fix that
    redclient = redis.createClient(port,host,config);
    if(password !== undefined){
        redclient.auth(password)
    }
    redclient.on("error", function (err) {
        logger.error("Redis Client Error: " + err);
    });
    return null
})

var logger = require('./logger')('cas_validate::ticket_store')

logger.error(config_file)
/**
* One day in seconds.
*/
var oneDay = 86400;

var _ttl = process.env.CAS_SESSION_TTL // in seconds

logger.debug('ttl will default to '+_ttl)

/**
 * set_session
 *
 * store the session id, and the CAS session ticket in Redis, for
 * single sign off.
 *
 * uses the 'req' object to pull out the st and sessionid, and also to
 * determine the maxage set for the session
 */
function set_session(req,cb){

    // ttl stuff borrowed & modified from  visionmedia / connect-redis.js  source code
    // Copyright(c) 2012 TJ Holowaychuk <tj@vision-media.ca>  MIT Licensed

    try {
        var maxAge = req.session.cookie.maxAge
        var ttl = _ttl || ('number' == typeof maxAge
                          ? maxAge / 1000 | 0
                          : oneDay)

        redclient.setex(req.session.st, ttl, req.sessionID, function(err){
            if(!err){
                 logger.debug('SETEX session ticket, max age ' + ttl);
            }
            cb && cb(err)
        })
    } catch (err) {
        logger.error('saving session ticket to Redis threw an error')
        //throw new Error(err)
        cb && cb(err);
    }
}

/**
 * clear_st(st,request, callback)
 *
 * parameters:
 *
 * st: the session ticket, parsed from the CAS POST message
 *
 * request: the request object, which is needed for its link to the
 *          general session store for the web server
 *
 * callback: a function to call, will be passed any errors
 *
 * look in the redis db for the session associated with the given
 * session ticket (the st), and then remove the session from the
 * session store
 *
 */

function clear_st(st,req,callback){
    redclient.get(st
                 ,function(err,sid){
                      if(!err){
                          redclient.del(st);
                          if(sid){
                              logger.debug('got '+sid+' from redis')
                              return clear_session(sid,req,callback)
                          }else{
                              logger.debug('got '+sid+' from redis, nothing to clear')
                              callback && callback()
                          }
                      }else{
                          callback && callback(err)
                      }
                      return null
                  })
    return null
}

/**
 * clear_session(sessionId,request, callback)
 *
 * parameters:
 *
 * sessionId: the session id for the session with the validated client
 *
 * request: the request object, most likely any request to this web
 *          server.  It needs to be a request that can see the global
 *          sessionStore, so if you have multiple servers running
 *          cas_validate this method might fail (untested in that
 *          situation).  It is used only to access the global session
 *          store for the web server, so another option is to pass an
 *          object {sessionStore:[the relevant session store]}
 *
 * callback: a function to call when done, will be passed any errors
 *
 * This method is typically called from clear_st, above.  I am
 * exposing it just because it might be useful if developing a
 * non-redis-based way of tracking st <-> sessionId key value store.
 *
 * All it does is destroy the session associated with the passed-in
 * sessionId
 *
 */

function clear_session(sessionID,req,callback){
    req.sessionStore.destroy(sessionID,function(err){
        if(err){
            logger.error(err);
        }
        logger.debug('session '+sessionID+' destroyed')
        callback && callback(err)
        return null
    })
    return null
}

exports.set_session=set_session
exports.clear_st=clear_st
exports.clear_session=clear_session
