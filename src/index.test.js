import _ from 'lodash';
import delay from 'delay';
import iopipe from 'iopipe';
import mockContext from 'aws-lambda-mock-context';
import Perf from 'performance-node';
import pkg from '../package.json';

jest.mock('./addToReport');
import Tracer from './index';
import { invocations } from './addToReport';

test('Can instantiate the plugin with no options', () => {
  const plugin = Tracer();
  const inst = plugin({});
  expect(_.isFunction(inst.hooks['post:setup'])).toBe(true);
  expect(_.isFunction(inst.postSetup)).toBe(true);
  expect(_.isFunction(inst.hooks['pre:report'])).toBe(true);
  expect(_.isFunction(inst.preReport)).toBe(true);
  expect(_.isPlainObject(inst.config)).toBe(true);
  expect(inst.timeline instanceof Perf).toBe(true);
  expect(inst.config.autoMeasure).toBe(true);
  expect(inst.meta.name).toBe(pkg.name);
  expect(inst.meta.version).toBe(pkg.version);
  expect(inst.meta.homepage).toBe(pkg.homepage);
});

test('Works with iopipe', async () => {
  try {
    const iopipeInstance = iopipe({ token: 'test', plugins: [Tracer()] });
    let testStartDate = undefined;
    let testEndDate = undefined;
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
    const context = mockContext({ functionName: 'test-1' });
    wrappedFn({}, context);

    const val = await context.Promise;
    expect(val).toBe('wow');

    const report = _.chain(invocations)
      .find(obj => obj.context.functionName === 'test-1')
      .get('report')
      .value();

    const { performanceEntries } = report.report;
    expect(performanceEntries.length).toBe(7);
    const [startMark, customMeasure, measure, endMark] = performanceEntries;
    expect(_.inRange(measure.duration, 5, 20));
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
      plugins: [Tracer({ autoMeasure: false })]
    });
    const wrappedFn = iopipeInstance(async (event, context) => {
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
    expect(performanceEntries.length).toBe(2);
    const measure = performanceEntries.find(
      item => item.entryType === 'measure'
    );
    expect(measure).toBe(undefined);
  } catch (err) {
    throw err;
  }
});
