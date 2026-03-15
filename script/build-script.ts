import fs from 'fs';
import path from 'path';
import gulp from 'gulp';
import tsModel from 'typescript';
import ts from 'gulp-typescript';
import replace from 'gulp-replace';
import terser from 'gulp-terser';
import { Inject, Injectable } from '@hwy-fm/di';

import { CONFIGS } from './constant';
import { GeneratePackage } from './generate-package';

interface BuildOptions {
  module: string;
  src: string;
  outDir: string;
  target?: string;
  stripInternal?: boolean;
  exclude?: string[];
  minify?: boolean;
}

@Injectable()
export class BuildScript {
  private readonly namespace: string;
  private readonly replaceRegexp: RegExp | string;
  private readonly configPaths: Record<string, string[]>;

  constructor(@Inject(CONFIGS) private configs: any, private generatePackage: GeneratePackage) {
    this.namespace = this.configs.namespace;
    this.replaceRegexp = this.namespace === '@hwy-fm/' ? this.namespace : /@hwy-fm\//ig;
    this.configPaths = this.resolveConfigPaths();
  }

  /**
   * Main Entry Point
   */
  public buildAll() {
    return Object.keys(this.configs.packages)
      .filter(name => !this.configs.packages[name].skipBuild)
      .map(name => this.createPackageTasks(name));
  }

  private createPackageTasks(name: string): [string, any] {
    const config = this.configs.packages[name];
    const context = this.createTaskContext(name, config);
    const { src, ignore, clearDir } = config;

    const clearTask = this.withName(`${name}:clear`, () =>
      this.cleanDirectory(context.outDir, clearDir, ignore)
    );

    const mainTask = this.withName(`${name}:types`,
      this.createBuildTask({ module: 'ESNext', src, outDir: context.outDir, stripInternal: true, exclude: config.exclude })
    );

    const copyTask = this.withName(`${name}:copy`, () => {
      const globs = [`${src}/*.md`, `${src}/LICENSE`];
      if (config.copyBin) globs.push(`${src}/bin/**/*`);
      return gulp.src(globs, { allowEmpty: true, base: src }).pipe(gulp.dest(context.outDir));
    });

    const variantTasks = this.createVariantTasks(name, src, context.outDir, config.exclude, config.minify);

    const packageTask = this.withName(`${name}:package`, config.packageJson !== false
      ? this.generatePackage.generate(context.outDir, { ...config, buildName: context.buildName })
      : (done: any) => done()
    );

    return [name, gulp.series(clearTask, mainTask, gulp.parallel(copyTask, ...variantTasks), packageTask)];
  }

  private createVariantTasks(name: string, src: string, packageRoot: string, exclude?: string[], minify?: boolean) {
    return Object.entries(this.configs.buildConfig)
      .filter(([_, config]: any) => !!config.builder)
      .map(([folder, config]: any) => {
        const { target, module } = config.builder;
        const outDir = config.folder ?? folder;

        let task = this.createBuildTask({ module, src, outDir: path.join(packageRoot, outDir), target, exclude, minify });

        if (module === 'CommonJs') {
          const originalTask = task;
          task = () => {
            return originalTask().on('finish', () => {
              this.writeCommonJsPackage(path.join(packageRoot, outDir));
            });
          };
        }

        return this.withName(`${name}-${outDir}`, task);
      });
  }

  private createTaskContext(name: string, config: any) {
    return {
      outDir: path.join(this.configs.rootOutDir, name),
      buildName: config.buildName.replace(this.replaceRegexp, this.namespace)
    };
  }

  private withName(name: string, task: any) {
    task.displayName = name;
    return task;
  }

