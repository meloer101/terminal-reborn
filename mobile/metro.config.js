// The phone app shares the protocol and transcript parser with the Mac app (../src/shared, PRD F22): Metro has to watch
// that folder. Packages still come from this folder's node_modules.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src/shared')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
