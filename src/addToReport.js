import { unflatten } from 'flat';

function headersObjToArray(headerObj) {
  return Object.keys(headerObj || {}).map(key => {
    return { key, string: headerObj[key] };
  });
}

export function addToReport(pluginInstance, timelineArg) {
  const { timeline, invocationInstance } = pluginInstance;
  const entries = (timelineArg || timeline).getEntries();
  const { report } = invocationInstance.report;
  report.performanceEntries = (report.performanceEntries || []).concat(entries);
}

export function addHttpTracesToReport(plugin) {
  const { autoHttpData: { timeline = {} } } = plugin;
  const { report: { report = {} } = {} } = plugin.invocationInstance;
  Object.keys(plugin.autoHttpData.data).forEach(id => {
    const obj = unflatten(plugin.autoHttpData.data[id] || {});
    if (obj.request) {
      obj.request.headers = headersObjToArray(obj.request.headers);
    }
    if (obj.response) {
      obj.response.headers = headersObjToArray(obj.response.headers);
    }
    // use start mark for startTime in case the http call did not finish / no callback
    // and we do not have a measurement
    const [startMark = {}] = timeline.getEntriesByName(`start:${id}`) || [];
    const [measureMark = {}] = timeline.getEntriesByName(`measure:${id}`) || [];
    obj.timestamp = startMark.timestamp || 0;
    obj.startTime = startMark.startTime || 0;
    obj.duration = measureMark.duration || 0;
    report.httpTraceEntries.push(obj);
  });
}
