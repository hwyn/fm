import { InjectorToken } from '@hwy-fm/di';

export const CONFIGS = InjectorToken.get('CONFIGS');

export const PACKAGE_SORT_ORDER = [
  'name',
  'version',
  'description',
  'private',
  'license',
  'author',
  'homepage',
  'repository',
  'bugs',
  'keywords',
  'type',
  'engines',
  'bin',
  'main',
  'module',
  'import',
  'types',
  'typings',
  'exports',
  'files',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
];