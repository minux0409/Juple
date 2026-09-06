import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next ships native flat-config arrays (see node_modules/eslint-config-next/dist) -
// no @eslint/eslintrc FlatCompat bridge needed (that bridge is only for legacy .eslintrc-format
// shareable configs and produced a circular-reference crash here when used on top of an
// already-flat config).
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript];

export default eslintConfig;
