import Perf from 'performance-node';

import { addToReport } from './addToReport';

function getConfig(config = {}) {
  const { autoMeasure = true } = config;
  return {
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
    .filter(entry => (entry.name || '').match(/^(start|end)\:.+/))
    .map(entry => entry.name);
  // loop through each mark and make sure there is a start and end
  // if so, measure
  names.forEach(name => {
    if (name.match(/^(start)\:.+/)) {
      const baseName = name.replace(/(start|end)\:(.+)/, '$2');
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
    this.meta = {
      name: 'trace',
      version: '0.1.2',
      homepage: 'https://github.com/iopipe/iopipe-plugin-trace'
    };
    return this;
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
