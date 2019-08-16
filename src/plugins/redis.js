import { debuglog } from 'util';
import shimmer from 'shimmer';
import redis from 'redis';
import Perf from 'performance-node';
import uuid from 'uuid/v4';

const debug = debuglog('@iopipe/trace');

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

function wrap({ timeline, data = {} } = {}) {
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

      if (!cmd.__iopipeTraceId) {
        // console.log('applying id to command!', id);
        cmd.__iopipeTraceId = id;
      }

      if (!data[id]) {
        data[id] = {
          name: cmd.command,
          dbType: 'Redis',
          request: filterRequest(cmd, context)
        };
      }

      // console.log('@@@@@');
      // console.log('timestamp', new Date().getTime());
      // console.log(id, data[id].name, data[id].request.key);
      // console.log('cmd,', cmd);
      // console.log('@@@@@');
      //
      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        timeline.mark(`start:${id}`);

        cmd.callback = function wrappedInternalCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          //console.log('CALLED!', id, cmd, arguments)
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
  const target = redis.RedisClient && redis.RedisClient.prototype;

  if (process.env.IOPIPE_TRACE_REDIS_CB) {
    shimmer.unwrap(target, 'send_command');
  } else {
    shimmer.unwrap(target, 'internal_send_command');
  }
  delete redis.__iopipeShimmer;
}

export { unwrap, wrap };
