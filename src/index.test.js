import _ from 'lodash';
import delay from 'delay';
import iopipe from '@iopipe/core';
import mockContext from 'aws-lambda-mock-context';
import Perf from 'performance-node';
import pkg from '../package';
import { invocations } from './addToReport';

const tracePlugin = require('.');

jest.mock('./addToReport');

test('Can instantiate the plugin with no options', () => {
  const plugin = tracePlugin();
  const inst = plugin({});
  expect(_.isFunction(inst.hooks['post:setup'])).toBe(true);
  expect(_.isFunction(inst.postSetup)).toBe(true);
  expect(_.isFunction(inst.hooks['pre:report'])).toBe(true);
  expect(_.isFunction(inst.preReport)).toBe(true);
  expect(_.isPlainObject(inst.config)).toBe(true);
  expect(inst.timeline instanceof Perf).toBe(true);
  expect(inst.config.autoMeasure).toBe(true);
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

    const { performanceEntries } = report.report;
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

test('Can use autoHttp', async () => {
  try {
    const iopipeInstance = iopipe({
      token: 'test',
      plugins: [tracePlugin({ autoHttp: { enabled: true } })]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
      const got = require('got');
      const res = await got('https://www.iopipe.com');
      context.succeed(res.statusCode);
    });
    const context = mockContext({ functionName: 'autoHttp' });
    wrappedFn({}, context);
    const result = await context.Promise;
    expect(result).toBe(200);
    const performanceEntries = _.chain(invocations)
      .find(obj => obj.context.functionName === 'autoHttp')
      .get('report.report.performanceEntries')
      .value();
    // performanceEntires should have start, end, and measure entries
    expect(performanceEntries).toHaveLength(3);
  } catch (err) {
    throw err;
  }
});
