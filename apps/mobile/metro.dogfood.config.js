// Used only when bundling the Android "dogfood" build variant (see android/app/build.gradle's
// `react { bundleConfig = file("../../metro.dogfood.config.js") }` override for that variant).
// Metro's bundle command runs as its own Node process per invocation (see
// BundleHermesCTask.getBundleCommand - it has no per-variant env var passthrough of its own), so
// this is the only reliable place to set JUPLE_API_ENV before Babel loads: it must be set before
// any file is transformed, so babel-plugin-transform-inline-environment-variables (see
// babel.config.js) inlines it into src/api/apiConfig.ts as a real value rather than undefined.
process.env.JUPLE_API_ENV = 'dogfood';

module.exports = require('./metro.config.js');