  private createBuildTask(options: BuildOptions) {
    const { src, outDir, stripInternal, exclude } = options;

    return () => {
      const settings = this.resolveCompilerOptions(options);
      const project = ts.createProject(this.getTsConfigPath(src), settings);

      const globs = [`${src}/**/*.ts`, `${src}/**/*.tsx`];
      if (exclude?.length) {
        exclude.forEach(pattern => globs.push(`!${src}/${pattern}`));
      }

      let sourceStream = gulp.src(globs)
        .pipe(replace(this.replaceRegexp, this.namespace));

      if ((src.includes('university/di') || src.endsWith('/di')) && path.basename(outDir) !== 'esm') {
        sourceStream = sourceStream.pipe(replace(/import\s*\{\s*AsyncLocalStorage\s*\}\s*from\s*['"]async_hooks['"];?/g, 'declare const AsyncLocalStorage: any;'));
      }

      const compiledStream = sourceStream.pipe(project());

      let outputStream = (stripInternal ? compiledStream.dts : compiledStream.js);

      if (!stripInternal && options.minify) {
        outputStream = outputStream.pipe(terser({
          compress: { dead_code: true, drop_console: false },
          mangle: { keep_classnames: true, keep_fnames: true },
          output: { comments: false }
        }));
      }

      return outputStream.pipe(gulp.dest(outDir));
    };
  }

  private async cleanDirectory(dirPath: string, allow: string[] = [], ignore: string[] = ['.git']) {
    if (!fs.existsSync(dirPath)) return;

    const root = process.cwd();
    if (!path.resolve(dirPath).startsWith(root) || path.resolve(dirPath) === root) return;

    const files = await fs.promises.readdir(dirPath);
    await Promise.all(
      files
        .filter(file => allow.length ? allow.includes(file) : !ignore.includes(file))
        .map(file => fs.promises.rm(path.join(dirPath, file), { recursive: true, force: true }))
    );
  }

  private writeCommonJsPackage(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type": "commonjs"}');
  }

  private resolveCompilerOptions({ module, target = 'ESNext', outDir, stripInternal }: BuildOptions) {
    const folderName = path.basename(outDir);
    const isCommonJs = module === 'CommonJs';
    const isTypes = stripInternal === true;
    const isEsm = ['esm', 'esm5'].includes(folderName);

    const paths = { ...this.configPaths };
    const rootDir = process.cwd();

    Object.keys(paths).forEach(key => {
      paths[key] = paths[key].map(p => path.resolve(rootDir, p));
    });

    Object.entries(this.configs.packages).forEach(([pkgDirName, config]: [string, any]) => {
      const dtsPath = path.join(rootDir, pkgDirName, 'index.d.ts');
      if (fs.existsSync(dtsPath)) {
        paths[config.buildName] = [dtsPath];
      }
    });

    return {
      target,
      declaration: stripInternal,
      emitDeclarationOnly: isTypes,
      sourceMap: !isTypes && !!process.env.SOURCE_MAP,
      module,
      moduleResolution: (isCommonJs || isTypes) ? 'Node' : 'Bundler',
      resolvePackageJsonExports: !(isCommonJs || isTypes),
      baseUrl: '.',
      paths,
      isolatedModules: !isTypes,
      downlevelIteration: target === 'es5',
      getCustomTransformers: isEsm ? () => this.createEsmPathTransformer() : undefined
    };
  }

  private getTsConfigPath(src: string): string {
    return src.includes('ts-tools') ? 'ts-tools/tsconfig.json' : 'tsconfig.json';
  }

  private resolveConfigPaths() {
    const configFile = path.join(process.cwd(), 'tsconfig.json');
    const { config } = tsModel.readConfigFile(configFile, tsModel.sys.readFile);
    const paths = config?.compilerOptions?.paths || {};

    const aliasedPaths = Object.entries(paths).reduce((acc: any, [key, value]) => {
      acc[key.replace(this.replaceRegexp, this.namespace)] = value;
      return acc;
    }, {});

    return { ...paths, ...aliasedPaths };
  }

  private createEsmPathTransformer() {
    return {
      before: [
        (context: tsModel.TransformationContext) => (sourceFile: tsModel.SourceFile) =>
          this.visitNode(sourceFile, context) as tsModel.SourceFile
      ]
    };
  }

  private visitNode(node: tsModel.Node, context: tsModel.TransformationContext): tsModel.Node {
    const visitor = (child: tsModel.Node) => {
      if ((tsModel.isImportDeclaration(child) || tsModel.isExportDeclaration(child)) && child.moduleSpecifier) {
        return this.updateModuleSpecifier(child, context.factory);
      }
      return tsModel.visitEachChild(child, visitor, context);
    };
    return tsModel.visitNode(node, visitor);
  }

  private updateModuleSpecifier(node: tsModel.ImportDeclaration | tsModel.ExportDeclaration, factory: tsModel.NodeFactory) {
    const text = (node.moduleSpecifier as tsModel.StringLiteral).text;
    if (!text.startsWith('.')) return node;

    const sourceFile = node.getSourceFile();
    const absPath = path.resolve(path.dirname(sourceFile.fileName), text);
    const newText = this.resolveImportPath(text, absPath);

    if (newText === text) return node;

    const newSpecifier = factory.createStringLiteral(newText);
    return tsModel.isImportDeclaration(node)
      ? factory.updateImportDeclaration(node, node.modifiers, node.importClause, newSpecifier, node.attributes)
      : factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, newSpecifier, node.attributes);
  }

  private resolveImportPath(importPath: string, absPath: string) {
    if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
      const hasIndex = fs.existsSync(path.join(absPath, 'index.ts')) || fs.existsSync(path.join(absPath, 'index.tsx'));
      return hasIndex ? `${importPath}/index.js` : importPath;
    }

    if (fs.existsSync(`${absPath}.ts`) || fs.existsSync(`${absPath}.tsx`)) {
      return `${importPath}.js`;
    }

    return importPath;
  }
}
