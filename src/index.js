import Perf from 'performance-node';
import { flatten } from 'flat';

import pkg from '../package';
import { addToReport } from './addToReport';
import { wrap as shimmerHttp } from './shimmerHttp';

const METRIC_PREFIX = '@iopipe/trace';

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
  const { autoMeasure = true, autoHttp = {} } = config;
  return {
    autoHttp: {
      enabled:
        typeof autoHttp.enabled === 'boolean'
          ? autoHttp.enabled
          : getBooleanFromEnv(process.env.IOPIPE_TRACE_AUTO_HTTP_ENABLED),
      filter: autoHttp.filter
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

function metricsFromAutoHttpData(plugin) {
  const { iopipe = {} } = plugin.invocationInstance.context;
  const recordMetric = iopipe.metric || iopipe.log;
  Object.keys(plugin.autoHttpData.data).forEach(id => {
    const objFlat = flatten(plugin.autoHttpData.data[id]);
    Object.keys(objFlat).forEach(path => {
      recordMetric(`${METRIC_PREFIX}.${id}.${path}`, objFlat[path]);
    });
    recordMetric(`${METRIC_PREFIX}.${id}.type`, 'autoHttp');
  });
}

function recordAutoHttpData(plugin) {
  addTimelineMeasures(plugin, plugin.autoHttpData.timeline);
  metricsFromAutoHttpData(plugin);
  addToReport(plugin, plugin.autoHttpData.timeline);
  plugin.autoHttpData.timeline.clear();
  plugin.autoHttpData.data = {};
}

class TracePlugin {
  constructor(config = {}, invocationInstance) {
    this.invocationInstance = invocationInstance;
    this.config = getConfig(config);
    this.metrics = [];
    this.timeline = new Perf({ timestamp: true });
    this.hooks = {
      'post:setup': this.postSetup.bind(this),
      'pre:report': this.preReport.bind(this)
    };
    if (this.config.autoHttp.enabled) {
      this.autoHttpData = {
        timeline: new Perf({ timestamp: true }),
        // arbitrary data about each trace that will end up in custom metrics
        data: {},
        config: this.config.autoHttp
      };
      shimmerHttp(this.autoHttpData);
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
  }
  preReport() {
    if (this.config.autoMeasure) {
      addTimelineMeasures(this);
    }
    if (this.config.autoHttp.enabled) {
      recordAutoHttpData(this);
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
