import _ from 'lodash';

export const invocations = [];

export function addToReport(pluginInstance, timelineArg) {
  const { timeline, invocationInstance } = pluginInstance;
  const entries = (timelineArg || timeline).getEntries();
  const { report } = invocationInstance.report;
  report.performanceEntries = (report.performanceEntries || []).concat(entries);
  if (!_.find(invocations, i => i === invocationInstance)) {
    invocations.push(invocationInstance);
  }
}
