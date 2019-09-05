import { debuglog } from 'util';
import shimmer from 'shimmer';
import { MongoClient, Server, Cursor, Collection } from 'mongodb';
//import * as mongodb from 'mongodb-core';
import Perf from 'performance-node';
import uuid from 'uuid/v4';

const serverOps = ['command', 'insert', 'update', 'remove'];
const collectionOps = [
  'find',
  'findOne',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany'
];
const cursorOps = ['next'];
const clientOps = ['connect', 'close', 'db'];

const clientTarget = MongoClient && MongoClient.prototype;
const collectionTarget = Collection && Collection.prototype;
const serverTarget = Server && Server.prototype;
const cursorTarget = Cursor && Cursor.prototype;

const debug = debuglog('@iopipe/trace');

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */
/*eslint-disable prefer-spread */

const createId = () => `mongodb-${uuid()}`;

const filterRequest = (params, context) => {
  const { command, args } = params;
  let host, port, db, table;
  if (!context) {
    return null;
  }

  let filteredArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].db || args[i].collection) {
      db = args[i].db ? args[i].db : null;
      table = args[i].collection ? args[i].collection : null;
    } else if (typeof args[i] === 'object' && args[i].length) {
      filteredArgs = [...filteredArgs, { ids: args[i].map(arg => arg._id) }]; //if array, return all ids.
    } else if (typeof args[i] !== 'function' && i < 2) {
      filteredArgs = [...filteredArgs, args[i]];
    }
  }

  if (context && context.s) {
    if (!host) {
      host = context.s.host ? context.s.host : null;
      if (!host) {
        host =
          context.s.clonedOptions && context.s.clonedOptions.host
            ? context.s.clonedOptions.host
            : null;
      }
    }
    if (!port) {
      port = context.s.port ? context.s.port : null;
      if (!port) {
        context.s.clonedOptions && context.s.clonedOptions.port
          ? context.s.clonedOptions.port
          : null;
      }
    }
    if (!db && context.s.namespace) {
      db = context.s.namespace.db;
    }
    if (!table && context.s.namespace) {
      table = context.s.namespace.collection;
    }
  }
  return {
    command,
    key: filteredArgs,
    hostname: host,
    port,
    db,
    table
  };
};

function wrap({ timeline, data = {} } = {}) {
  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to plugins/mongodb.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  if (!clientTarget.__iopipeShimmer) {
    shimmer.massWrap(clientTarget, clientOps, wrapCommand);
    clientTarget.__iopipeShimmer = true;
  }
  if (!collectionTarget.__iopipeShimmer) {
    shimmer.massWrap(collectionTarget, collectionOps, wrapCommand);
    collectionTarget.__iopipeShimmer = true;
  }
  if (!serverTarget.__iopipeShimmer) {
    shimmer.massWrap(serverTarget, serverOps, wrapCommand);
    serverTarget.__iopipeShimmer = true;
  }
  if (!cursorTarget.__iopipeShimmer) {
    shimmer.massWrap(cursorTarget, cursorOps, wrapCommand);
    cursorTarget.__iopipeShimmer = true;
  }

  return true;

  function wrapCommand(original, command) {
    if (typeof original !== 'function') {
      return original;
    }

    return function wrappedCommand() {
      const context = this;
      const id = createId();
      const args = Array.prototype.slice.call(arguments);
      let cb;
      for (const i in args) {
        if (typeof args[i] === 'function') {
          cb = args[i];
        }
      }
      if (!data[id]) {
        data[id] = {
          name: command,
          dbType: 'MongoDb',
          request: filterRequest({ command, args }, context)
        };
      }
      timeline.mark(`start:${id}`);
      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        cb = function wrappedCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          timeline.mark(`end:${id}`);

          return cb.apply(this, arguments);
        };
        cb.__iopipeTraceId = id;
      }
      this.__iopipeTraceId = id;
      return original.apply(this, args);
    };
  }
}

function unwrap() {
  if (serverTarget.__iopipeShimmer) {
    shimmer.massUnwrap(serverTarget, serverOps);
    delete serverTarget.__iopipeShimmer;
  }
  if (collectionTarget.__iopipeShimmer) {
    shimmer.massUnwrap(collectionTarget, collectionOps);
    delete collectionTarget.__iopipeShimmer;
  }
  if (cursorTarget.__iopipeShimmer) {
    shimmer.massUnwrap(cursorTarget, cursorOps);
    delete cursorTarget.__iopipeShimmer;
  }

  if (clientTarget.__iopipeShimmer) {
    shimmer.massUnwrap(clientTarget, clientOps); // mass just seems to hang and not complete
    delete clientTarget.__iopipeShimmer;
  }
}

export { unwrap, wrap };
