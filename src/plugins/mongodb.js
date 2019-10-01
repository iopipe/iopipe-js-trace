import { debuglog } from 'util';
import shimmer from 'shimmer';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import get from 'lodash/get';
import loadModuleForTracing from '../loadHelper';

const debug = debuglog('@iopipe:trace:mongodb');

let MongoClient,
  Server,
  Cursor,
  Collection,
  clientTarget,
  collectionTarget,
  serverTarget,
  cursorTarget;

const loadModule = async () => {
  const mod = await loadModuleForTracing('mongodb')
    .then(module => {
      MongoClient = module.MongoClient;
      Server = module.Server;
      Cursor = module.Cursor;
      Collection = module.Collection;

      clientTarget = MongoClient && MongoClient.prototype;
      collectionTarget = Collection && Collection.prototype;
      serverTarget = Server && Server.prototype;
      cursorTarget = Cursor && Cursor.prototype;

      return module;
    })
    .catch(e => {
      debug('Not loading mongodb', e);
      return null;
    });
  return mod;
};

const dbType = 'mongodb';
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
  'deleteMany',
  'bulkWrite',
  'createIndex'
];
const cursorOps = ['next', 'filter', 'sort', 'hint', 'toArray'];
const clientOps = ['connect', 'close', 'db'];

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */
/*eslint-disable prefer-spread */

const createId = () => `mongodb-${uuid()}`;

const filterArrayArgs = args =>
  args.map(arg => {
    if (arg._id) {
      return arg._id;
    }
    return Object.keys(arg).join(', ');
  });

const extractHostAndPort = ctx => {
  let host, port, targetObj;
  const obj = ctx.s;
  const tServers = get(obj, 'topology.s.options.servers');

  if (ctx instanceof Cursor) {
    targetObj = get(ctx, 'options.db.s.topology.s.options.servers');
  } else if (tServers) {
    targetObj = tServers;
  }

  if (obj.clonedOptions) {
    host = obj.clonedOptions.host;
    port = obj.clonedOptions.port;
  } else if (targetObj && targetObj.length && targetObj.length > 0) {
    const server = targetObj[0];
    host = server.host;
    port = server.port;
  } else if (obj.url) {
    const urlArray = obj.url.split(':');
    host = urlArray[1].replace('//', '');
    port = urlArray[2];
  }
  return { host, port };
};

const extractDbAndTable = obj => {
  let db, table;
  if (!db && obj.s.namespace) {
    db = obj.s.namespace.db;
  } else if (!db && obj.namespace) {
    db = obj.namespace.db;
    table = obj.namespace.collection;
  }
  if (!table && obj.s.namespace) {
    table = obj.s.namespace.collection;
  }
  return { db, table };
};

const filterRequest = (params, context) => {
  if (!context || !context.s) {
    return null;
  }
  const { command, args } = params;
  let { host, port } = context.s;
  let db, table;

  let filteredArgs = [];
  let bulkCommands = [];

  for (let i = 0; i < args.length; i++) {
    let argData;
    const isObject = typeof args[i] === 'object';

    if (args[i].db || args[i].collection) {
      db = args[i].db ? args[i].db : null;
      table = args[i].collection ? args[i].collection : null;
    }

    if (isObject && args[i].length) {
      argData = filterArrayArgs(args[i]);
    } else if (isObject) {
      argData = Object.keys(args[i]);
    } else if (typeof args[i] !== 'function') {
      argData = args[i];
    }

    if (argData && argData.length && command === 'bulkWrite') {
      bulkCommands = [...bulkCommands, ...argData];
    } else if (typeof argData === 'object' && argData.length) {
      filteredArgs = [...filteredArgs, ...argData];
    } else if (argData) {
      filteredArgs = [...filteredArgs, argData];
    }
  }

  if (!host && !port) {
    const obj = extractHostAndPort(context);
    host = obj.host;
    port = obj.port;
  }

  if (!db) {
    const dbInfo = extractDbAndTable(context);
    db = dbInfo.db;
    table = dbInfo.table;
  }

  return {
    command,
    key:
      typeof filteredArgs === 'object' ? filteredArgs.join(', ') : filteredArgs,
    bulkCommands: bulkCommands.join(', '),
    hostname: host,
    port,
    db,
    table
  };
};

async function wrap({ timeline, data = {} } = {}) {
  await loadModule();

  if (!clientTarget) {
    debug('mongodb plugin not accessible from trace plugin. Skipping.');
    return false;
  }
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
      let cb, cbIdx, wrappedCb;

      for (const i in args) {
        if (typeof args[i] === 'function') {
          cb = args[i];
          cbIdx = i;
        }
      }
      if (!data[id]) {
        timeline.mark(`start:${id}`);
        data[id] = {
          name: command,
          dbType,
          request: filterRequest({ command, args }, context)
        };
      }

      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        wrappedCb = function wrappedCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          timeline.mark(`end:${id}`);
          return cb.apply(this, arguments);
        };
        wrappedCb.__iopipeTraceId = id;
        args[cbIdx] = wrappedCb;
      }
      this.__iopipeTraceId = id;
      return original.apply(this, args);
    };
  }
}

function unwrap() {
  if (!clientTarget) {
    debug(
      'mongodb plugin not accessible from trace plugin. Nothing to unwrap.'
    );
    return false;
  }

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
  return true;
}

export { unwrap, wrap };
