import Perf from 'performance-node';
import pkg from '../package.json'; // eslint-disable-line import/extensions
import { addToReport, addTraceData } from './addToReport';

const loadPlugin = plugin => {
  /*eslint-disable camelcase, no-undef*/
  if (typeof __non_webpack_require__ === 'function') {
    return __non_webpack_require__(`./plugins/${plugin}`);
  }
  return import(`./plugins/${plugin}`);
};

const plugins = {
  https: {
    config: 'autoHttp',
    flag: 'IOPIPE_TRACE_AUTO_HTTP_ENABLED',
    entries: 'httpTraceEntries'
  },
  ioredis: {
    config: 'autoIoRedis',
    flag: 'IOPIPE_TRACE_IOREDIS',
    entries: 'dbTraceEntries'
  },
  mongodb: {
    config: 'autoMongoDb',
    flag: 'IOPIPE_TRACE_MONGODB',
    entries: 'dbTraceEntries'
  },
  redis: {
    config: 'autoRedis',
    flag: 'IOPIPE_TRACE_REDIS',
    entries: 'dbTraceEntries'
  }
};

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
    autoHttp = {
      enabled:
        typeof process.env.IOPIPE_TRACE_AUTO_HTTP_ENABLED === 'undefined'
          ? true
          : getBooleanFromEnv('IOPIPE_TRACE_AUTO_HTTP_ENABLED')
    },
    autoIoRedis = { enabled: getBooleanFromEnv('IOPIPE_TRACE_IOREDIS') },
    autoMongoDb = { enabled: getBooleanFromEnv('IOPIPE_TRACE_MONGODB') },
    autoRedis = { enabled: getBooleanFromEnv('IOPIPE_TRACE_REDIS') }
  } = config;
  return {
    autoHttp: {
      enabled:
        typeof autoHttp.enabled === 'boolean'
          ? autoHttp.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_AUTO_HTTP_ENABLED'),
      filter: autoHttp.filter
    },
    autoIoRedis: {
      enabled:
        typeof autoIoRedis.enabled === 'boolean'
          ? autoIoRedis.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_IOREDIS')
    },
    autoMongoDb: {
      enabled:
        typeof autoMongoDb.enabled === 'boolean'
          ? autoMongoDb.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_MONGODB')
    },
    autoRedis: {
      enabled:
        typeof autoRedis.enabled === 'boolean'
          ? autoRedis.enabled
          : getBooleanFromEnv('IOPIPE_TRACE_REDIS')
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

function recordData(plugin, type) {
  const namespace = `${plugins[type].config}Data`;
  addTimelineMeasures(plugin, plugin[namespace].timeline);
  addTraceData(plugin, plugins[type]);
  plugin[namespace].timeline.clear();
  plugin[namespace].data = {};
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

    const context = this;
    const pluginKeys = Object.keys(plugins);

    pluginKeys.map(async k => {
      const conf = plugins[k].config;
      const namespace = `${conf}Data`;

      if (context.config[conf] && context.config[conf].enabled) {
        // getting plugin; allows this to be loaded only if enabled.
        await loadPlugin(`${k}`).then(async mod => {
          plugins[k].wrap = await mod.wrap;
          plugins[k].unwrap = mod.unwrap;
          context[namespace] = {
            timeline: new Perf({ timestamp: true }),
            // object to store data about traces that will make it into the report later
            data: {},
            config: context.config[conf]
          };
          plugins[k].wrap(context[namespace]);
        });
      }
    });

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
    const context = this;
    const pluginKeys = Object.keys(plugins);
    pluginKeys.forEach(k => {
      const conf = plugins[k].config;
      if (context.config[conf].enabled) {
        if (plugins[k].unwrap && typeof plugins[k].unwrap === 'function') {
          plugins[k].unwrap();
        }
      }
    });

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
    const context = this;
    const pluginKeys = Object.keys(plugins);
    pluginKeys.forEach(k => {
      const conf = plugins[k].config;
      if (this.config[conf].enabled) {
        recordData(context, k);
      }
    });
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
