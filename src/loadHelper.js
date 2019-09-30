import { debuglog } from 'util';

const debug = debuglog('@iopipe:trace:loadHelper');

// The module being traced might not be in the lambda NODE_PATH,
// particularly if IOpipe has been installed with lambda layers.
// So here's an attempt at a fallback.

const deriveTargetPath = manualPath => {
  const path = manualPath ? manualPath : process.env.LAMBDA_TASK_ROOT;
  if (!path) {
    return false;
  }
  const targetPath = `${path}/node_modules`;
  process.env.IOPIPE_TARGET_PATH = targetPath;
  return targetPath;
};

const appendToPath = manualPath => {
  if (!process.env || !process.env.NODE_PATH) {
    return false;
  }
  const targetPath = deriveTargetPath(manualPath);
  const pathArray = process.env.NODE_PATH.split(':');
  if (!targetPath && pathArray.indexOf(targetPath) === -1) {
    process.env.NODE_PATH = `${process.env.NODE_PATH}:${targetPath}`;
  }
  return targetPath;
};

appendToPath();

const loadModuleForTracing = async (module, path) => {
  const targetPath = path ? path : process.env.IOPIPE_TARGET_PATH;
  let loadedModule;
  try {
    loadedModule = await require(module);
  } catch (e) {
    debug(`Unable to load ${module} from require; trying TASK_ROOT path.`, e);
    try {
      if (targetPath) {
        loadedModule = await require(`${targetPath}/${module}`);
      }
    } catch (err) {
      debug(`Unable to load ${module} from path ${targetPath}`, err);
    }
  }

  return loadedModule;
};

export default loadModuleForTracing;
