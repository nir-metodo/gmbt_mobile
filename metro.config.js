const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];

config.watchFolders = [
  path.resolve(__dirname),
];

// JsSIP (the in-app phone) logs through the `debug` package, whose entry point picks its Node build (tty/util) on React Native.
// Force the browser build, which has no Node dependencies.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'debug' && /[\\/]jssip[\\/]/.test(context.originModulePath)) {
    const jssipDir = path.dirname(require.resolve('jssip/package.json'));
    return { type: 'sourceFile', filePath: require.resolve('debug/src/browser.js', { paths: [jssipDir] }) };
  }
  return (upstreamResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
