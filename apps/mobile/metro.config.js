// The shared Hermes core lives outside this app (../../packages/core) and is imported as
// @kitab/core/<module> through tsconfig paths, which Metro follows. It has no dependencies.
const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, "../../packages/core")]
module.exports = config
