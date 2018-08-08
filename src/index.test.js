import _ from 'lodash';
import delay from 'delay';
import iopipe from '@iopipe/core';
import mockContext from 'aws-lambda-mock-context';
import Perf from 'performance-node';
import pkg from '../package';
import { invocations } from './addToReport';
import { unwrap } from './shimmerHttp';

const tracePlugin = require('.');

jest.mock('./addToReport');

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
    const iopipeInstance = iopipe({ token: 'test', plugins: [tracePlugin()] });
    let testStartDate, testEndDate;
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
    const report = _.chain(invocations)
      .find(obj => obj.context.functionName === 'test-1b')
      .get('report')
      .value();

    const { performanceEntries, labels } = report.report;
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
  const iopipeInstance = iopipe({ token: 'test', plugins: [tracePlugin()] });
  const wrappedFnNoTraces = iopipeInstance((event, context) => {
    context.succeed('wow');
  });
  const context = mockContext({ functionName: 'test-1c' });
  wrappedFnNoTraces({}, context);
  await context.Promise;
  const report = _.chain(invocations)
    .find(obj => obj.context.functionName === 'test-1c')
    .get('report.report')
    .value();
  expect(report.labels).not.toContain('@iopipe/plugin-trace');
  expect(report.performanceEntries).toHaveLength(0);
});
test('Can disable autoMeasure', async () => {
  try {
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [tracePlugin({ autoMeasure: false })]
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
    const performanceEntries = _.chain(invocations)
      .find(obj => obj.context.functionName === 'test-2')
      .get('report.report.performanceEntries')
      .value();
    expect(performanceEntries).toHaveLength(2);
    const measure = performanceEntries.find(
      item => item.entryType === 'measure'
    );
    expect(measure).toBeUndefined();
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with got(url)', async () => {
  try {
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [tracePlugin({ autoHttp: { enabled: true } })]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const res = await got('https://www.iopipe.com:443?test=foo#wowhash');
      context.succeed(res.statusCode);
    });
    const context = mockContext({ functionName: 'got(url)' });
    wrappedFn({}, context);
    const result = await context.Promise;
    expect(result).toBe(200);
    const report = _.chain(invocations)
      .find(obj => obj.context.functionName === 'got(url)')
      .get('report.report')
      .value();
    const { performanceEntries, custom_metrics: metrics } = report;
    // performanceEntires should have start, end, and measure entries
    expect(performanceEntries).toHaveLength(3);
    const expectedMetricKeys = [
      'request.method',
      'request.url',
      'response.headers.content-length',
      'response.statusCode',
      'type'
    ];
    const expectedMetrics = _.chain(metrics)
      .map('name')
      .map(str =>
        str
          .split('.')
          .slice(2)
          .join('.')
      )
      .value();
    expect(_.intersection(expectedMetrics, expectedMetricKeys)).toHaveLength(
      expectedMetricKeys.length
    );
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with got(url) and options', async () => {
  try {
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [
        tracePlugin({
          autoHttp: {
            enabled: true,
            filter: obj => {
              // test excluding traces by arbitrary user code
              return obj['request.query'] === '?exclude=true' ? false : obj;
            }
          }
        })
      ]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const [res1] = await Promise.all([
        got('https://www.iopipe.com:443?test=foo#wowhash'),
        got('https://www.iopipe.com:443?exclude=true')
      ]);
      context.succeed(res1.statusCode);
    });
    const context = mockContext({ functionName: 'got(url)+options' });
    wrappedFn({}, context);
    const result = await context.Promise;
    expect(result).toBe(200);
    const report = _.chain(invocations)
      .find(obj => obj.context.functionName === 'got(url)+options')
      .get('report.report')
      .value();
    const { performanceEntries, custom_metrics: metrics } = report;
    // performanceEntires should have start, end, and measure entries
    expect(performanceEntries).toHaveLength(3);
    const expectedMetricKeys = [
      'request.method',
      'request.url',
      'response.headers.content-length',
      'response.statusCode',
      'type'
    ];
    const expectedMetrics = _.chain(metrics)
      .map('name')
      .map(str =>
        str
          .split('.')
          .slice(2)
          .join('.')
      )
      .value();
    expect(_.intersection(expectedMetrics, expectedMetricKeys)).toHaveLength(
      expectedMetricKeys.length
    );
  } catch (err) {
    throw err;
  }
});

test('autoHttp works with consecutive invocations', async () => {
  try {
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [tracePlugin({ autoHttp: { enabled: true } })]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const res = await got(`https://www.iopipe.com?run=${event.run}`);
      context.succeed(res.statusCode);
    });

    const context = mockContext({ functionName: 'consecutive1' });
    wrappedFn({ run: 1 }, context);
    await context.Promise;

    const context2 = mockContext({ functionName: 'consecutive2' });
    wrappedFn({ run: 2 }, context2);
    await context2.Promise;

    const reports = _.chain(invocations)
      .filter(obj => obj.context.functionName.match('consecutive'))
      .map('report.report')
      .value();

    const invTraces = _.chain(reports)
      .map('performanceEntries')
      .flatten()
      .value();
    // 3 entries per trace (1 trace per invocation - 2 traces total)
    expect(invTraces).toHaveLength(6);
  } catch (err) {
    throw err;
  }
});
