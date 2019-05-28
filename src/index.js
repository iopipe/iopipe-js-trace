import Perf from 'performance-node';

import pkg from '../package.json'; // eslint-disable-line import/extensions
import {
  addToReport,
  addHttpTracesToReport,
  addRedisTracesToReport
} from './addToReport';
import { wrap as httpWrap, unwrap as httpUnwrap } from './plugins/https';
import {
  wrap as ioRedisWrap,
  unwrap as ioRedisUnwrap
} from './plugins/ioredis';

function getBooleanFromEnv(key = '') {
  const isFalsey =
    ['false', 'f', '0'].indexOf(
      (process.env[key] || '').toString().toLowerCase()
    ) > -1;
  if (isFalsey) {
    return false;
  }
  return Boolean(process.env[key]);
}

function getConfig(config = {}) {
  const {
    autoMeasure = true,
    autoHttp = { enabled: true },
    autoIoRedis = { enabled: getBooleanFromEnv('IOPIPE_TRACE_IOREDIS') }
  } = config;
  return {
    autoHttp: {
      enabled:
        typeof autoHttp.enabled === 'boolean'
          ? autoHttp.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_AUTO_HTTP_ENABLED'),
      filter: autoHttp.filter
    },
    autoDb: {
      enabled:
        typeof autoIoRedis.enabled === 'boolean'
          ? autoIoRedis.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_IOREDIS'),
      filter: autoIoRedis.filter
    },
    autoMeasure
  };
}

function addTimelineMeasures(pluginInstance, timelineArg) {
  const timeline = timelineArg || pluginInstance.timeline;
  if (!(timeline instanceof Perf)) {
    return false;
  }
  const entries = timeline.getEntriesByType('mark');
  const names = entries
    .filter(entry => (entry.name || '').match(/^(start|end):.+/))
    .map(entry => entry.name);
  // loop through each mark and make sure there is a start and end
  // if so, measure
  names.forEach(name => {
    if (name.match(/^(start):.+/)) {
      const baseName = name.replace(/(start|end):(.+)/, '$2');
      // make sure there is an end mark as well
      if (names.find(n => n === `end:${baseName}`)) {
        timeline.measure(
          `measure:${baseName}`,
          `start:${baseName}`,
          `end:${baseName}`
        );
      }
    }
  });
  return true;
}

function recordAutoHttpData(plugin) {
  addTimelineMeasures(plugin, plugin.autoHttpData.timeline);
  addHttpTracesToReport(plugin);
  plugin.autoHttpData.timeline.clear();
  plugin.autoHttpData.data = {};
}

function recordAutoIoRedisData(plugin) {
  addTimelineMeasures(plugin, plugin.autoIoRedisData.timeline);
  addRedisTracesToReport(plugin);
  plugin.autoIoRedisData.timeline.clear();
  plugin.autoIoRedisData.data = {};
}

class TracePlugin {
  constructor(config = {}, invocationInstance) {
    this.invocationInstance = invocationInstance;
    this.config = getConfig(config);
    this.metrics = [];
    this.timeline = new Perf({ timestamp: true });
    this.hooks = {
      'post:setup': this.postSetup.bind(this),
      'post:invoke': this.postInvoke.bind(this),
      'pre:report': this.preReport.bind(this)
    };
    if (this.config.autoHttp.enabled) {
      this.autoHttpData = {
        timeline: new Perf({ timestamp: true }),
        // object to store data about traces that will make it into the report later
        data: {},
        config: this.config.autoHttp
      };
      httpWrap(this.autoHttpData);
    }
    if (this.config.autoDb.enabled) {
      this.autoIoRedisData = {
        timeline: new Perf({ timestamp: true }),
        // object to store data about traces that will make it into the report later
        data: {},
        config: this.config.autoDb
      };
      ioRedisWrap(this.autoIoRedisData);
    }

    return this;
  }
  get meta() {
    return { name: pkg.name, version: pkg.version, homepage: pkg.homepage };
  }
  postSetup() {
    this.invocationInstance.context.iopipe.mark = {
      start: this.start.bind(this),
      end: this.end.bind(this)
    };
    this.invocationInstance.context.iopipe.measure = this.measure.bind(this);
    this.invocationInstance.report.report.httpTraceEntries = [];
    this.invocationInstance.report.report.dbTraceEntries = [];
  }
  postInvoke() {
    if (this.config.autoHttp.enabled) {
      httpUnwrap();
    }
    if (this.config.autoDb.enabled) {
      ioRedisUnwrap();
    }
    if (
      typeof this.invocationInstance.context.iopipe.label === 'function' &&
      this.timeline.getEntries().length > 0
    ) {
      this.invocationInstance.context.iopipe.label('@iopipe/plugin-trace');
    }
  }
  preReport() {
    if (this.config.autoMeasure) {
      addTimelineMeasures(this);
    }
    if (this.config.autoHttp.enabled) {
      recordAutoHttpData(this);
    }
    if (this.config.autoDb.enabled) {
      recordAutoIoRedisData(this);
    }
    addToReport(this);
  }
  start(name) {
    this.timeline.mark(`start:${name}`);
  }
  end(name) {
    this.timeline.mark(`end:${name}`);
  }
  measure(name, startMark, endMark) {
    this.timeline.measure(
      `measure:${name}`,
      `start:${startMark}`,
      `end:${endMark}`
    );
  }
}

module.exports = function instantiateTracePlugin(pluginOpts) {
  return invocationInstance => {
    return new TracePlugin(pluginOpts, invocationInstance);
  };
};
