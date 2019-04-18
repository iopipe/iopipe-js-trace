import { debuglog } from 'util';
import crypto from 'crypto';
import shimmer from 'shimmer';
import Redis from 'ioredis';
import Perf from 'performance-node';
import uuid from 'uuid/v4';

const debug = debuglog('@iopipe/trace');

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */

const defaultInfoKeys = new Map(
  [
    'redis_version',
    'redis_build_id',
    'redis_mode',
    'os',
    'arch_bits',
    'multiplexing_api',
    'gcc_version',
    'tcp_port',
    'uptime_in_seconds',
    'uptime_in_days',
    'hz',
    'configured_hz',
    'executable',
    'config_file',
    'connected_clients',
    'client_recent_max_input_buffer',
    'client_recent_max_output_buffer',
    'blocked_clients',
    'used_memory_human',
    'used_memory_dataset_perc',
    'total_system_memory_human',
    'total_connections_received',
    'total_commands_processed',
    'rejected_connections',
    'expired_keys',
    'evicted_keys',
    'keyspace_hits',
    'keyspace_misses'
  ].map(s => [s])
);

const createId = () => `redis-${uuid()}`;

const filteredInfoResponse = str => {
  const obj = {};
  if (typeof str !== 'string') {
    return str;
  }
  const arr = String(str).split('\r\n');
  arr.forEach(val => {
    if (val.length === 0 || val[0] === '#') {
      return null;
    }
    const kv = val.split(':');
    if (defaultInfoKeys.has(kv[0])) {
      obj[kv[0]] = kv[1];
    }
    return kv;
  });
  return obj;
};

function sanitizeArgs(args) {
  // allows the first key to be included, but hashes the rest for privacy
  const newArray = [];
  if (args.length > 0) {
    newArray.push(args[0]);
  }
  if (args.length > 1) {
    const hash = crypto.createHash('sha256');
    const input = Buffer.from(args.join(), 'base64');
    hash.update(input);
    newArray.push(hash.digest('hex'));
  }
  return newArray;
}

function wrap({ timeline, data = {} } = {}) {
  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to shimmerRedis.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  if (!Redis.__iopipeShimmer) {
    shimmer.wrap(
      Redis.Command && Redis.Command.prototype,
      'initPromise',
      wrapPromise
    );
    shimmer.wrap(Redis.prototype, 'sendCommand', wrapSendCommand);

    Redis.__iopipeShimmer = true;
  }

  return true;

  function wrapPromise(original) {
    return function wrappedPromise() {
      const command = this;
      const cb = this.callback;
      const id = createId();
      const { name, args } = command;

      data[id] = {
        name,
        args: sanitizeArgs(args)
      };

      if (typeof cb === 'function' && !cb.__iopipeTraceId) {
        timeline.mark(`start:${id}`);
        this.callback = function wrappedCallback(err, response) {
          data[id].response = filteredInfoResponse(response);
          data[id].command = command;

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
      const id = createId();
      const { name, args } = command;
      data[id] = {
        name,
        args: sanitizeArgs(args)
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
  shimmer.unwrap(Redis.Command && Redis.Command.prototype, 'initPromise');
  shimmer.unwrap(Redis.prototype, 'sendCommand');
  delete Redis.__iopipeShimmer;
}

export { unwrap, wrap };
