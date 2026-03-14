import fs from 'fs';
import path from 'path';
import { Injectable, Inject } from '@hwy-fm/di';
import { CONFIGS, PACKAGE_SORT_ORDER } from './constant';
import { DependencyService } from './dependency-service';
import { PackageExportService } from './package-export-service';

@Injectable()
export class GeneratePackage {

  @Inject(CONFIGS) private configs: any;
  private rootPackage: any;

  constructor(
    private dependencyService: DependencyService,
    private packageExportService: PackageExportService
  ) {
    this.rootPackage = this.readJson(path.join(process.cwd(), 'package.json'));
  }

  public generate(packageRoot: string, options: any) {
    const { src, buildName, version, sideEffects = false, generateDep = true, packageJsonOutDir, forceAutoExports = false, exclude, files, ...extraOptions } = options || {};

    const skipAutoExport = sideEffects && !forceAutoExports;

    return async () => {
      const dependencies = src ? await this.dependencyService.collect(src, exclude) : [];
      const { exports, rootFields } = this.packageExportService.getExportsAndRootFields(
        packageRoot,
        skipAutoExport,
        extraOptions.exports
      );

      const templatePackage = this.findTemplatePackage(src);

      const packageJson = this.createPackageJson({
        name: buildName,
        version,
        exports,
        rootFields,
        dependencies,
        generateDep,
        sideEffects,
        templatePackage,
        packageRoot,
        files: files || this.resolveFiles(packageRoot),
        ...extraOptions
      });

      const outputDir = packageJsonOutDir ? path.resolve(packageRoot, packageJsonOutDir) : packageRoot;
      this.writeJson(path.join(outputDir, 'package.json'), packageJson);
      return exports;
    };
  }

  private findTemplatePackage(startPath: string) {
    if (!startPath) return {};

    let current = path.resolve(process.cwd(), startPath);
    const root = process.cwd();

    while (current.length > root.length) {
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        return this.readJson(pkgPath);
      }
      current = path.dirname(current);
    }

    return {};
  }

  private createPackageJson(params: any) {
    const { name, version, exports, rootFields, dependencies, generateDep, sideEffects, templatePackage, ...extraOptions } = params;

    const packageJson = this.createBaseTemplate(name, version, exports, rootFields, extraOptions, templatePackage);

    if (sideEffects) {
      packageJson.sideEffects = sideEffects;
    }

    if (dependencies.length) {
      this.processDependencies(packageJson, name, version, dependencies, generateDep);
    }

    if (!sideEffects) {
      packageJson.sideEffects = ['*.effects.js'];
    }

    if (extraOptions.files) {
      packageJson.files = extraOptions.files;
    }

    return this.sortFields(this.cleanupPackageJson(packageJson));
  }

  private sortFields(packageJson: any) {
    const sorted: any = {};
    const keys = Object.keys(packageJson);

    PACKAGE_SORT_ORDER.forEach(key => {
      if (packageJson[key] !== undefined) {
        sorted[key] = packageJson[key];
      }
    });

    keys.forEach(key => {
      if (!PACKAGE_SORT_ORDER.includes(key)) {
        sorted[key] = packageJson[key];
      }
    });

    return sorted;
  }

  private createBaseTemplate(name: string, version: string, exports: any, rootFields: any, extraOptions: any, templatePackage: any = {}) {
    const { packageRoot, ...restOptions } = extraOptions;
    const defaultTemplate = {
      private: false,
      publishConfig: { access: 'public' },
      type: 'module',
      description: restOptions.description || this.readDescriptionFromReadme(packageRoot) || '',
      scripts: { test: 'echo \'Error: no test specified\' && exit 1' },
      author: 'hwyn (https://github.com/hwyn)',
      homepage: 'https://github.com/hwyn',
      license: 'MIT',
      dependencies: {},
      devDependencies: {}
    };

    return {
      ...defaultTemplate,
      ...templatePackage,
      ...restOptions,
      name,
      version,
      ...rootFields,
      exports: {
        './package.json': './package.json',
        ...(exports || {}),
      }
    };
  }

  private processDependencies(packageJson: any, name: string, version: string, dependencies: string[], generateDep: boolean) {
    const namespace = name.replace(/(@[^\/]+\/).*/, '$1');
    const rootDeps = { ...this.rootPackage.dependencies, ...this.rootPackage.devDependencies };
    const uniqueDeps = Array.from(new Set(dependencies)).sort();

    for (const depKey of uniqueDeps) {
      if (depKey === name) continue;

      const cleanKey = this.getCleanDependencyKey(depKey);

      if (cleanKey.includes(namespace)) {
        (packageJson.peerDependencies ??= {})[cleanKey] = `^${version}`;
        continue;
      }

      if (generateDep) {
        this.addExternalDependency(packageJson, cleanKey, rootDeps);
      }
    }
  }

  private addExternalDependency(packageJson: any, key: string, rootDeps: any) {
    if (rootDeps[key]) {
      packageJson.dependencies[key] = rootDeps[key];
    }

    if (!this.hasBuiltInTypes(key)) {
      const typeKey = `@types/${key}`;
      if (rootDeps[typeKey]) {
        packageJson.devDependencies[typeKey] = rootDeps[typeKey];
      }
    }
  }

  private getCleanDependencyKey(key: string): string {
    if (key.startsWith('@')) {
      return key.split('/').slice(0, 2).join('/');
    }
    return key.split('/')[0];
  }

  private hasBuiltInTypes(name: string): boolean {
    try {
      const packagePath = path.join(process.cwd(), 'node_modules', name, 'package.json');
      if (fs.existsSync(packagePath)) {
        const pkg = this.readJson(packagePath);
        return !!(pkg.types || pkg.typings || (pkg.exports?.['.']?.types));
      }
      return false;
    } catch {
      return false;
    }
  }

  private static readonly FILES_EXCLUDE = new Set(['package.json', 'node_modules', '.git', '__tests__', '.DS_Store']);

  private resolveFiles(packageRoot: string): string[] {
    if (!fs.existsSync(packageRoot)) return [];

    const entries = fs.readdirSync(packageRoot, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (GeneratePackage.FILES_EXCLUDE.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(entry.name);
    }

    return files.sort();
  }

  private cleanupPackageJson(packageJson: any) {
    if (!packageJson.exports || !Object.keys(packageJson.exports).length) delete packageJson.exports;
    if (!Object.keys(packageJson.dependencies).length) delete packageJson.dependencies;
    if (!Object.keys(packageJson.devDependencies).length) delete packageJson.devDependencies;
    return packageJson;
  }

  private readJson(filePath: string) {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : {};
  }

  private readDescriptionFromReadme(packageRoot: string): string {
    if (!packageRoot) return '';
    const readmePath = path.join(packageRoot, 'README.md');
    if (!fs.existsSync(readmePath)) return '';
    const lines = fs.readFileSync(readmePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[') || trimmed.startsWith('!')) continue;
      return trimmed;
    }
    return '';
  }

  private writeJson(filePath: string, content: any) {
    fs.writeFileSync(filePath, JSON.stringify(content, null, '\t'), 'utf-8');
  }
}
