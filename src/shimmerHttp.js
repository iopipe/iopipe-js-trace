import http from 'http';
import https from 'https';
import url from 'url';
import { debuglog } from 'util';
import shimmer from 'shimmer';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import pickBy from 'lodash.pickby';
import isArray from 'isarray';

const debug = debuglog('@iopipe/trace');

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

function unwrap() {
  if (http.get.__wrapped) {
    shimmer.unwrap(http, 'get');
  }
  if (http.request.__wrapped) {
    shimmer.unwrap(http, 'request');
  }
  if (https.get.__wrapped) {
    shimmer.unwrap(https, 'get');
  }
  if (https.request.__wrapped) {
    shimmer.unwrap(https, 'request');
  }
}

function wrapHttpGet(mod) {
  return (options, cb) => {
    const req = mod.request(options, cb);
    req.end();
    return req;
  };
}

function wrapHttpRequest({ timeline, data: moduleData = {} }) {
  return function wrapper(original) {
    return function execute(rawOptions, originalCallback) {
      // bail if we have already started tracking this request
      // this can happen by calling https.request(opts)
      // which ends up calling http.request(opts)
      if (originalCallback && originalCallback.__iopipeTraceId) {
        return original.apply(this, [rawOptions, originalCallback]);
      }
      // options might be a string (simple href), coerce to object
      const reqKwargs =
        typeof rawOptions === 'string'
          ? { href: rawOptions, headers: {} }
          : rawOptions || {};

      // ensure href key
      reqKwargs.href = reqKwargs.href || url.format(reqKwargs);

      // id of this particular trace
      const id = uuid();
      // start the trace
      timeline.mark(`start:${id}`);

      // add request data that will be sent to IOpipe later
      moduleData[id] = {};
      Object.assign(
        moduleData[id],
        pickBy(
          reqKwargs,
          (v, k) =>
            typeof v !== 'undefined' && requestKeysForMetrics.indexOf(k) > -1
        )
      );

      const reqHeaders = {};
      // sometimes request headers come in as an array
      // make them strings to conform to our schema better
      Object.keys(reqKwargs.headers || {}).forEach(k => {
        reqHeaders[k] = isArray(reqKwargs.headers[k])
          ? reqKwargs.headers[k].join(' ')
          : reqKwargs.headers[k];
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

      // add traceId to callback so we do not create duplicate data from inner http calls
      // this can happen for the https module which calls the http module internally
      extendedCallback.__iopipeTraceId = id;

      // execute the original function with callback
      if (typeof originalCallback === 'function') {
        return original.apply(this, [rawOptions, extendedCallback]);
      } else {
        // the user didn't specify a callback, add it as a "response" handler ourselves
        return original
          .apply(this, [rawOptions])
          .on('response', extendedCallback);
      }
    };
  };
}

function wrap({ timeline, data = {} } = {}) {
  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to shimmerHttp.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  shimmer.wrap(http, 'get', () => wrapHttpGet(http));
  shimmer.wrap(http, 'request', wrapHttpRequest({ timeline, data }));

  shimmer.wrap(https, 'get', () => wrapHttpGet(https));
  shimmer.wrap(https, 'request', wrapHttpRequest({ timeline, data }));

  return true;
}

export { unwrap, wrap };
