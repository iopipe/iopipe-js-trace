import Perf from 'performance-node';
import { flatten } from 'flat';

import pkg from '../package';
import { addToReport } from './addToReport';
import shimmerHttp from './shimmerHttp';

const METRIC_PREFIX = '@iopipe/trace';

let autoHttpInitialized;

const moduleAutoData = {
  timeline: new Perf({ timestamp: true }),
  // arbitrary data about each trace that will end up in custom metrics
  data: {}
};

function getConfig(config = {}) {
  const {
    autoMeasure = true,
    autoHttp = Boolean(process.env.IOPIPE_TRACE_AUTO_HTTP)
  } = config;
  return {
    autoHttp,
    autoMeasure
  };
}

function addTimelineMeasures(pluginInstance) {
  const { timeline } = pluginInstance;
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

function metricsFromModuleAutoData(invocationInstance) {
  Object.keys(moduleAutoData.data).forEach(id => {
    const objFlat = flatten(moduleAutoData.data[id]);
    Object.keys(objFlat).forEach(path => {
      invocationInstance.metric(
        `${METRIC_PREFIX}.${id}.${path}`,
        objFlat[path]
      );
    });
    invocationInstance.metric(`${METRIC_PREFIX}.${id}.type`, 'autoHttp');
  });
}

function recordAutoHttpData(plugin) {
  addTimelineMeasures(moduleAutoData);
  metricsFromModuleAutoData(plugin.invocationInstance);
  addToReport({
    invocationInstance: plugin.invocationInstance,
    timeline: moduleAutoData.timeline
  });
  moduleAutoData.timeline.clear();
  moduleAutoData.data = {};
}

class TracePlugin {
  constructor(config = {}, invocationInstance) {
    this.invocationInstance = invocationInstance;
    this.config = getConfig(config);
    // be careful not to shim more than once, or we get dupe data
    if (this.config.autoHttp && !autoHttpInitialized) {
      autoHttpInitialized = true;
      shimmerHttp(moduleAutoData);
    }
    this.metrics = [];
    this.timeline = new Perf({ timestamp: true });
    this.hooks = {
      'post:setup': this.postSetup.bind(this),
      'pre:report': this.preReport.bind(this)
    };
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
    if (this.config.autoHttp) {
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
