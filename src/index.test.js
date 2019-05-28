import _ from 'lodash';
import delay from 'delay';
import iopipe from '@iopipe/core';
import mockContext from 'aws-lambda-mock-context';
import Perf from 'performance-node';

import pkg from '../package';
import { unwrap } from './plugins/https';

const tracePlugin = require('.');

const allowedHeadersInSnapshot = [
  'vary',
  'server',
  'content-type',
  'user-agent'
];

const defaultGotOptions = {
  headers: { 'user-agent': 'iopipe-test' }
};

function getTracesFromInspectableInv(inv) {
  const { httpTraceEntries = [] } = inv.report.report;
  expect(httpTraceEntries).toHaveLength(1);
  httpTraceEntries.forEach(trace => {
    // other headers may change so they are bad for snapshots
    trace.request.headers = trace.request.headers.filter(({ key }) =>
      allowedHeadersInSnapshot.includes(key)
    );
    trace.response.headers = trace.response.headers.filter(({ key }) =>
      allowedHeadersInSnapshot.includes(key)
    );
    // delete these keys because they always change, bad for snapshots
    delete trace.startTime;
    delete trace.timestamp;
    delete trace.duration;
  });
  return httpTraceEntries;
}

beforeEach(() => {
  unwrap();
});

afterEach(() => {
  delete process.env.IOPIPE_TRACE_AUTO_HTTP_ENABLED;
});

test('Can instantiate the plugin with no options', () => {
  process.env.IOPIPE_TRACE_AUTO_HTTP_ENABLED = 'true';
  const plugin = tracePlugin();
  const inst = plugin({});
  expect(_.isFunction(inst.hooks['post:setup'])).toBe(true);
  expect(_.isFunction(inst.postSetup)).toBe(true);
  expect(_.isFunction(inst.hooks['pre:report'])).toBe(true);
  expect(_.isFunction(inst.preReport)).toBe(true);
  expect(_.isPlainObject(inst.config)).toBe(true);
  expect(inst.timeline instanceof Perf).toBe(true);
  expect(inst.config.autoMeasure).toBe(true);
  expect(inst.config.autoHttp.enabled).toBe(true);
  expect(inst.meta.name).toBe('@iopipe/trace');
  expect(inst.meta.version).toBe(pkg.version);
  expect(inst.meta.homepage).toBe(pkg.homepage);
});

test('Works with iopipe', async () => {
  try {
    let inspectableInv, testStartDate, testEndDate;
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [tracePlugin(), inv => (inspectableInv = inv)]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const { mark, measure } = context.iopipe;
      testStartDate = Date.now() - 1;
      mark.start('test');
      await delay(10);
      mark.start('extra');
      mark.end('test');
      await delay(10);
      mark.end('extra');
      measure('custom-measure', 'test', 'extra');
      testEndDate = Date.now() + 1;
      context.succeed('wow');
    });

    const context = mockContext({ functionName: 'test-1a' });
    wrappedFn({}, context);

    const val = await context.Promise;
    expect(val).toBe('wow');

    // run 2 invocations, to more accurately determine trace durations
    const context2 = mockContext({ functionName: 'test-1b' });
    wrappedFn({}, context2);

    await context2.Promise;
    const { performanceEntries, labels } = inspectableInv.report.report;

    expect(labels).toContain('@iopipe/plugin-trace');
    expect(performanceEntries).toHaveLength(7);
    const [startMark, customMeasure, measure, endMark] = performanceEntries;
    expect(_.inRange(measure.duration, 5, 20)).toBe(true);
    expect(_.isNumber(startMark.timestamp)).toBe(true);
    expect(startMark.timestamp > 15e11).toBe(true);
    expect(_.inRange(startMark.timestamp, testStartDate, testEndDate)).toBe(
      true
    );
    expect(_.inRange(endMark.timestamp, testStartDate, testEndDate)).toBe(true);
    expect(_.inRange(customMeasure.duration, 5, 29)).toBe(true);
  } catch (err) {
    throw err;
  }
});

