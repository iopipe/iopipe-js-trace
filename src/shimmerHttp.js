import http from 'http';
import https from 'https';
import url from 'url';
import { debuglog } from 'util';
import shimmer from 'shimmer';
import Perf from 'performance-node';
import uuid from 'uuid/v4';
import pickBy from 'lodash.pickby';
import isArray from 'isarray';
import { flatten } from 'flat';

const debug = debuglog('@iopipe/trace');

/*eslint-disable babel/no-invalid-this*/

function unwrap() {
  [http, https].forEach(mod => {
    ['get', 'request'].forEach(method => {
      if (mod[method].__wrapped) {
        shimmer.unwrap(mod, method);
      }
    });
    delete mod.__iopipeShimmer;
  });
}

function wrapHttpGet(mod) {
  return (options, cb) => {
    const req = mod.request(options, cb);
    req.end();
    return req;
  };
}

// these are keys that are mostly node specific and come from the actual js request object
const unnecessaryReqKeys = [
  'accept-encoding',
  'agent',
  'automaticFailover',
  'cache',
  'decompress',
  'followRedirect',
  'host',
  'href',
  'retries',
  'slashes',
  'search',
  'strictTtl',
  'throwHttpErrors',
  'useElectronNet',
  'user-agent'
];

function excludeUnnecessaryReqKeys(obj) {
  return pickBy(obj, (v, k) => unnecessaryReqKeys.indexOf(k) === -1);
}

function getReqDataObject(rawOptions, protocol) {
  const reqDataObj = Object.assign({}, rawOptions);
  // some libraries (superagent) do not pass protocol and pathname, which is problematic when trying to use url.format - set sensible defaults
  reqDataObj.protocol = reqDataObj.protocol || protocol;
  reqDataObj.pathname = reqDataObj.pathname || reqDataObj.path;

  const href =
    typeof rawOptions === 'string' ? rawOptions : url.format(reqDataObj);
  const originalObj =
    typeof rawOptions === 'string' ? { href: rawOptions } : rawOptions;

  const data = Object.assign({}, originalObj, url.parse(href));

  // ensure url key is present with original URI, it can be slightly transformed by url.format
  data.url = href;

  // simple rename
  data.query = data.search;

  // sometimes request headers come in as an array
  // record each header value individually as a new custom metric
  Object.keys(data.headers || {}).forEach(k => {
    if (isArray(data.headers[k])) {
      data.headers[k].forEach((innerHeaderValue, index) => {
        data.headers[`${k}.${index}`] = innerHeaderValue;
      });
    }
  });

  // delete duplicate or extraneous keys
  return excludeUnnecessaryReqKeys(data);
}

const initialResKeys = ['headers', 'statusCode', 'statusMessage'];

function getResDataObject(res) {
  return pickBy(res, (v, k) => initialResKeys.indexOf(k) > -1);
}

const defaultKeysToRecord = [
  'request.headers.user-agent',
  'request.headers.accept-encoding',
  'request.method',
  'request.path',
  'request.protocol',
  'request.port',
  'request.hostname',
  'request.hash',
  'request.pathname',
  'request.url',
  'request.query',
  'response.headers.cache-control',
  'response.headers.content-type',
  'response.headers.date',
  'response.headers.etag',
  'response.headers.strict-transport-security',
  'response.headers.content-encoding',
  'response.headers.content-length',
  'response.headers.age',
  'response.headers.connection',
  'response.headers.server',
  'response.headers.vary',
  'response.statusCode',
  'response.statusMessage'
];

function filterData(config = {}, completeHttpObj = {}) {
  const whitelistedObject = pickBy(
    completeHttpObj,
    (v, k) => defaultKeysToRecord.indexOf(k) > -1
  );
  if (typeof config.filter === 'function') {
    return config.filter(whitelistedObject, completeHttpObj);
  }
  return whitelistedObject;
}

function wrapHttpRequest({
  timeline,
  data: moduleData = {},
  config = {},
  protocol
}) {
  return function wrapper(original) {
    return function execute(rawOptions, originalCallback) {
      // bail if we have already started tracking this request
      // this can happen by calling https.request(opts)
      // which ends up calling http.request(opts)
      if (originalCallback && originalCallback.__iopipeTraceId) {
        return original.apply(this, [rawOptions, originalCallback]);
      }

      // id of this particular trace
      const id = uuid();
      // start the trace
      timeline.mark(`start:${id}`);

      // setup http trace data that will be sent to IOpipe later
      moduleData[id] = {};
      moduleData[id].request = getReqDataObject(rawOptions, protocol);

      // the func to execute at the end of the http call
      function extendedCallback(res) {
        timeline.mark(`end:${id}`);
        // add full response data
        moduleData[id].response = getResDataObject(res);
        // flatten object for easy transformation/filtering later
        moduleData[id] = flatten(moduleData[id]);
        moduleData[id] = filterData(config, moduleData[id]);

        // if filter function returns falsey value, drop all data completely
        if (typeof moduleData[id] !== 'object') {
          timeline.data = timeline.data.filter(
            d => !new RegExp(id).test(d.name)
          );
          delete moduleData[id];
        }

        if (typeof originalCallback === 'function') {
          return originalCallback.apply(this, [res]);
        }
        return true;
      }

      // add traceId to callback so we do not create duplicate data from inner http calls
      // this can happen for the https module which calls the http module internally
      extendedCallback.__iopipeTraceId = id;

      return original.apply(this, [rawOptions, extendedCallback]);
    };
  };
}

function wrap({ timeline, data = {}, config = {} } = {}) {
  if (!(timeline instanceof Perf)) {
    debug(
      'Timeline passed to shimmerHttp.wrap not an instance of performance-node. Skipping.'
    );
    return false;
  }

  if (!http.__iopipeShimmer) {
    shimmer.wrap(http, 'get', () => wrapHttpGet(http));
    shimmer.wrap(
      http,
      'request',
      wrapHttpRequest({ timeline, data, config, protocol: 'http' })
    );
    http.__iopipeShimmer = true;
  }

  if (!https.__iopipeShimmer) {
    shimmer.wrap(https, 'get', () => wrapHttpGet(https));
    shimmer.wrap(
      https,
      'request',
      wrapHttpRequest({ timeline, data, config, protocol: 'https' })
    );
    https.__iopipeShimmer = true;
  }

  return true;
}

export { unwrap, wrap };
