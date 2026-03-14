import gulp from 'gulp';
import path from 'path';
import { CONFIGS } from './script/constant';
import { resolveMinimal, INJECTOR_SCOPE, ROOT_SCOPE, Injector } from '@hwy-fm/di';
import { BuildScript } from './script/build-script';

const namespace = '@hwy-fm/';
const version = '0.0.1-beta.9.4';

const pkg = (name: string, options: any = {}) => {
  const { src = `university/${name}`, alias = name, ...rest } = options;
  return { src, buildName: `${namespace}${alias}`, version, ...rest };
};

const configs = {
  namespace,
  version,
  // rootOutDir: '/Users/XiangNi/work/SG-EPOS/epos-proxy/node_modules/@hwy-fm',
  rootOutDir: path.join(__dirname, '.'),
  buildConfig: {
    types: {
      folder: '',
      exports: { types: 'types' }
    },
    esm5: {
      builder: { target: 'es5', module: 'ESNext' },
      exports: { browser: 'module' }
    },
    esm: {
      builder: { target: 'es2015', module: 'ESNext' },
      exports: { import: 'import' }
    },
    cjs: {
      builder: { target: 'es5', module: 'CommonJs' },
      exports: { node: 'main', require: 'main' }
    },
    default: {
      folder: 'esm5',
      exports: { default: 'module' }
    }
  },
  packages: {
    di: pkg('di', {
      generateDep: true,      // 自动分析并生成 package.json 中的 dependencies
      sideEffects: true,      // 标记为有副作用，防止被 Tree-shaking 误删 (如全局注册代码)
      forceAutoExports: true,  // 即便有副作用，也强制自动生成 exports 字段
      exclude: ['__tests__/**'],
      // skipBuild: true
    }),
    kernel: pkg('kernel', {
      generateDep: true,
      sideEffects: true,
      forceAutoExports: true,
      exclude: ['__tests__/**'],
      minify: true,
    }),
    std: pkg('std', {
      generateDep: true,
      sideEffects: true,
      exclude: ['__tests__/**'],
      forceAutoExports: true,
    }),
    cli: pkg('cli', {
      generateDep: true,
      sideEffects: true,
      forceAutoExports: true,
      exclude: ['__tests__/**'],
      bin: { 'hwy': './bin/cli.mjs' },  // CLI 可执行命令
      copyBin: true,                         // 复制 bin 目录到输出
    }),
    // core: pkg('core'),
    // csr: pkg('csr'),
    // ssr: pkg('ssr'),
    // server: pkg('server'),
    // 'dynamic-builder': pkg('dynamic-builder', { alias: 'builder', sideEffects: true }),
    // 'dynamic-plugin': pkg('dynamic-plugin', { alias: 'plugin', sideEffects: true }),
    // 'ts-tools/dist': pkg('ts-tools/dist', {
    //   src: 'ts-tools/tools',  // 指定源码目录
    //   alias: 'ts-tools',      // 包的别名 (最终包名一部分)
    //   sideEffects: true,      // 标记副作用
    //   bin: { 'ts-tools': './bin/ts-tools.js' }, // 注册可执行命令
    //   files: ['bin', 'dist'], // 指定 npm 发布包含的文件/目录
    //   packageJsonOutDir: '../', // package.json 输出位置 (相对构建根目录)
    //   exports: {              // 手动配置 exports 导出映射
    //     '.': {
    //       types: './index.d.ts',
    //       import: './esm/index.js',
    //       require: './cjs/index.js'
    //     }
    //   }
    // })
  }
};

const providers = [
  { provide: CONFIGS, useValue: configs },
  { provide: INJECTOR_SCOPE, useValue: ROOT_SCOPE },
];

const [buildScript] = resolveMinimal(BuildScript, Injector.create(providers));
const tasks = buildScript.buildAll();

const taskNames: string[] = [];
tasks.forEach(([name, task]: any) => {
  gulp.task(name, task);
  taskNames.push(name);
});

gulp.task('default', gulp.series(...taskNames));
