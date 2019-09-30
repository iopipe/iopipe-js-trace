import { debuglog } from 'util';
import shimmer from 'shimmer';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import loadModuleForTracing from '../loadHelper';

const debug = debuglog('@iopipe:trace:ioredis');

let Redis;

loadModuleForTracing('ioredis')
  .then(module => {
    Redis = module;
    return module;
  })
  .catch(e => {
    debug('Not loading ioredis', e);
    return false;
  });

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */

const createId = () => `ioredis-${uuid()}`;

const filterRequest = (command, context) => {
  const { name, args } = command;
  if (!context) {
    return null;
  }
  const { hostname, port, connectionName, db } = context.options;
  return {
    command: name,
    key: args[0] ? args[0] : null,
    hostname,
    port,
    connectionName,
    db
  };
};

function wrap({ timeline, data = {} } = {}) {
  if (!Redis) {
    debug('ioredis plugin not accessible from trace plugin. Skipping.');
    return false;
  }
  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to plugins/ioredis.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  if (Redis && !Redis.__iopipeShimmer) {
    if (process.env.IOPIPE_TRACE_IOREDIS_INITPROMISE) {
      shimmer.wrap(
        Redis.Command && Redis.Command.prototype,
        'initPromise',
        wrapPromise
      );
    }
    shimmer.wrap(Redis && Redis.prototype, 'sendCommand', wrapSendCommand);
    Redis.__iopipeShimmer = true;
  }

  return true;

  function wrapPromise(original) {
    return function wrappedPromise() {
      const command = this;
      const cb = this.callback;
      const id = createId();
      const { name } = command;
      data[id] = {
        name,
        dbType: 'Redis',
        request: filterRequest(command)
      };

      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        timeline.mark(`start:${id}`);
        this.callback = function wrappedCallback(err) {
          if (err) {
            data[id].error = err.message;
            data[id].errorStack = err.stack;
          }
          timeline.mark(`end:${id}`);
          return cb.apply(this, arguments);
        };
        this.callback.__iopipeTraceId = id;
      }
      return original.apply(this, arguments);
    };
  }
  function wrapSendCommand(original) {
    return function wrappedSendCommand(command) {
      const context = this;
      const id = createId();
      const { name } = command;

      data[id] = {
        name,
        dbType: 'Redis',
        request: filterRequest(command, context)
      };

      timeline.mark(`start:${id}`);

      if (typeof command.resolve === 'function') {
        this.resolve = function wrapResolve(response) {
          data[id].response = response;
          return command.resolve;
        };
        this.resolve.__iopipeTraceId = id;
      }
      if (typeof command.reject === 'function') {
        this.reject = function wrapReject(err) {
          data[id].error = err.message;
          data[id].errorStack = err.stack;
          return command.reject;
        };
        this.reject.__iopipeTraceId = id;
      }
      if (command.promise) {
        const endMark = () => {
          timeline.mark(`end:${id}`);
        };

        this.promise = command.promise;
        this.promise.__iopipeTraceId = id;

        if (typeof command.promise.finally === 'function') {
          // Bluebird and Node.js 10+
          this.promise.finally(endMark);
        } else if (typeof command.promise.then === 'function') {
          this.promise.then(endMark).catch(endMark);
        }
      }

      return original.apply(this, arguments);
    };
  }
}

function unwrap() {
  if (!Redis) {
    debug(
      'ioredis plugin not accessible from trace plugin. Nothing to unwrap.'
    );
    return false;
  }
  if (process.env.IOPIPE_TRACE_IOREDIS_INITPROMISE) {
    shimmer.unwrap(Redis.Command && Redis.Command.prototype, 'initPromise');
  }
  shimmer.unwrap(Redis && Redis.prototype, 'sendCommand');
  delete Redis.__iopipeShimmer;
  return true;
}

export { unwrap, wrap };
