'use strict';


// 3rd-party
var _     = require('underscore');
var async = require('async');
var Hash  = require('types').Hash;


// internal
var prop    = require('../common').prop;
var getter  = require('../common').getter;
var Asset   = require('./asset');


var ProcessedAsset = module.exports = function ProcessedAsset(environment, logical_path, pathname) {
  Asset.call(this, environment, logical_path, pathname);
};


require('util').inherits(ProcessedAsset, Asset);


function resolve_dependencies(self, paths, callback) {
  var assets = [], cache = new Hash(), done;

  // async callback
  done = function (err) {
    callback(err, assets);
  };

  async.forEachSeries(paths, function (p, next) {
    var asset;

    if (p === self.pathname) {
      if (!cache.hasKey(self)) {
        cache.set(self, true);
        assets.push(self);
      }
      next();
      return;
    }

    asset = self.environment.findAsset(p, {bundle: false});
    if (asset) {
      asset.compile(function (err, asset) {
        if (err) {
          next(err);
          return;
        }

        asset.__requiredAssets__.forEach(function (asset_dependency) {
          if (!cache.hasKey(asset_dependency)) {
            cache.set(asset_dependency, true);
            assets.push(asset_dependency);
          }
        });

        next();
      });
      return;
    }

    // else
    next();
  }, done);
}


function build_required_assets(self, context, callback) {
  var assets, stubs;

  async.series([
    function (next) {
      var paths = context.__requiredPaths__.concat([self.pathname]);
      resolve_dependencies(self, paths, function (err, arr) {
        assets = arr;
        next(err);
      });
    },
    function (next) {
      var paths = context.__requiredPaths__.concat([self.pathname]);
      resolve_dependencies(self, context.__stubbedAssets__.toArray(), function (err, arr) {
        stubs = arr;
        next(err);
      });
    },
    function (next) {
      prop(self, '__requiredAssets__', _.without(assets, stubs));
      next();
    }
  ], callback);
}


function build_dependency_paths(self, context, callback) {
  callback();
}


function compute_dependency_digest(self) {
  return null;
}


ProcessedAsset.prototype.compile = function (callback) {
  var self = this, Klass, context, processors, options, source = "";

  // do not compile again once asset was compiled
  if (this.__source__) {
    callback(null, this);
    return;
  }

  // prepare to build ourself
  Klass       = this.environment.ContextClass;
  context     = new Klass(this.environment, this.logical_path, this.pathname);

  context.evaluate(self.pathname, options, function (err, source) {
    var tasks;

    if (err) {
      callback(err);
      return;
    }

    // save rendered string
    prop(self, '__source__', source);

    // update some props
    self.length = source.length;
    self.digest = self.environment.digest.update(source).digest('hex');

    // run after-compile tasks
    tasks = [
      function (next) { build_required_assets(self, context, next); },
      function (next) { build_dependency_paths(self, context, next); }
    ];

    async.series(tasks, function (err) {
      prop(self, '__dependencyDigest__', compute_dependency_digest(self));
      callback(err, self);
    });
  });
};


/**
 *  ProcessedAsset#source -> String
 *
 *  Get asset's processed content with all requried dependencies.
 *
 *
 *  ##### Throws Error
 *
 *  - When called before [[ProcessedAsset#compile]]
 **/
getter(ProcessedAsset.prototype, 'source', function () {
  if (!this.__source__) {
    throw new Error("Can't read body. Asset wasn't compiled yet.");
  }

  return this.__source__;
});