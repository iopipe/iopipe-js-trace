import http from 'http';
import shimmer from 'shimmer';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import pickBy from 'lodash.pickby';

/*eslint-disable babel/no-invalid-this*/

const requestKeysForMetrics = [
  'href',
  'method',
  'search',
  'pathname',
  'hash',
  'host',
  'protocol'
];

export default function autoHttp({
  timeline = new Perf(),
  data: moduleData = {}
}) {
  shimmer.wrap(http, 'get', () => {
    // we have to replace http.get since it references request through
    // a closure (so we can't replace the value it uses..)
    return (options, cb) => {
      const req = http.request(options, cb);
      req.end();
      return req;
    };
  });

  shimmer.wrap(http, 'request', function wrapper(original) {
    return function ok(rawOptions, originalCallback) {
      // options might be a string (simple href), coerce to object
      const options =
        typeof rawOptions === 'string'
          ? { href: rawOptions }
          : rawOptions || {};

      // id of this particular trace
      const id = uuid();
      // start the trace
      timeline.mark(`start:${id}`);

      // add request data that will be sent to iopipe later
      moduleData[id] = {};
      Object.assign(
        moduleData[id],
        pickBy(
          options,
          (v, k) =>
            typeof v !== 'undefined' && requestKeysForMetrics.indexOf(k) > -1
        )
      );

      const reqHeaders = {};
      // sometimes request headers come in as an array
      // make them strings to conform to our schema better
      Object.keys(options.headers).forEach(k => {
        reqHeaders[k] =
          typeof options.headers[k] === 'object' && options.headers[k].join
            ? options.headers[k].join(' ')
            : options.headers[k];
      });
      moduleData[id].req = {
        headers: reqHeaders
      };

      // the func to execute at the end of the http call
      function extendedCallback(res) {
        timeline.mark(`end:${id}`);
        moduleData[id].res = {
          headers: res.headers,
          statusCode: res.statusCode
        };
        if (originalCallback) {
          return originalCallback.apply(this, [res]);
        }
        return true;
      }

      // execute the original function with callback
      if (originalCallback) {
        return original.apply(this, [options, extendedCallback]);
      } else {
        // the user didn't specify a callback, add it as a "response" handler ourselves
        return original.apply(this, [options]).on('response', extendedCallback);
      }
    };
  });

  return http;
}
