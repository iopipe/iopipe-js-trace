import { debuglog } from 'util';
import shimmer from 'shimmer';
// import redis from 'redis';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import loadModuleForTracing from '../loadHelper';

let redis;

const debug = debuglog('@iopipe:trace:redis');

const loadModule = async () =>
  loadModuleForTracing('redis')
    .then(module => {
      redis = module;
      return module;
    })
    .catch(e => {
      debug('Not loading redis', e);
      return false;
    });

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */
/*eslint-disable prefer-spread */

const createId = () => `redis-${uuid()}`;

const filterRequest = (command, context) => {
  const { args } = command;
  if (!context) {
    return null;
  }

  const { db } = context.options;
  const { host, port } = context.connection_options;
  return {
    command: command.command,
    key: args[0] ? args[0] : null,
    hostname: host,
    port,
    db
  };
};

async function wrap({ timeline, data = {} } = {}) {
  await loadModule();
  if (!redis) {
    debug('redis plugin not accessible from trace plugin. Skipping.');
    return false;
  }

  const target = redis.RedisClient && redis.RedisClient.prototype;

  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to plugins/ioredis.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  if (!redis.__iopipeShimmer) {
    if (process.env.IOPIPE_TRACE_REDIS_CB) {
      shimmer.wrap(target, 'send_command', wrapSendCommand); // redis < 2.5.3
    } else {
      shimmer.wrap(target, 'internal_send_command', wrapInternalSendCommand);
    }
    target.__iopipeShimmer = true;
  }

  return true;

  function wrapSendCommand(original) {
    return function wrappedSendCommand() {
      const context = this;
      const args = Array.prototype.slice.call(arguments);
      const id = createId();
      const cb = args[2];

      if (!data[id]) {
        data[id] = {
          name: args[0],
          dbType: 'Redis',
          request: filterRequest({ command: args[0], args: args[1] }, context)
        };
      }

      timeline.mark(`start:${id}`);

      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        this.callback = function wrappedCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          timeline.mark(`end:${id}`);

          return this.callback.apply(this, arguments);
        };
        this.callback.__iopipeTraceId = id;
      }
      return original.apply(this, arguments);
    };
  }
  function wrapInternalSendCommand(original) {
    return function wrappedInternalSendCommand(cmd) {
      const context = this;
      const id = createId();
      const cb = cmd.callback;

      if (!data[id] && !cmd.__iopipeTraceId) {
        cmd.__iopipeTraceId = id;

        data[id] = {
          name: cmd.command,
          dbType: 'Redis',
          request: filterRequest(cmd, context)
        };
      }

      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        timeline.mark(`start:${id}`);

        cmd.callback = function wrappedInternalCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          timeline.mark(`end:${id}`);
          return cb.apply(cmd, arguments);
        };
        cmd.callback.__iopipeTraceId = id;
      }
      return original.apply(this, arguments);
    };
  }
}

function unwrap() {
  if (!redis) {
    debug('redis plugin not accessible from trace plugin. Nothing to unwrap.');
    return false;
  }
  const target = redis.RedisClient && redis.RedisClient.prototype;

  if (process.env.IOPIPE_TRACE_REDIS_CB) {
    shimmer.unwrap(target, 'send_command');
  } else {
    shimmer.unwrap(target, 'internal_send_command');
  }
  delete redis.__iopipeShimmer;
  return true;
}

export { unwrap, wrap };
