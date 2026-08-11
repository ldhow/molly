const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push("sql");
// .glb isn't in Expo's default asset extension list — needed so
// require("@/assets/models/fish_1.glb") resolves to a loadable asset.
config.resolver.assetExts.push("glb");

module.exports = config;