test('Wrapped function with no traces', async () => {
  let inspectableInv;
  const iopipeInstance = iopipe({
    token: 'test',
    plugins: [tracePlugin(), inv => (inspectableInv = inv)]
  });
  const wrappedFnNoTraces = iopipeInstance((event, context) => {
    context.succeed('wow');
  });
  const context = mockContext({ functionName: 'test-1c' });
  wrappedFnNoTraces({}, context);
  await context.Promise;
  const { labels, performanceEntries } = inspectableInv.report.report;
  expect(labels).not.toContain('@iopipe/plugin-trace');
  expect(performanceEntries).toHaveLength(0);
});

test('Can disable autoMeasure', async () => {
  try {
    let inspectableInv;
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [
        tracePlugin({ autoMeasure: false }),
        inv => (inspectableInv = inv)
      ]
    });
    const wrappedFn = iopipeInstance((event, context) => {
      const { mark } = context.iopipe;
      mark.start('test');
      mark.end('test');
      context.succeed('wow');
    });
    const context = mockContext({ functionName: 'test-2' });
    wrappedFn({}, context);
    await context.Promise;
    const { performanceEntries } = inspectableInv.report.report;
    expect(performanceEntries).toHaveLength(2);
    const measure = performanceEntries.find(
      item => item.entryType === 'measure'
    );
    expect(measure).toBeUndefined();
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with got(url) plain', async () => {
  try {
    let inspectableInv;
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [
        tracePlugin({ autoHttp: { enabled: true } }),
        inv => (inspectableInv = inv)
      ]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const res = await got(
        'https://www.iopipe.com:443?test=foo#wowhash',
        defaultGotOptions
      );
      context.succeed(res.statusCode);
    });
    const context = mockContext({ functionName: 'got(url)' });
    wrappedFn({}, context);
    const result = await context.Promise;
    expect(result).toBe(200);
    const { httpTraceEntries = [] } = inspectableInv.report.report;
    expect(httpTraceEntries).toHaveLength(1);
    const [rawTrace] = inspectableInv.report.report.httpTraceEntries;
    // ensure timestamp, startTime and duration keys as they are excluded from trace later because they cannot be in the snapshot
    expect(rawTrace.timestamp).toBeGreaterThan(Date.now() - 10000);
    expect(rawTrace.startTime).toBeGreaterThan(1);
    expect(rawTrace.duration).toBeGreaterThan(1);
    const [trace] = getTracesFromInspectableInv(inspectableInv);
    expect(trace).toMatchSnapshot();
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with got(url) and options', async () => {
  try {
    let inspectableInv;
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [
        inv => (inspectableInv = inv),
        tracePlugin({
          autoHttp: {
            enabled: true,
            filter: obj => {
              // test excluding traces by arbitrary user code
              if (obj['request.query'] === '?exclude=true') {
                return false;
              }
              // test omitting certain pieces of info
              return _.omit(obj, 'request.hash');
            }
          }
        })
      ]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const [res1] = await Promise.all([
        got('https://www.iopipe.com:443?test=foo#wowhash', defaultGotOptions),
        got('https://www.iopipe.com:443?exclude=true', defaultGotOptions)
      ]);
      context.succeed(res1.statusCode);
    });
    const context = mockContext({ functionName: 'got(url)+options' });
    wrappedFn({}, context);
    const result = await context.Promise;
    expect(result).toBe(200);
    const traces = getTracesFromInspectableInv(inspectableInv);
    // we excluded traces for http calls that have ?exlude=true in url, so only 1 trace total should be present
    expect(traces).toHaveLength(1);
    expect(traces).toMatchSnapshot();
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with consecutive invocations', async () => {
  try {
    const inspectableInvs = [];
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [
        inv => inspectableInvs.push(inv),
        tracePlugin({ autoHttp: { enabled: true } })
      ]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const res = await got(
        `https://www.iopipe.com?run=${event.run}`,
        defaultGotOptions
      );
      context.succeed(res.statusCode);
    });

    const context = mockContext({ functionName: 'consecutive1' });
    wrappedFn({ run: 1 }, context);
    await context.Promise;

    const context2 = mockContext({ functionName: 'consecutive2' });
    wrappedFn({ run: 2 }, context2);
    await context2.Promise;

    const traces = _.chain(inspectableInvs)
      .map(getTracesFromInspectableInv)
      .flatten()
      .value();
    expect(traces).toHaveLength(2);
    expect(traces).toMatchSnapshot();
  } catch (err) {
    throw err;
  }
});
