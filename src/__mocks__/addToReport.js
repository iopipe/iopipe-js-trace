export const invocations = [];

export function addToReport(pluginInstance, timelineArg) {
  const { timeline, invocationInstance } = pluginInstance;
  const entries = (timelineArg || timeline).getEntries();
  const { report } = invocationInstance.report;
  report.performanceEntries = (report.performanceEntries || []).concat(entries);
  invocations.push(invocationInstance);
}
